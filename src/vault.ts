import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join, posix, relative, resolve } from 'node:path';
import { GitStore } from './git-store.js';
import { LlmClient } from './llm.js';
import { extractMarkdownLinks, parseMarkdown, serializeMarkdown } from './markdown.js';
import { searchVault, type SearchOptions } from './search.js';
import type {
  Actor,
  CandidateMeta,
  DoctorReport,
  EvidenceMeta,
  MarkdownDocument,
  MemoryMeta,
  ProposedMemory,
  Scope,
  SearchHit,
  Sensitivity,
  VaultConfig,
} from './types.js';
import { appendText, nowIso, resolveInside, sha256, shortId, slugify, unique, withFileLock, writeText } from './utils.js';

const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Agent Memory' };

export interface CaptureOptions {
  content: string;
  actor?: Actor;
  sourceUri?: string;
  scope?: Scope;
  sensitivity?: Sensitivity;
  extract?: boolean;
}

export interface CaptureResult {
  evidenceId: string;
  evidencePath: string;
  duplicate: boolean;
  candidates: Array<{ id: string; path: string }>;
  commit: string | null;
}

export interface ConsolidationResult {
  promoted: string[];
  merged: string[];
  conflicts: string[];
  deferred: string[];
  commit: string | null;
}

export class MemoryVault {
  readonly root: string;
  readonly git: GitStore;

  constructor(root = process.cwd(), readonly llm = new LlmClient()) {
    this.root = resolve(root);
    this.git = new GitStore(this.root);
  }

  async initialize(name = basename(this.root)): Promise<{ created: boolean; commit: string | null }> {
    await mkdir(this.root, { recursive: true });
    const configPath = join(this.root, 'agent-memory.json');
    if (existsSync(configPath)) {
      await this.git.initialize();
      return { created: false, commit: null };
    }
    const timestamp = nowIso();
    const config: VaultConfig = {
      version: 1,
      vaultId: `vault-${shortId()}`,
      name,
      createdAt: timestamp,
      residentBudget: 24,
      minimumConfidence: 0.75,
      minimumProcedureEvidence: 2,
    };
    await Promise.all([
      mkdir(join(this.root, '.amem'), { recursive: true }),
      mkdir(join(this.root, 'evidence'), { recursive: true }),
      mkdir(join(this.root, 'candidates'), { recursive: true }),
      mkdir(join(this.root, 'wiki'), { recursive: true }),
    ]);
    await writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await this.installAgentInstructions();
    await writeText(join(this.root, 'log.md'), '# Memory log\n\nAppend-only audit journal for memory operations.\n');
    await this.rebuildGenerated(config);
    await appendText(join(this.root, 'log.md'), `\n- ${timestamp} \`init\` by \`system\`: initialized vault ${config.vaultId}\n`);
    await this.git.initialize();
    const commit = await this.git.commit('init: create agent memory vault', SYSTEM_ACTOR);
    return { created: true, commit };
  }

  async config(): Promise<VaultConfig> {
    this.assertInitialized();
    return JSON.parse(await readFile(join(this.root, 'agent-memory.json'), 'utf8')) as VaultConfig;
  }

