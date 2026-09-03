import { existsSync } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';
import { readVaultConfig } from './config.js';
import { isConfidential, isEncryptedEnvelope } from './encryption.js';
import type { LlmClient } from './llm.js';
import { extractMarkdownLinks, parseMarkdown, titleFromBody } from './markdown.js';
import { canAccess, localAdminPrincipal, type Principal } from './policy.js';
import type { MarkdownDocument, Scope, SearchHit, Sensitivity, VaultConfig } from './types.js';
import { sha256, unique, writeText } from './utils.js';

const INDEX_VERSION = 3 as const;
const EMBEDDING_CACHE_VERSION = 1 as const;

export interface IndexedDocument {
  path: string;
  id: string;
  title: string;
  kind: string;
  scope: Scope;
  sensitivity: Sensitivity;
  body: string;
  terms: string[];
  links: string[];
  status?: string;
  expiresAt?: string;
  contentHash: string;
  sourceSize: number;
  sourceMtimeMs: number;
  cacheHash: string;
}

interface StoredIndex {
  version: typeof INDEX_VERSION;
  updatedAt: string;
  documents: IndexedDocument[];
}

interface EmbeddingCache {
  version: typeof EMBEDDING_CACHE_VERSION;
  model: string;
  vectors: Record<string, number[]>;
}

export interface SearchOptions {
  limit?: number;
  includeSensitive?: boolean;
  includeSecret?: boolean;
  includeEvidence?: boolean;
  includeCandidates?: boolean;
  expandLinks?: boolean;
  semantic?: boolean;
  principal?: Principal;
}

export interface ReindexResult {
  documents: number;
  updated: number;
  removed: number;
  confidentialSkipped: number;
  semanticStatus: 'disabled' | 'ready' | 'degraded';
  rebuilt: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  semanticStatus: 'disabled' | 'ready' | 'degraded';
  indexRebuilt: boolean;
}

export interface SearchIndexHealth {
  healthy: boolean;
  documents: number;
  error?: string;
}

export type SecureDocumentReader = (relativePath: string) => Promise<MarkdownDocument<Record<string, unknown>>>;

export class PersistentSearchIndex {
  private readonly indexPath: string;
  private readonly embeddingPath: string;
  private trustedIndex: StoredIndex | null = null;

  constructor(
    readonly root: string,
    readonly config: VaultConfig,
    readonly llm?: LlmClient,
    readonly secureReader?: SecureDocumentReader,
  ) {
    this.indexPath = join(root, '.amem', 'search-index.json');
    this.embeddingPath = join(root, '.amem', 'embeddings.json');
  }

  async refresh(options: { semantic?: boolean } = {}): Promise<ReindexResult> {
    let rebuilt = !(await this.indexIsValid());
    const files = await listMarkdown(join(this.root, 'wiki'));
    if (files.length > this.config.index.maxDocuments) {
      throw new Error(`Vault contains ${files.length} documents; configured index maximum is ${this.config.index.maxDocuments}`);
    }
    let previous = await this.readIndex();
    if (!rebuilt && !this.trustedIndex && !(await this.health()).healthy) {
      rebuilt = true;
      previous = { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), documents: [] };
    }
    const byPath = new Map(previous.documents.map((document) => [document.path, document]));
    const documents: IndexedDocument[] = [];
    let updated = 0;
    let confidentialSkipped = 0;
    for (const file of files) {
      const relativePath = toPosix(relative(this.root, file));
      try {
        const source = await stat(file);
        const cached = byPath.get(relativePath);
        if (cached?.sourceSize === source.size && cached.sourceMtimeMs === source.mtimeMs) {
          documents.push(cached);
          continue;
        }
        const outer = await readOuterMeta(file);
        const sensitivity = sensitivityOf(outer);
        if (isConfidential(sensitivity) || isEncryptedEnvelope(outer)) {
          confidentialSkipped += 1;
          continue;
        }
        const raw = await readFile(file, 'utf8');
        const contentHash = sha256(raw);
        if (cached?.contentHash === contentHash) {
          documents.push(withSourceState(cached, source.size, source.mtimeMs));
          updated += 1;
          continue;
        }
        documents.push(indexDocument(relativePath, raw, contentHash, source.size, source.mtimeMs));
        updated += 1;
      } catch {
        // Malformed files are omitted here and reported by doctor.
      }
    }
    const currentPaths = new Set(documents.map((document) => document.path));
    const removed = previous.documents.filter((document) => !currentPaths.has(document.path)).length;
    const index: StoredIndex = { version: INDEX_VERSION, updatedAt: new Date().toISOString(), documents };
    if (rebuilt || updated > 0 || removed > 0) await writeText(this.indexPath, `${JSON.stringify(index)}\n`);
    this.trustedIndex = index;

