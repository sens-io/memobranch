import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';
import { extractMarkdownLinks, parseMarkdown, titleFromBody } from './markdown.js';
import type { SearchHit, Sensitivity } from './types.js';
import { unique } from './utils.js';

interface IndexedDocument {
  path: string;
  id: string;
  title: string;
  kind: string;
  scope?: SearchHit['scope'];
  sensitivity?: Sensitivity;
  body: string;
  terms: string[];
  links: string[];
  status?: string;
  expiresAt?: string;
}

export interface SearchOptions {
  limit?: number;
  includeSensitive?: boolean;
  includeSecret?: boolean;
  includeEvidence?: boolean;
  includeCandidates?: boolean;
  expandLinks?: boolean;
}

export async function searchVault(root: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const documents = await loadDocuments(root, options);
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];
  const documentFrequency = new Map<string, number>();
  for (const term of unique(queryTerms)) {
    documentFrequency.set(term, documents.filter((doc) => doc.terms.includes(term)).length);
  }
  const backlinkMap = buildBacklinks(documents);
  const scored = documents
    .map((document) => ({ document, score: scoreDocument(document, queryTerms, documentFrequency, documents.length) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.document.path.localeCompare(b.document.path));

  const limit = Math.max(1, Math.min(options.limit ?? 8, 50));
  const selected = scored.slice(0, limit);
  if (options.expandLinks !== false) {
    const selectedPaths = new Set(selected.map((entry) => entry.document.path));
    for (const entry of [...selected]) {
      const neighbors = unique([...entry.document.links, ...(backlinkMap.get(entry.document.path) ?? [])]);
      for (const neighbor of neighbors) {
        if (selected.length >= limit || selectedPaths.has(neighbor)) continue;
        const document = documents.find((doc) => doc.path === neighbor);
        if (!document) continue;
        selected.push({ document, score: entry.score * 0.35 });
        selectedPaths.add(neighbor);
      }
    }
  }

  return selected.slice(0, limit).map(({ document, score }) => ({
    path: document.path,
    id: document.id,
    title: document.title,
    kind: document.kind,
    ...(document.scope ? { scope: document.scope } : {}),
    ...(document.sensitivity ? { sensitivity: document.sensitivity } : {}),
    score: Number(score.toFixed(4)),
    snippet: makeSnippet(document.body, queryTerms),
    links: document.links,
    backlinks: backlinkMap.get(document.path) ?? [],
  }));
}

export async function loadDocuments(root: string, options: SearchOptions = {}): Promise<IndexedDocument[]> {
  const paths = [join(root, 'wiki')];
  if (options.includeEvidence) paths.push(join(root, 'evidence'));
  if (options.includeCandidates) paths.push(join(root, 'candidates'));
  const files = (await Promise.all(paths.map((path) => listMarkdown(path)))).flat();
  const now = Date.now();
  const documents: IndexedDocument[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = parseMarkdown<Record<string, unknown>>(raw);
      const sensitivity = typeof parsed.meta.sensitivity === 'string' ? (parsed.meta.sensitivity as Sensitivity) : undefined;
      if (sensitivity === 'secret' && !options.includeSecret) continue;
      if (sensitivity === 'sensitive' && !options.includeSensitive) continue;
      const status = typeof parsed.meta.status === 'string' ? parsed.meta.status : undefined;
      if (['revoked', 'superseded', 'rejected'].includes(status ?? '')) continue;
      const expiresAt = typeof parsed.meta.expiresAt === 'string' ? parsed.meta.expiresAt : undefined;
      if (expiresAt && Date.parse(expiresAt) <= now) continue;
      const rootRelative = toPosix(relative(root, file));
      const title = titleFromBody(parsed.body, rootRelative);
      const rawLinks = extractMarkdownLinks(parsed.body);
      const links = rawLinks.map((target) => resolveLink(rootRelative, target)).filter((target): target is string => target !== null);
      const id = typeof parsed.meta.id === 'string' ? parsed.meta.id : rootRelative;
      const kind = typeof parsed.meta.kind === 'string' ? parsed.meta.kind : String(parsed.meta.type ?? 'document');
      const scope = typeof parsed.meta.scope === 'string' ? (parsed.meta.scope as SearchHit['scope']) : undefined;
      const searchable = `${title}\n${String(parsed.meta.key ?? '')}\n${String((parsed.meta.tags as string[] | undefined)?.join(' ') ?? '')}\n${parsed.body}`;
      documents.push({
        path: rootRelative,
        id,
        title,
        kind,
        ...(scope ? { scope } : {}),
        ...(sensitivity ? { sensitivity } : {}),
        body: parsed.body,
        terms: tokenize(searchable),
        links,
        ...(status ? { status } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
    } catch {
      // Doctor reports malformed files; retrieval skips them to preserve availability.
    }
  }
  return documents;
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
  const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [];
  const cjk: string[] = [];
  for (const run of cjkRuns) {
    const chars = [...run];
    cjk.push(...chars);
    for (let index = 0; index < chars.length - 1; index++) cjk.push(`${chars[index]}${chars[index + 1]}`);
  }
  return [...words, ...cjk];
}

function scoreDocument(document: IndexedDocument, query: string[], frequencies: Map<string, number>, total: number): number {
  const counts = new Map<string, number>();
  for (const term of document.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const normalizedTitle = document.title.toLowerCase();
  let score = 0;
  for (const term of query) {
    const count = counts.get(term) ?? 0;
    if (count === 0) continue;
    const idf = Math.log(1 + (total + 1) / ((frequencies.get(term) ?? 0) + 1));
    score += (1 + Math.log(count)) * idf;
    if (normalizedTitle.includes(term)) score += 2.5;
  }
  return score;
}

function makeSnippet(body: string, queryTerms: string[]): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  const lower = compact.toLowerCase();
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
  const known = new Set(documents.map((doc) => doc.path));
  const backlinks = new Map<string, string[]>();
  for (const document of documents) {
    for (const target of document.links) {
      if (!known.has(target)) continue;
      backlinks.set(target, unique([...(backlinks.get(target) ?? []), document.path]));
    }
  }
  return backlinks;
}

function toPosix(path: string): string {
  return path.split('\\').join('/');
}