  async capture(options: CaptureOptions): Promise<CaptureResult> {
    this.assertInitialized();
    const content = options.content.trim();
    if (!content) throw new Error('Evidence content cannot be empty');
    const actor = options.actor ?? SYSTEM_ACTOR;
    const scope = options.scope ?? 'user';
    const sensitivity = options.sensitivity ?? 'internal';
    const digest = sha256(`${scope}\0${options.sourceUri ?? ''}\0${content}`);
    const evidenceId = `ev-${digest.slice(0, 12)}`;

    const result = await withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const existing = await this.findById<EvidenceMeta>('evidence', evidenceId);
      if (existing) return { evidence: existing, duplicate: true, commit: null };
      const timestamp = nowIso();
      const day = timestamp.slice(0, 10).replaceAll('-', '/');
      const rootPath = `evidence/${day}/${timestamp.replaceAll(':', '').replaceAll('.', '')}-${evidenceId}.md`;
      const meta: EvidenceMeta = {
        id: evidenceId,
        type: 'evidence',
        createdAt: timestamp,
        actor: actor.id,
        ...(options.sourceUri ? { sourceUri: options.sourceUri } : {}),
        scope,
        sensitivity,
        sha256: digest,
        immutable: true,
      };
      const body = `# Evidence ${evidenceId}\n\n${content}`;
      await writeText(resolveInside(this.root, rootPath), serializeMarkdown(meta, body));
      await this.appendLog('capture', actor, `${evidenceId} (${scope}/${sensitivity})`);
      await this.rebuildGenerated(await this.config());
      const commit = await this.git.commit(`memory: capture ${evidenceId}`, actor);
      return { evidence: { path: rootPath, meta, body }, duplicate: false, commit };
    });

    let candidates: Array<{ id: string; path: string }> = [];
    let commit = result.commit;
    if (options.extract) {
      const extracted = await this.extract(result.evidence.meta.id, actor);
      candidates = extracted.candidates;
      commit = extracted.commit ?? commit;
    }
    return {
      evidenceId,
      evidencePath: result.evidence.path,
      duplicate: result.duplicate,
      candidates,
      commit,
    };
  }

  async extract(evidenceId: string, actor: Actor = SYSTEM_ACTOR): Promise<{ candidates: Array<{ id: string; path: string }>; commit: string | null }> {
    this.assertInitialized();
    const evidence = await this.requireById<EvidenceMeta>('evidence', evidenceId);
    const proposals = await this.llm.extractMemories(evidence.body, {
      scope: evidence.meta.scope,
      sensitivity: evidence.meta.sensitivity,
    });
    return this.proposeMany(proposals, [evidence.path], actor, `extract ${evidenceId}`);
  }

  async propose(proposal: ProposedMemory, evidence: string[] = [], actor: Actor = SYSTEM_ACTOR): Promise<{ id: string; path: string; duplicate: boolean; commit: string | null }> {
    const result = await this.proposeMany([proposal], evidence, actor, `propose ${proposal.key}`);
    const first = result.candidates[0];
    if (!first) throw new Error('No candidate was created');
    return { ...first, duplicate: result.duplicates.includes(first.id), commit: result.commit };
  }

  private async proposeMany(
    proposals: ProposedMemory[],
    evidence: string[],
    actor: Actor,
    logDetail: string,
  ): Promise<{ candidates: Array<{ id: string; path: string }>; duplicates: string[]; commit: string | null }> {
    this.assertInitialized();
    const normalizedEvidence: string[] = [];
    for (const path of evidence) {
      const absolute = resolveInside(this.root, path);
      if (!existsSync(absolute)) throw new Error(`Evidence path does not exist: ${path}`);
      const rootPath = toPosix(relative(this.root, absolute));
      if (!rootPath.startsWith('evidence/')) throw new Error(`Provenance must point into evidence/: ${path}`);
      const source = await this.readDocument<Record<string, unknown>>(rootPath);
      if (source.meta.type !== 'evidence' || source.meta.immutable !== true) {
        throw new Error(`Provenance is not immutable evidence: ${path}`);
      }
      normalizedEvidence.push(rootPath);
    }
    return withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const created: Array<{ id: string; path: string }> = [];
      const duplicates: string[] = [];
      for (const proposal of proposals) {
        validateProposal(proposal);
        const signature = `${proposal.scope}\0${proposal.kind}\0${proposal.key}\0${proposal.statement}\0${[...normalizedEvidence].sort().join('\0')}`;
        const id = `cand-${shortId(signature)}`;
        const path = `candidates/${id}.md`;
        if (existsSync(resolveInside(this.root, path))) {
          duplicates.push(id);
          created.push({ id, path });
          continue;
        }
        const timestamp = nowIso();
        const meta: CandidateMeta = {
          id,
          type: 'memory-candidate',
          createdAt: timestamp,
          updatedAt: timestamp,
          kind: proposal.kind,
          key: proposal.key.trim(),
          scope: proposal.scope,
          sensitivity: proposal.sensitivity,
          confidence: proposal.confidence,
          explicit: proposal.explicit,
          status: 'pending',
          evidence: unique(normalizedEvidence),
          conditions: unique(proposal.conditions),
          tags: unique(proposal.tags),
          ...(proposal.expiresAt ? { expiresAt: proposal.expiresAt } : {}),
          conflictsWith: [],
        };
        const body = candidateBody(meta, proposal.statement);
        await writeText(resolveInside(this.root, path), serializeMarkdown(meta, body));
        created.push({ id, path });
      }
      if (created.length > duplicates.length) await this.appendLog('propose', actor, `${logDetail}; ${created.length - duplicates.length} candidate(s)`);
      await this.rebuildGenerated(await this.config());
      const commit = await this.git.commit(`memory: ${logDetail}`, actor);
      return { candidates: created, duplicates, commit };
    });
  }

  async consolidate(actor: Actor = SYSTEM_ACTOR): Promise<ConsolidationResult> {
    this.assertInitialized();
    return withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const config = await this.config();
      const candidates = (await this.readDirectory<CandidateMeta>('candidates')).filter((doc) => doc.meta.status === 'pending');
      const memories = await this.readDirectory<MemoryMeta>('wiki');
      const result: ConsolidationResult = { promoted: [], merged: [], conflicts: [], deferred: [], commit: null };
      let changed = false;
      for (const candidate of candidates) {
        const matching = memories.filter((memory) =>
          ['active', 'conflicted'].includes(memory.meta.status) &&
          memory.meta.scope === candidate.meta.scope &&
          memory.meta.kind === candidate.meta.kind &&
          normalizeKey(memory.meta.key) === normalizeKey(candidate.meta.key),
        );
        const same = matching.find((memory) => normalizeStatement(memory.body) === normalizeStatement(candidate.body));
        if (same) {
          same.meta.evidence = unique([...same.meta.evidence, ...candidate.meta.evidence]);
          same.meta.confidence = Math.max(same.meta.confidence, candidate.meta.confidence);
          same.meta.updatedAt = nowIso();
          same.meta.validatedAt = same.meta.updatedAt;
          same.meta.revision += 1;
          candidate.meta.status = 'promoted';
          candidate.meta.updatedAt = same.meta.updatedAt;
          candidate.meta.promotedTo = same.path;
          await this.writeDocument(same);
          await this.writeDocument(candidate);
          result.merged.push(candidate.meta.id);
          changed = true;
          continue;
        }
        if (matching.length > 0) {
          const conflictIds = matching.map((memory) => memory.meta.id).sort();
          const alreadyMarked = [...candidate.meta.conflictsWith].sort().join('\0') === conflictIds.join('\0')
            && matching.every((memory) => memory.meta.status === 'conflicted');
          if (!alreadyMarked) {
            candidate.meta.conflictsWith = conflictIds;
            candidate.meta.updatedAt = nowIso();
            for (const memory of matching) {
              memory.meta.status = 'conflicted';
              memory.meta.updatedAt = candidate.meta.updatedAt;
              await this.writeDocument(memory);
            }
            await this.writeDocument(candidate);
            changed = true;
          }
          result.conflicts.push(candidate.meta.id);
          continue;
        }
        const enoughConfidence = candidate.meta.confidence >= config.minimumConfidence;
        const enoughEvidence = candidate.meta.kind !== 'procedure' || unique(candidate.meta.evidence).length >= config.minimumProcedureEvidence;
        if (!candidate.meta.explicit && (!enoughConfidence || !enoughEvidence)) {
          result.deferred.push(candidate.meta.id);
          continue;
        }
        const memory = await this.promoteCandidate(candidate, [], false);
        memories.push(memory);
        result.promoted.push(candidate.meta.id);
        changed = true;
      }
      if (changed) {
        await this.appendLog(
          'consolidate',
          actor,
          `promoted=${result.promoted.length}, merged=${result.merged.length}, conflicts=${result.conflicts.length}, deferred=${result.deferred.length}`,
        );
      }
      await this.rebuildGenerated(config);
      result.commit = await this.git.commit('memory: consolidate candidates', actor);
      return result;
    });
  }

  async approve(candidateId: string, actor: Actor = SYSTEM_ACTOR): Promise<{ memoryId: string; memoryPath: string; commit: string | null }> {
    this.assertInitialized();
    return withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const candidate = await this.requireById<CandidateMeta>('candidates', candidateId);
      if (candidate.meta.status === 'rejected') throw new Error(`Candidate ${candidateId} was rejected`);
      if (candidate.meta.status === 'promoted' && candidate.meta.promotedTo) {
        const existing = await this.readDocument<MemoryMeta>(candidate.meta.promotedTo);
        return { memoryId: existing.meta.id, memoryPath: existing.path, commit: null };
      }
      const memories = await this.readDirectory<MemoryMeta>('wiki');
      const conflicts = memories.filter((memory) =>
        ['active', 'conflicted'].includes(memory.meta.status) &&
        memory.meta.scope === candidate.meta.scope &&
        memory.meta.kind === candidate.meta.kind &&
        normalizeKey(memory.meta.key) === normalizeKey(candidate.meta.key),
      );
      const same = conflicts.find((memory) => normalizeStatement(memory.body) === normalizeStatement(candidate.body));
      if (same) {
        const timestamp = nowIso();
        same.meta.evidence = unique([...same.meta.evidence, ...candidate.meta.evidence]);
        same.meta.confidence = 1;
        same.meta.updatedAt = timestamp;
        same.meta.validatedAt = timestamp;
        same.meta.revision += 1;
        candidate.meta.status = 'promoted';
        candidate.meta.promotedTo = same.path;
        candidate.meta.updatedAt = timestamp;
        candidate.meta.conflictsWith = [];
        await this.writeDocument(same);
        await this.writeDocument(candidate);
        await this.appendLog('approve', actor, `${candidateId} -> ${same.meta.id}; merged duplicate`);
        await this.rebuildGenerated(await this.config());
        const commit = await this.git.commit(`memory: approve ${candidateId}`, actor);
        return { memoryId: same.meta.id, memoryPath: same.path, commit };
      }
      const memory = await this.promoteCandidate(candidate, conflicts, true);
      await this.appendLog('approve', actor, `${candidateId} -> ${memory.meta.id}; superseded=${conflicts.length}`);
      await this.rebuildGenerated(await this.config());
      const commit = await this.git.commit(`memory: approve ${candidateId}`, actor);
      return { memoryId: memory.meta.id, memoryPath: memory.path, commit };
    });
  }

  async reject(candidateId: string, reason: string, actor: Actor = SYSTEM_ACTOR): Promise<{ commit: string | null }> {
    this.assertInitialized();
    if (!reason.trim()) throw new Error('A rejection reason is required');
    return withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const candidate = await this.requireById<CandidateMeta>('candidates', candidateId);
      if (candidate.meta.status === 'promoted') throw new Error(`Candidate ${candidateId} was already promoted`);
      if (candidate.meta.status === 'rejected' && candidate.meta.rejectionReason === reason.trim()) {
        return { commit: null };
      }
      candidate.meta.status = 'rejected';
      candidate.meta.rejectionReason = reason.trim();
      candidate.meta.updatedAt = nowIso();
      await this.writeDocument(candidate);
      await this.appendLog('reject', actor, `${candidateId}: ${reason.trim()}`);
      await this.rebuildGenerated(await this.config());
      const commit = await this.git.commit(`memory: reject ${candidateId}`, actor);
      return { commit };
    });
  }

  async forget(selector: string, reason: string, actor: Actor = SYSTEM_ACTOR): Promise<{ memoryId: string; commit: string | null }> {
    this.assertInitialized();
    if (!reason.trim()) throw new Error('A revocation reason is required');
    return withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const memories = await this.readDirectory<MemoryMeta>('wiki');
      const matches = memories.filter((memory) =>
        memory.meta.id === selector || normalizeKey(memory.meta.key) === normalizeKey(selector),
      );
      if (matches.length === 0) throw new Error(`Memory not found: ${selector}`);
      if (matches.length > 1) throw new Error(`Selector is ambiguous; use an id: ${matches.map((item) => item.meta.id).join(', ')}`);
      const memory = matches[0];
      if (!memory) throw new Error(`Memory not found: ${selector}`);
      const timestamp = nowIso();
      memory.meta.status = 'revoked';
      memory.meta.revokedAt = timestamp;
      memory.meta.revocationReason = reason.trim();
      memory.meta.updatedAt = timestamp;
      memory.meta.revision += 1;
      await this.writeDocument(memory);
      await this.appendLog('forget', actor, `${memory.meta.id}: ${reason.trim()}`);
      await this.rebuildGenerated(await this.config());
      const commit = await this.git.commit(`memory: revoke ${memory.meta.id}`, actor);
      return { memoryId: memory.meta.id, commit };
    });
  }

  async get(id: string): Promise<MarkdownDocument<Record<string, unknown>>> {
    this.assertInitialized();
    for (const directory of ['wiki', 'candidates', 'evidence']) {
      const found = await this.findById<Record<string, unknown>>(directory, id);
      if (found) return found;
    }
    throw new Error(`Document not found: ${id}`);
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    this.assertInitialized();
    return searchVault(this.root, query, options);
  }

  async context(query: string, options: SearchOptions & { maxCharacters?: number } = {}): Promise<string> {
    this.assertInitialized();
    const resident = await readFile(join(this.root, 'MEMORY.md'), 'utf8');
    const hits = await this.search(query, options);
    const sections = hits.map((hit) => `## [${hit.path}]\n${hit.snippet}`);
    const context = `${resident.trim()}\n\n# Retrieved memory\n\n${sections.join('\n\n')}`;
    return context.slice(0, Math.max(500, options.maxCharacters ?? 12_000));
  }

  async answer(question: string, options: SearchOptions & { maxCharacters?: number } = {}): Promise<string> {
    return this.llm.answer(question, await this.context(question, options));
  }

  async doctor(): Promise<DoctorReport> {
    this.assertInitialized();
    const [evidence, candidates, memories, allFiles] = await Promise.all([
      this.readDirectory<EvidenceMeta>('evidence'),
      this.readDirectory<CandidateMeta>('candidates'),
      this.readDirectory<MemoryMeta>('wiki'),
      this.listAllMarkdown(),
    ]);
    const known = new Set(allFiles);
    const backlinks = new Map<string, string[]>();
    const deadLinks: Array<{ source: string; target: string }> = [];
    for (const source of allFiles) {
      const raw = await readFile(resolveInside(this.root, source), 'utf8');
      for (const link of extractMarkdownLinks(raw)) {
        const target = resolveMarkdownLink(source, link);
        if (!target || !known.has(target)) deadLinks.push({ source, target: link });
        else backlinks.set(target, unique([...(backlinks.get(target) ?? []), source]));
      }
    }
    const now = Date.now();
    const pendingCandidates = candidates.filter((item) => item.meta.status === 'pending').map((item) => item.meta.id);
    const conflicts = memories.filter((item) => item.meta.status === 'conflicted').map((item) => item.meta.id);
    const expired = memories.filter((item) => item.meta.status === 'active' && item.meta.expiresAt && Date.parse(item.meta.expiresAt) <= now).map((item) => item.meta.id);
    const orphans = memories.filter((item) => !backlinks.has(item.path)).map((item) => item.path);
    return {
      healthy: conflicts.length === 0 && expired.length === 0 && deadLinks.length === 0,
      counts: {
        evidence: evidence.length,
        candidates: candidates.length,
        activeMemories: memories.filter((item) => item.meta.status === 'active').length,
      },
      pendingCandidates,
      conflicts,
      expired,
      deadLinks,
      orphans,
    };
  }

  async history(limit = 20, path?: string): Promise<Array<Record<string, string>>> {
    this.assertInitialized();
    return this.git.history(Math.max(1, Math.min(limit, 100)), path);
  }

  private async promoteCandidate(
    candidate: MarkdownDocument<CandidateMeta>,
    superseded: Array<MarkdownDocument<MemoryMeta>>,
    reviewed: boolean,
  ): Promise<MarkdownDocument<MemoryMeta>> {
    const statement = candidateStatement(candidate.body);
    const memoryId = `mem-${shortId(`${candidate.meta.scope}\0${candidate.meta.kind}\0${candidate.meta.key}\0${statement}`)}`;
    const memoryPath = `wiki/${candidate.meta.scope}/${candidate.meta.kind}/${slugify(candidate.meta.key)}-${memoryId.slice(-6)}.md`;
    const timestamp = nowIso();
    for (const old of superseded) {
      old.meta.status = 'superseded';
      old.meta.supersededBy = memoryPath;
      old.meta.updatedAt = timestamp;
      old.meta.revision += 1;
      await this.writeDocument(old);
    }
    const meta: MemoryMeta = {
      id: memoryId,
      type: 'memory',
      createdAt: timestamp,
      updatedAt: timestamp,
      validatedAt: timestamp,
      kind: candidate.meta.kind,
      key: candidate.meta.key,
      scope: candidate.meta.scope,
      sensitivity: candidate.meta.sensitivity,
      confidence: reviewed ? 1 : candidate.meta.confidence,
      status: 'active',
      evidence: candidate.meta.evidence,
      conditions: candidate.meta.conditions,
      tags: candidate.meta.tags,
      ...(candidate.meta.expiresAt ? { expiresAt: candidate.meta.expiresAt } : {}),
      revision: 1,
      ...(superseded.length > 0 ? { supersedes: superseded.map((item) => item.path) } : {}),
    };
    const body = memoryBody(meta, statement, memoryPath);
    const memory = { path: memoryPath, meta, body };
    await this.writeDocument(memory);
    candidate.meta.status = 'promoted';
    candidate.meta.promotedTo = memoryPath;
    candidate.meta.updatedAt = timestamp;
    candidate.meta.conflictsWith = [];
    await this.writeDocument(candidate);
    return memory;
  }

  private async rebuildGenerated(config: VaultConfig): Promise<void> {
    const memories = existsSync(join(this.root, 'wiki')) ? await this.readDirectory<MemoryMeta>('wiki') : [];
    const candidates = existsSync(join(this.root, 'candidates')) ? await this.readDirectory<CandidateMeta>('candidates') : [];
    const now = Date.now();
    const active = memories.filter((memory) =>
      memory.meta.status === 'active' && (!memory.meta.expiresAt || Date.parse(memory.meta.expiresAt) > now),
    );
    const resident = active
      .filter((memory) => !['sensitive', 'secret'].includes(memory.meta.sensitivity))
      .sort((a, b) => residentRank(a) - residentRank(b) || b.meta.confidence - a.meta.confidence || b.meta.updatedAt.localeCompare(a.meta.updatedAt))
      .slice(0, config.residentBudget);
    const memoryLines = resident.map((memory) => `- [${memory.meta.key}](./${memory.path}): ${candidateStatement(memory.body)}`);
    const memoryDoc = [
      '# Resident memory',
      '',
      '> Auto-generated. Stable, frequently useful facts only; sensitive and secret entries are excluded.',
      '',
      ...(memoryLines.length > 0 ? memoryLines : ['_No approved resident memories yet._']),
      '',
    ].join('\n');
    await writeText(join(this.root, 'MEMORY.md'), memoryDoc);

    const rows = memories
      .sort((a, b) => a.meta.scope.localeCompare(b.meta.scope) || a.meta.key.localeCompare(b.meta.key))
      .map((memory) => `| [${escapeTable(memory.meta.key)}](./${memory.path}) | ${memory.meta.scope} | ${memory.meta.kind} | ${memory.meta.status} | ${memory.meta.confidence.toFixed(2)} |`);
    const pending = candidates.filter((candidate) => candidate.meta.status === 'pending');
    const indexDoc = [
      '# Memory index',
      '',
      '> Auto-generated from canonical Markdown. The Wiki files remain the source of truth.',
      '',
      '| Memory | Scope | Kind | Status | Confidence |',
      '| --- | --- | --- | --- | ---: |',
      ...(rows.length > 0 ? rows : ['| _None_ |  |  |  |  |']),
      '',
      `Pending candidates: ${pending.length}.`,
      ...(pending.length > 0 ? ['', ...pending.map((candidate) => `- [${candidate.meta.id}](./${candidate.path}): ${candidate.meta.key}`)] : []),
      '',
    ].join('\n');
    await writeText(join(this.root, 'INDEX.md'), indexDoc);
  }

  private async appendLog(action: string, actor: Actor, detail: string): Promise<void> {
    await appendText(join(this.root, 'log.md'), `\n- ${nowIso()} \`${action}\` by \`${actor.id}\`: ${detail.replaceAll('\n', ' ')}\n`);
  }

  private async installAgentInstructions(): Promise<void> {
    const path = join(this.root, 'AGENTS.md');
    const instructions = agentInstructions();
    if (!existsSync(path)) {
      await writeText(path, instructions);
      return;
    }
    const existing = await readFile(path, 'utf8');
    if (!existing.includes('<!-- AGENT_MEMORY_WIKI_START -->')) {
      await appendText(path, `\n\n${instructions}`);
    }
  }

  private async writeDocument<T extends object>(document: MarkdownDocument<T>): Promise<void> {
    await writeText(resolveInside(this.root, document.path), serializeMarkdown(document.meta, document.body));
  }

  private async readDocument<T extends object>(rootPath: string): Promise<MarkdownDocument<T>> {
    const content = await readFile(resolveInside(this.root, rootPath), 'utf8');
    const parsed = parseMarkdown<T>(content);
    return { path: toPosix(rootPath), meta: parsed.meta, body: parsed.body };
  }

  private async readDirectory<T extends object>(directory: string): Promise<Array<MarkdownDocument<T>>> {
    const files = await listMarkdown(resolveInside(this.root, directory));
    const documents: Array<MarkdownDocument<T>> = [];
    for (const file of files) {
      try {
        const rootPath = toPosix(relative(this.root, file));
        documents.push(await this.readDocument<T>(rootPath));
      } catch {
        // Keep the runtime available when a human is midway through editing a page.
      }
    }
    return documents;
  }

  private async findById<T extends object>(directory: string, id: string): Promise<MarkdownDocument<T> | null> {
    const documents = await this.readDirectory<T>(directory);
    return documents.find((document) => (document.meta as { id?: unknown }).id === id) ?? null;
  }

  private async requireById<T extends object>(directory: string, id: string): Promise<MarkdownDocument<T>> {
    const document = await this.findById<T>(directory, id);
    if (!document) throw new Error(`${directory} document not found: ${id}`);
    return document;
  }

  private async listAllMarkdown(): Promise<string[]> {
    const nested = (
      await Promise.all(['evidence', 'candidates', 'wiki'].map(async (directory) => {
        const path = join(this.root, directory);
        return existsSync(path) ? (await listMarkdown(path)).map((file) => toPosix(relative(this.root, file))) : [];
      }))
    ).flat();
    for (const name of ['MEMORY.md', 'INDEX.md', 'log.md']) {
      if (existsSync(join(this.root, name))) nested.push(name);
    }
    return nested;
  }

  private assertInitialized(): void {
    if (!existsSync(join(this.root, 'agent-memory.json'))) {
      throw new Error(`Not an Agent Memory Wiki vault: ${this.root}. Run "amem init" first.`);
    }
  }
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