    let semanticStatus: ReindexResult['semanticStatus'] = 'disabled';
    if (options.semantic && this.config.index.embeddingModel) {
      try {
        await this.refreshEmbeddings(documents);
        semanticStatus = 'ready';
      } catch {
        semanticStatus = 'degraded';
      }
    }
    return { documents: documents.length, updated, removed, confidentialSkipped, semanticStatus, rebuilt };
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const principal = options.principal ?? localAdminPrincipal();
    let semanticStatus: SearchResult['semanticStatus'] = 'disabled';
    const refreshed = await this.ensureTrusted(Boolean(options.semantic));
    semanticStatus = refreshed.semanticStatus;
    const index = this.trustedIndex!;
    const documents = index.documents.filter((document) =>
      isActive(document) && canAccess(principal, document.scope, document.sensitivity) && selectedArea(document.path, options));
    documents.push(...(await this.loadEphemeralSelected(principal, options)));

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return { hits: [], semanticStatus, indexRebuilt: refreshed.rebuilt };
    const documentFrequency = frequencies(documents, queryTerms);
    const lexical = new Map(documents.map((document) => [document.path, scoreDocument(document, queryTerms, documentFrequency, documents.length)]));
    let semantic = new Map<string, number>();
    if (options.semantic && this.config.index.embeddingModel && this.llm?.canEmbed(this.config.index.embeddingModel)) {
      try {
        semantic = await this.semanticScores(query, documents);
        semanticStatus = 'ready';
      } catch {
        semanticStatus = 'degraded';
      }
    }

    const lexicalWeight = semantic.size > 0 ? this.config.index.lexicalWeight : 1;
    const semanticWeight = semantic.size > 0 ? this.config.index.semanticWeight : 0;
    const maximumLexical = Math.max(1, ...lexical.values());
    const scored = documents
      .map((document) => {
        const lexicalScore = (lexical.get(document.path) ?? 0) / maximumLexical;
        const semanticScore = semantic.get(document.path) ?? 0;
        return { document, lexicalScore, semanticScore, score: lexicalScore * lexicalWeight + semanticScore * semanticWeight };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.document.path.localeCompare(b.document.path));

    const requestedLimit = options.limit ?? 8;
    const limit = Math.max(1, Math.min(requestedLimit, this.config.limits.maxResults));
    const selected = scored.slice(0, limit);
    const backlinkMap = buildBacklinks(documents);
    if (options.expandLinks !== false) {
      const selectedPaths = new Set(selected.map((entry) => entry.document.path));
      for (const entry of [...selected]) {
        for (const neighbor of unique([...entry.document.links, ...(backlinkMap.get(entry.document.path) ?? [])])) {
          if (selected.length >= limit || selectedPaths.has(neighbor)) continue;
          const document = documents.find((candidate) => candidate.path === neighbor);
          if (!document) continue;
          selected.push({ document, score: entry.score * 0.35, lexicalScore: 0, semanticScore: 0 });
          selectedPaths.add(neighbor);
        }
      }
    }

    const hits = await Promise.all(selected.slice(0, limit).map(async ({ document, score, lexicalScore, semanticScore }) => {
      return {
        path: document.path,
        id: document.id,
        title: document.title,
        kind: document.kind,
        scope: document.scope,
        sensitivity: document.sensitivity,
        ...(document.status ? { status: document.status } : {}),
        score: Number(score.toFixed(4)),
        lexicalScore: Number(lexicalScore.toFixed(4)),
        semanticScore: Number(semanticScore.toFixed(4)),
        snippet: makeSnippet(document.body, queryTerms),
        links: document.links,
        backlinks: backlinkMap.get(document.path) ?? [],
      };
    }));
    return { hits, semanticStatus, indexRebuilt: refreshed.rebuilt };
  }

  async health(): Promise<SearchIndexHealth> {
    if (!(await this.indexIsValid())) return { healthy: false, documents: 0, error: 'Search index is missing, corrupt, or unsupported' };
    const index = await this.readIndex();
    const expected = new Map<string, string>();
    for (const file of await listMarkdown(join(this.root, 'wiki'))) {
      try {
        const outer = await readOuterMeta(file);
        if (isConfidential(sensitivityOf(outer)) || isEncryptedEnvelope(outer)) continue;
        const raw = await readFile(file, 'utf8');
        const source = await stat(file);
        const path = toPosix(relative(this.root, file));
        expected.set(path, JSON.stringify(indexDocument(path, raw, sha256(raw), source.size, source.mtimeMs)));
      } catch {
        return { healthy: false, documents: index.documents.length, error: 'A canonical Wiki document is malformed' };
      }
    }
    if (expected.size !== index.documents.length || index.documents.some((document) => expected.get(document.path) !== JSON.stringify(document))) {
      return { healthy: false, documents: index.documents.length, error: 'Search index is stale' };
    }
    return { healthy: true, documents: index.documents.length };
  }

  private async ensureTrusted(semantic: boolean): Promise<ReindexResult> {
    if (this.trustedIndex && !semantic) {
      return { documents: this.trustedIndex.documents.length, updated: 0, removed: 0, confidentialSkipped: 0, semanticStatus: 'disabled', rebuilt: false };
    }
    if (!this.trustedIndex && await this.indexIsValid()) {
      const health = await this.health();
      if (health.healthy) this.trustedIndex = await this.readIndex();
    }
    if (!this.trustedIndex || semantic) return this.refresh(semantic ? { semantic: true } : {});
    return { documents: this.trustedIndex.documents.length, updated: 0, removed: 0, confidentialSkipped: 0, semanticStatus: 'disabled', rebuilt: false };
  }

  private async loadEphemeralSelected(principal: Principal, options: SearchOptions): Promise<IndexedDocument[]> {
    if (!this.secureReader) return [];
    const documents: IndexedDocument[] = [];
    for (const file of await allManagedMarkdown(this.root)) {
      const relativePath = toPosix(relative(this.root, file));
      if (!selectedArea(relativePath, options)) continue;
      try {
        const outer = await readOuterMeta(file);
        const scope = scopeOf(outer);
        const sensitivity = sensitivityOf(outer);
        if (!isConfidential(sensitivity) && relativePath.startsWith('wiki/')) continue;
        if (sensitivity === 'sensitive' && !options.includeSensitive) continue;
        if (sensitivity === 'secret' && !options.includeSecret) continue;
        if (!canAccess(principal, scope, sensitivity)) continue;
        const logical = await this.secureReader(relativePath);
        const raw = `---\nplaceholder: true\n---\n${logical.body}`;
        documents.push(indexParts(relativePath, logical.meta, logical.body, sha256(raw), 0, 0));
      } catch {
        // Authorization and key failures do not reveal the document through search.
      }
    }
    return documents;
  }

  private async refreshEmbeddings(documents: IndexedDocument[]): Promise<void> {
    if (!this.llm?.canEmbed(this.config.index.embeddingModel) || !this.config.index.embeddingModel) throw new Error('Embeddings are not configured');
    const cache = await this.readEmbeddingCache();
    const vectors: Record<string, number[]> = {};
    const missing: IndexedDocument[] = [];
    for (const document of documents) {
      const cached = cache.model === this.config.index.embeddingModel ? cache.vectors[document.contentHash] : undefined;
      if (cached) vectors[document.contentHash] = cached;
      else missing.push(document);
    }
    for (let offset = 0; offset < missing.length; offset += 32) {
      const batch = missing.slice(offset, offset + 32);
      const results = await this.llm.embed(batch.map(embeddingText), this.config.index.embeddingModel);
      for (let index = 0; index < batch.length; index += 1) {
        const document = batch[index];
        const vector = results[index];
        if (document && vector) vectors[document.contentHash] = vector;
      }
    }
    await writeText(this.embeddingPath, `${JSON.stringify({ version: EMBEDDING_CACHE_VERSION, model: this.config.index.embeddingModel, vectors })}\n`);
  }

  private async semanticScores(query: string, documents: IndexedDocument[]): Promise<Map<string, number>> {
    await this.refreshEmbeddings(documents.filter((document) => !isConfidential(document.sensitivity)));
    const cache = await this.readEmbeddingCache();
    const [queryVector] = await this.llm!.embed([query], this.config.index.embeddingModel!);
    if (!queryVector) return new Map();
    return new Map(
      documents
        .map((document) => {
          const vector = cache.vectors[document.contentHash];
          return vector ? ([document.path, Math.max(0, cosine(queryVector, vector))] as const) : null;
        })
        .filter((entry): entry is readonly [string, number] => entry !== null),
    );
  }