function validateProposal(proposal: ProposedMemory): void {
  if (!proposal.statement.trim()) throw new Error('Memory statement cannot be empty');
  if (!proposal.key.trim()) throw new Error('Memory key cannot be empty');
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
    throw new Error('Confidence must be between 0 and 1');
  }
  if (proposal.expiresAt && Number.isNaN(Date.parse(proposal.expiresAt))) throw new Error('expiresAt must be an ISO date');
}

function candidateBody(meta: CandidateMeta, statement: string): string {
  const evidence = meta.evidence.length > 0 ? meta.evidence.map((path) => `- [${basename(path)}](${relativeLink(`candidates/${meta.id}.md`, path)})`) : ['- _No evidence attached; manual review required._'];
  return [`# Candidate: ${meta.key}`, '', statement.trim(), '', '## Evidence', '', ...evidence].join('\n');
}

function memoryBody(meta: MemoryMeta, statement: string, memoryPath: string): string {
  const conditions = meta.conditions.length > 0 ? meta.conditions.map((condition) => `- ${condition}`) : ['- Always, unless superseded or expired.'];
  const evidence = meta.evidence.length > 0 ? meta.evidence.map((path) => `- [${basename(path)}](${relativeLink(memoryPath, path)})`) : ['- _Approved explicitly without attached evidence._'];
  return [
    `# ${meta.key}`,
    '',
    statement.trim(),
    '',
    '## Applies when',
    '',
    ...conditions,
    '',
    '## Evidence',
    '',
    ...evidence,
  ].join('\n');
}