  private async readIndex(): Promise<StoredIndex> {
    if (!existsSync(this.indexPath)) return { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), documents: [] };
    try {
      const value = JSON.parse(await readFile(this.indexPath, 'utf8')) as unknown;
      return isStoredIndex(value) ? value : { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), documents: [] };
    } catch {
      return { version: INDEX_VERSION, updatedAt: new Date(0).toISOString(), documents: [] };
    }
  }

  private async indexIsValid(): Promise<boolean> {
    if (!existsSync(this.indexPath)) return false;
    try {
      return isStoredIndex(JSON.parse(await readFile(this.indexPath, 'utf8')) as unknown);
    } catch {
      return false;
    }
  }

  private async readEmbeddingCache(): Promise<EmbeddingCache> {
    if (!existsSync(this.embeddingPath)) return { version: EMBEDDING_CACHE_VERSION, model: '', vectors: {} };
    try {
      const value = JSON.parse(await readFile(this.embeddingPath, 'utf8')) as EmbeddingCache;
      return value.version === EMBEDDING_CACHE_VERSION ? value : { version: EMBEDDING_CACHE_VERSION, model: '', vectors: {} };
    } catch {
      return { version: EMBEDDING_CACHE_VERSION, model: '', vectors: {} };
    }
  }
}

export async function searchVault(root: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const config = await readVaultConfig(root);
  const index = new PersistentSearchIndex(root, config, undefined, async (relativePath) => {
    const parsed = parseMarkdown<Record<string, unknown>>(await readFile(join(root, relativePath), 'utf8'));
    return { path: relativePath, meta: parsed.meta, body: parsed.body };
  });
  return (await index.search(query, { ...options, principal: options.principal ?? localAdminPrincipal() })).hits;
}

function indexDocument(relativePath: string, raw: string, contentHash: string, sourceSize: number, sourceMtimeMs: number): IndexedDocument {
  const parsed = parseMarkdown<Record<string, unknown>>(raw);
  return indexParts(relativePath, parsed.meta, parsed.body, contentHash, sourceSize, sourceMtimeMs);
}

function indexParts(relativePath: string, meta: Record<string, unknown>, body: string, contentHash: string, sourceSize: number, sourceMtimeMs: number): IndexedDocument {
  const title = titleFromBody(body, relativePath);
  const links = extractMarkdownLinks(body)
    .map((target) => resolveLink(relativePath, target))
    .filter((target): target is string => target !== null);
  const tags = Array.isArray(meta.tags) ? meta.tags.filter((value): value is string => typeof value === 'string') : [];
  const document: Omit<IndexedDocument, 'cacheHash'> = {
    path: relativePath,
    id: typeof meta.id === 'string' ? meta.id : relativePath,
    title,
    kind: typeof meta.kind === 'string' ? meta.kind : String(meta.type ?? 'document'),
    scope: scopeOf(meta),
    sensitivity: sensitivityOf(meta),
    body,
    terms: tokenize(`${title}\n${String(meta.key ?? '')}\n${tags.join(' ')}\n${body}`),
    links,
    ...(typeof meta.status === 'string' ? { status: meta.status } : {}),
    ...(typeof meta.expiresAt === 'string' ? { expiresAt: meta.expiresAt } : {}),
    contentHash,
    sourceSize,
    sourceMtimeMs,
  };
  return { ...document, cacheHash: sha256(JSON.stringify(document)) };
}

function withSourceState(document: IndexedDocument, sourceSize: number, sourceMtimeMs: number): IndexedDocument {
  const { cacheHash: _cacheHash, ...rest } = document;
  const updated = { ...rest, sourceSize, sourceMtimeMs };
  return { ...updated, cacheHash: sha256(JSON.stringify(updated)) };
}

function isStoredIndex(value: unknown): value is StoredIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const index = value as Partial<StoredIndex>;
  if (index.version !== INDEX_VERSION || typeof index.updatedAt !== 'string' || !Array.isArray(index.documents)) return false;
  return index.documents.every((document) => {
    if (!document || typeof document !== 'object') return false;
    const candidate = document as Partial<IndexedDocument>;
    if (
      typeof candidate.path !== 'string' || !candidate.path.startsWith('wiki/') ||
      typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || typeof candidate.kind !== 'string' ||
      !['user', 'project', 'team', 'public'].includes(String(candidate.scope)) ||
      !['public', 'internal', 'sensitive', 'secret'].includes(String(candidate.sensitivity)) ||
      typeof candidate.body !== 'string' || !Array.isArray(candidate.terms) || candidate.terms.some((term) => typeof term !== 'string') ||
      !Array.isArray(candidate.links) || candidate.links.some((link) => typeof link !== 'string') ||
      typeof candidate.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.contentHash) ||
      typeof candidate.sourceSize !== 'number' || !Number.isFinite(candidate.sourceSize) || candidate.sourceSize < 0 ||
      typeof candidate.sourceMtimeMs !== 'number' || !Number.isFinite(candidate.sourceMtimeMs) ||
      typeof candidate.cacheHash !== 'string'
    ) return false;
    const { cacheHash, ...payload } = candidate as IndexedDocument;
    return cacheHash === sha256(JSON.stringify(payload));
  });
}