function relativeLink(from: string, to: string): string {
  const value = posix.relative(posix.dirname(from), to);
  return value.startsWith('.') ? value : `./${value}`;
}

function candidateStatement(body: string): string {
  return body.replace(/^#\s+[^\n]+\n+/, '').split(/\n##\s+/)[0]?.trim() ?? body.trim();
}

function normalizeStatement(body: string): string {
  return candidateStatement(body).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function residentRank(memory: MarkdownDocument<MemoryMeta>): number {
  return ({ preference: 0, fact: 1, decision: 2, procedure: 3, episode: 4 } as const)[memory.meta.kind];
}

function resolveMarkdownLink(source: string, target: string): string | null {
  const clean = target.split('#')[0];
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  const resolved = clean.startsWith('/') ? posix.normalize(clean.slice(1)) : posix.normalize(posix.join(posix.dirname(source), clean));
  return resolved.startsWith('../') ? null : resolved;
}

function escapeTable(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

function agentInstructions(): string {
  return `<!-- AGENT_MEMORY_WIKI_START -->
# Agent Memory Wiki instructions

This folder is a durable, Git-versioned memory vault. Read \`MEMORY.md\` first, then use search for long-tail details.

## Invariants

- \`evidence/\` is immutable evidence. Never edit or delete captured files.
- \`candidates/\` is a review queue. Do not treat pending candidates as truth.
- \`wiki/\` contains canonical memories. Respect scope, sensitivity, status, conditions, and expiry.
- Use \`amem capture/propose/consolidate/approve/forget\` or the MCP tools for writes so Git attribution and indexes stay correct.
- Never expose \`sensitive\` or \`secret\` entries unless the current request is authorized for them.
- Conflicts stay visible until a human or authorized agent approves a replacement.
- A single anecdote must not become a general procedure.

## Retrieval

Call \`memory_context\` with the current question. It returns the small resident set plus ranked Wiki pages and one-hop links. Cite returned paths when using a memory.
<!-- AGENT_MEMORY_WIKI_END -->
`;
}