async function readOuterMeta(file: string): Promise<Record<string, unknown>> {
  const handle = await open(file, 'r');
  try {
    let content = '';
    for (let size = 1_024; size <= 65_536; size *= 2) {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      content = buffer.subarray(0, bytesRead).toString('utf8');
      const ending = content.indexOf('\n---', 4);
      if (ending >= 0) return parseMarkdown<Record<string, unknown>>(`${content.slice(0, ending + 4)}\n`).meta;
      if (bytesRead < size) break;
    }
    throw new Error('Frontmatter exceeds 64 KiB or is malformed');
  } finally {
    await handle.close();
  }
}

async function allManagedMarkdown(root: string): Promise<string[]> {
  return (await Promise.all(['wiki', 'evidence', 'candidates'].map((name) => listMarkdown(join(root, name))))).flat().sort();
}

async function listMarkdown(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await listMarkdown(path)));
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push(path);
  }
  return output;
}

function tokenize(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9._-]*/g) ?? [];
  const runs = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [];
  const cjk: string[] = [];
  for (const run of runs) {
    const chars = [...run];
    cjk.push(...chars);
    for (let index = 0; index < chars.length - 1; index += 1) cjk.push(`${chars[index]}${chars[index + 1]}`);
  }
  return [...words, ...cjk];
}

function frequencies(documents: IndexedDocument[], query: string[]): Map<string, number> {
  return new Map(unique(query).map((term) => [term, documents.filter((document) => document.terms.includes(term)).length]));
}

function scoreDocument(document: IndexedDocument, query: string[], termFrequency: Map<string, number>, total: number): number {
  const counts = new Map<string, number>();
  for (const term of document.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const normalizedTitle = document.title.normalize('NFKC').toLowerCase();
  let score = 0;
  for (const term of query) {
    const count = counts.get(term) ?? 0;
    if (!count) continue;
    const idf = Math.log(1 + (total + 1) / ((termFrequency.get(term) ?? 0) + 1));
    score += (1 + Math.log(count)) * idf;
    if (normalizedTitle.includes(term)) score += 2.5;
  }
  return score;
}

function makeSnippet(body: string, queryTerms: string[]): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  const lower = compact.normalize('NFKC').toLowerCase();
  const indices = queryTerms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const center = indices.length > 0 ? Math.min(...indices) : 0;
  const start = Math.max(0, center - 100);
  const end = Math.min(compact.length, start + 360);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function resolveLink(sourcePath: string, target: string): string | null {
  const clean = target.split('#')[0];
  if (!clean) return null;
  const resolved = clean.startsWith('/') ? posix.normalize(clean.slice(1)) : posix.normalize(posix.join(posix.dirname(sourcePath), clean));
  return resolved.startsWith('../') ? null : resolved;
}

function buildBacklinks(documents: IndexedDocument[]): Map<string, string[]> {
  const known = new Set(documents.map((document) => document.path));
  const backlinks = new Map<string, string[]>();
  for (const document of documents) {
    for (const target of document.links) {
      if (known.has(target)) backlinks.set(target, unique([...(backlinks.get(target) ?? []), document.path]));
    }
  }
  return backlinks;
}

function scopeOf(meta: Record<string, unknown>): Scope {
  return ['user', 'project', 'team', 'public'].includes(String(meta.scope)) ? (meta.scope as Scope) : 'project';
}

function sensitivityOf(meta: Record<string, unknown>): Sensitivity {
  return ['public', 'internal', 'sensitive', 'secret'].includes(String(meta.sensitivity))
    ? (meta.sensitivity as Sensitivity)
    : 'internal';
}

function isActive(document: IndexedDocument): boolean {
  if (['revoked', 'superseded', 'rejected', 'conflicted'].includes(document.status ?? '')) return false;
  return !document.expiresAt || Date.parse(document.expiresAt) > Date.now();
}

function selectedArea(path: string, options: SearchOptions): boolean {
  if (path.startsWith('evidence/')) return options.includeEvidence === true;
  if (path.startsWith('candidates/')) return options.includeCandidates === true;
  return path.startsWith('wiki/');
}

function embeddingText(document: IndexedDocument): string {
  return `${document.title}\n${document.body}`.slice(0, 16_000);
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

function toPosix(path: string): string {
  return path.split('\\').join('/');
}
