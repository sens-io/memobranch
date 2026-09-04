import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, join, posix, relative, resolve } from 'node:path';
import { OperationsTelemetry } from './audit.js';
import { defaultVaultConfig, migrateVaultConfig, readVaultConfig } from './config.js';
import { assertManagedDocument } from './document-schema.js';
import { EncryptionManager, isEncryptedEnvelope, type EncryptedEnvelopeMeta } from './encryption.js';
import { AgentMemoryError } from './errors.js';
import { asEvidenceDocument, evidenceDigest, evidenceDigestVersion } from './evidence.js';
import { GitStore, validateRemote, type RemoteStatus } from './git-store.js';
import { LlmClient } from './llm.js';
import { extractMarkdownLinks, parseMarkdown, serializeMarkdown } from './markdown.js';
import { assertTenant, authorize, localAdminPrincipal, type Permission, type Principal } from './policy.js';
import { PersistentSearchIndex, type ReindexResult, type SearchOptions, type SearchResult } from './search.js';
import { pendingTransactionCount, recoverTransactions, type RecoveryResult, VaultTransaction } from './transaction.js';
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
import { scopes, sensitivities } from './types.js';
import { nowIso, resolveInside, sha256, shortId, slugify, unique, withFileLock, writeText } from './utils.js';

export interface MemoryVaultOptions {
  llm?: LlmClient;
  principal?: Principal;
  masterKey?: string;
}

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

interface ErasureIntent {
  version: 1;
  id: string;
  path: string;
  scope: Scope;
  createdAt: string;
  requestedAt: string;
  actor: Actor;
  reasonSha256?: string;
}

export class MemoryVault {
  readonly root: string;
  readonly git: GitStore;
  readonly llm: LlmClient;
  readonly principal: Principal;
  readonly encryption: EncryptionManager;
  readonly telemetry: OperationsTelemetry;
  private readonly journalKey: string | undefined;
  private activeTransaction: VaultTransaction | null = null;
  private activePermission: Permission | null = null;
  private cachedSearchIndex: { signature: string; value: PersistentSearchIndex } | null = null;

  constructor(root = process.cwd(), options: MemoryVaultOptions | LlmClient = {}) {
    this.root = resolve(root);
    const normalized = options instanceof LlmClient ? { llm: options } : options;
    this.llm = normalized.llm ?? new LlmClient();
    this.principal = normalized.principal ?? localAdminPrincipal();
    this.git = new GitStore(this.root);
    this.journalKey = normalized.masterKey ?? process.env.AMEM_MASTER_KEY;
    this.encryption = new EncryptionManager(this.root, this.journalKey);
    this.telemetry = new OperationsTelemetry(this.root);
  }

  async initialize(name = basename(this.root)): Promise<{ created: boolean; commit: string | null }> {
    authorize(this.principal, 'maintain', { tenantId: this.principal.tenantId ?? 'local-admin' });
    await mkdir(this.root, { recursive: true });
    return withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const configPath = join(this.root, 'agent-memory.json');
      if (existsSync(configPath)) {
        await this.config();
        await this.git.initialize();
        return { created: false, commit: null };
      }
      const timestamp = nowIso();
      const config = defaultVaultConfig(name, `vault-${shortId()}`, timestamp);
      if (this.principal.tenantId) config.tenantId = this.principal.tenantId;
      await Promise.all(['.amem', 'evidence', 'candidates', 'wiki'].map((directory) => mkdir(join(this.root, directory), { recursive: true })));
      await this.git.initialize();
      const transaction = await VaultTransaction.begin(
        this.root,
        this.git,
        this.principal,
        'init: create agent memory vault',
        this.journalKey,
        config.policy.requireEncryptionFor,
      );
      this.activeTransaction = transaction;
      this.activePermission = 'maintain';
      let ready = false;
      let commit: string | null;
      try {
        await this.writeManaged('agent-memory.json', `${JSON.stringify(config, null, 2)}\n`);
        await this.installAgentInstructions();
        await this.installRuntimeIgnore();
        await this.writeManaged('log.md', '# Memory log\n\nAppend-only audit journal for memory operations.\n');
        await this.rebuildGenerated(config);
        await this.appendManaged('log.md', `\n- ${timestamp} \`init\` by \`${this.principal.id}\`: initialized vault ${config.vaultId}\n`);
        ready = true;
        commit = await transaction.commit();
      } catch (error) {
        if (!ready) await transaction.rollback();
        throw error;
      } finally {
        this.activeTransaction = null;
        this.activePermission = null;
      }
      await this.reindex(false);
      return { created: true, commit };
    });
  }

  async config(): Promise<VaultConfig> {
    this.assertInitialized();
    const config = await readVaultConfig(this.root);
    assertTenant(this.principal, config.tenantId);
    return config;
  }

  async migrate(): Promise<{ migrated: boolean; encrypted: number; evidenceDigests: number; commit: string | null }> {
    this.assertInitialized();
    const original = JSON.parse(await readFile(join(this.root, 'agent-memory.json'), 'utf8')) as { version?: unknown };
    await this.git.initialize();
    const initialIntegrity = await this.git.integrity();
    if (initialIntegrity.head && initialIntegrity.dirty) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Commit or discard managed changes before migration');
    }
    const result = await this.withMutation('maintain', this.principal, 'migrate', 'maintenance: migrate vault', async () => {
      const migration = await migrateVaultConfig(this.root, (path, content) => this.writeManaged(path, content));
      let encrypted = 0;
      let evidenceDigests = 0;
      for (const directory of ['evidence', 'candidates', 'wiki']) {
        for (const file of await listMarkdown(resolveInside(this.root, directory))) {
          const path = toPosix(relative(this.root, file));
          const raw = await readFile(file, 'utf8');
          const outer = parseMarkdown<Record<string, unknown>>(raw);
          const document = await this.materializeDocument<Record<string, unknown>>(path, outer, {
            allowLegacyEvidence: true,
            allowPlaintextRequiredEncryption: true,
            config: migration.config,
          });
          let changed = false;
          if (path.startsWith('evidence/') && evidenceDigestVersion(document, { allowLegacyEvidence: true }) === 1) {
            const id = String(document.meta.id);
            const prefix = `# Evidence ${id}\n\n`;
            const legacySha256 = String(document.meta.sha256);
            document.meta.sha256 = evidenceDigest(
              scopeOf(document.meta),
              sensitivityOf(document.meta),
              typeof document.meta.sourceUri === 'string' ? document.meta.sourceUri : '',
              document.body.slice(prefix.length),
            );
            document.meta.digestVersion = 2;
            document.meta.legacySha256 = legacySha256;
            evidenceDigests += 1;
            changed = true;
          }
          const sensitivity = sensitivityOf(document.meta);
          if (migration.config.policy.requireEncryptionFor.includes(sensitivity) && !isEncryptedEnvelope(outer.meta)) {
            await this.writeDocument(document);
            encrypted += 1;
            changed = false;
          }
          if (changed) await this.writeDocument(document);
        }
      }
      await this.appendLog('migrate', this.principal, `config=${migration.migrated}; encrypted=${encrypted}; evidence-digests=${evidenceDigests}`);
      return { migrated: migration.migrated || original.version === 1 || encrypted > 0 || evidenceDigests > 0, encrypted, evidenceDigests };
    }, undefined, { allowLegacyEvidence: true, allowPlaintextRequiredEncryption: true });
    return { ...result.value, commit: result.commit };
  }

  async capture(options: CaptureOptions): Promise<CaptureResult> {
    this.assertInitialized();
    const config = await this.config();
    const content = options.content.trim();
    if (!content) throw new AgentMemoryError('VALIDATION_FAILED', 'Evidence content cannot be empty');
    if (content.length > config.limits.maxContentCharacters) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Evidence exceeds the configured content limit');
    const actor = options.actor ?? this.principal;
    const scope = options.scope ?? 'user';
    const sensitivity = options.sensitivity ?? 'internal';
    authorize(this.principal, 'write', { scope, sensitivity, tenantId: config.tenantId });
    const digest = evidenceDigest(scope, sensitivity, options.sourceUri ?? '', content);
    const evidenceId = `ev-${digest.slice(0, 12)}`;

    const mutation = await this.withMutation('write', actor, 'capture', `memory: capture ${evidenceId}`, async () => {
      const existing = await this.findById<EvidenceMeta>('evidence', evidenceId);
      if (existing) return { evidence: existing, duplicate: true };
      const timestamp = nowIso();
      const day = timestamp.slice(0, 10).replaceAll('-', '/');
      const path = `evidence/${day}/${timestamp.replaceAll(':', '').replaceAll('.', '')}-${evidenceId}.md`;
      const meta: EvidenceMeta = {
        id: evidenceId,
        type: 'evidence',
        createdAt: timestamp,
        actor: actor.id,
        ...(options.sourceUri ? { sourceUri: options.sourceUri } : {}),
        scope,
        sensitivity,
        sha256: digest,
        digestVersion: 2,
        immutable: true,
      };
      const evidence = { path, meta, body: `# Evidence ${evidenceId}\n\n${content}` };
      await this.writeDocument(evidence);
      await this.appendLog('capture', actor, `${evidenceId} (${scope}/${sensitivity})`);
      return { evidence, duplicate: false };
    });

    let candidates: Array<{ id: string; path: string }> = [];
    let commit = mutation.commit;
    if (options.extract) {
      const extracted = await this.extract(mutation.value.evidence.meta.id, actor);
      candidates = extracted.candidates;
      commit = extracted.commit ?? commit;
    }
    return { evidenceId, evidencePath: mutation.value.evidence.path, duplicate: mutation.value.duplicate, candidates, commit };
  }

  async extract(evidenceId: string, actor: Actor = this.principal): Promise<{ candidates: Array<{ id: string; path: string }>; commit: string | null }> {
    this.assertInitialized();
    await this.config();
    authorize(this.principal, 'write');
    const evidence = await this.requireById<EvidenceMeta>('evidence', evidenceId);
    const proposals = await this.llm.extractMemories(evidence.body, { scope: evidence.meta.scope, sensitivity: evidence.meta.sensitivity });
    return this.proposeMany(proposals, [evidence.path], actor, `extract ${evidenceId}`);
  }

  async propose(proposal: ProposedMemory, evidence: string[] = [], actor: Actor = this.principal): Promise<{ id: string; path: string; duplicate: boolean; commit: string | null }> {
    const result = await this.proposeMany([proposal], evidence, actor, 'propose candidate');
    const first = result.candidates[0];
    if (!first) throw new AgentMemoryError('VALIDATION_FAILED', 'No candidate was created');
    return { ...first, duplicate: result.duplicates.includes(first.id), commit: result.commit };
  }

  private async proposeMany(
    proposals: ProposedMemory[],
    evidence: string[],
    actor: Actor,
    logDetail: string,
  ): Promise<{ candidates: Array<{ id: string; path: string }>; duplicates: string[]; commit: string | null }> {
    this.assertInitialized();
    const config = await this.config();
    const normalizedEvidence: string[] = [];
    const evidenceRestrictions: Array<{ scope: Scope; sensitivity: Sensitivity }> = [];
    for (const path of evidence) {
      const absolute = resolveInside(this.root, path);
      if (!existsSync(absolute)) throw new AgentMemoryError('NOT_FOUND', `Evidence path does not exist: ${path}`);
      const rootPath = toPosix(relative(this.root, absolute));
      if (!rootPath.startsWith('evidence/')) throw new AgentMemoryError('VALIDATION_FAILED', `Provenance must point into evidence/: ${path}`);
      const source = await this.readDocument<Record<string, unknown>>(rootPath);
      if (source.meta.type !== 'evidence' || source.meta.immutable !== true) throw new AgentMemoryError('VALIDATION_FAILED', `Provenance is not immutable evidence: ${path}`);
      normalizedEvidence.push(rootPath);
      evidenceRestrictions.push({ scope: scopeOf(source.meta), sensitivity: sensitivityOf(source.meta) });
    }
    const mutation = await this.withMutation('write', actor, 'propose', `memory: ${logDetail}`, async () => {
      const created: Array<{ id: string; path: string }> = [];
      const duplicates: string[] = [];
      for (const proposal of proposals) {
        const constrained = constrainToEvidence(proposal, evidenceRestrictions);
        validateProposal(constrained, config.limits.maxContentCharacters);
        authorize(this.principal, 'write', { scope: constrained.scope, sensitivity: constrained.sensitivity, tenantId: config.tenantId });
        const signature = `${constrained.scope}\0${constrained.kind}\0${constrained.key}\0${constrained.statement}\0${[...normalizedEvidence].sort().join('\0')}`;
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
          kind: constrained.kind,
          key: constrained.key.trim(),
          scope: constrained.scope,
          sensitivity: constrained.sensitivity,
          confidence: constrained.confidence,
          explicit: constrained.explicit,
          status: 'pending',
          evidence: unique(normalizedEvidence),
          conditions: unique(constrained.conditions),
          tags: unique(constrained.tags),
          ...(constrained.expiresAt ? { expiresAt: constrained.expiresAt } : {}),
          conflictsWith: [],
        };
        await this.writeDocument({ path, meta, body: candidateBody(meta, constrained.statement) });
        created.push({ id, path });
      }
      if (created.length > duplicates.length) await this.appendLog('propose', actor, `source=${safeLogToken(logDetail)}; count=${created.length - duplicates.length}`);
      return { candidates: created, duplicates };
    });
    return { ...mutation.value, commit: mutation.commit };
  }

  async consolidate(actor: Actor = this.principal): Promise<ConsolidationResult> {
    this.assertInitialized();
    const mutation = await this.withMutation('review', actor, 'consolidate', 'memory: consolidate candidates', async () => {
      const config = await this.config();
      const candidates = (await this.readDirectory<CandidateMeta>('candidates')).filter((document) => document.meta.status === 'pending');
      const memories = (await this.readDirectory<MemoryMeta>('wiki')).filter((document) => document.meta.type === 'memory');
      const result: Omit<ConsolidationResult, 'commit'> = { promoted: [], merged: [], conflicts: [], deferred: [] };
      let changed = false;
      for (const candidate of candidates) {
        await this.assertEvidenceReferences(candidate.meta.evidence);
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
        if (!enoughEvidence || (!candidate.meta.explicit && !enoughConfidence)) {
          result.deferred.push(candidate.meta.id);
          continue;
        }
        const memory = await this.promoteCandidate(candidate, [], false);
        memories.push(memory);
        result.promoted.push(candidate.meta.id);
        changed = true;
      }
      if (changed) await this.appendLog('consolidate', actor, `promoted=${result.promoted.length}, merged=${result.merged.length}, conflicts=${result.conflicts.length}, deferred=${result.deferred.length}`);
      return result;
    });
    return { ...mutation.value, commit: mutation.commit };
  }

  async approve(candidateId: string, actor: Actor = this.principal): Promise<{ memoryId: string; memoryPath: string; commit: string | null }> {
    this.assertInitialized();
    const mutation = await this.withMutation('review', actor, 'approve', `memory: approve ${safeLogToken(candidateId)}`, async () => {
      const candidate = await this.requireById<CandidateMeta>('candidates', candidateId);
      await this.assertEvidenceReferences(candidate.meta.evidence);
      if (candidate.meta.status === 'rejected') throw new AgentMemoryError('VALIDATION_FAILED', `Candidate ${candidateId} was rejected`);
      if (candidate.meta.status === 'promoted' && candidate.meta.promotedTo) {
        const existing = await this.readDocument<MemoryMeta>(candidate.meta.promotedTo);
        return { memoryId: existing.meta.id, memoryPath: existing.path };
      }
      const memories = (await this.readDirectory<MemoryMeta>('wiki')).filter((document) => document.meta.type === 'memory');
      const conflicts = memories.filter((memory) =>
        ['active', 'conflicted'].includes(memory.meta.status) && memory.meta.scope === candidate.meta.scope &&
        memory.meta.kind === candidate.meta.kind && normalizeKey(memory.meta.key) === normalizeKey(candidate.meta.key),
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
        await this.appendLog('approve', actor, `${candidateId} -> ${same.meta.id}; merged=true`);
        return { memoryId: same.meta.id, memoryPath: same.path };
      }
      const memory = await this.promoteCandidate(candidate, conflicts, true);
      await this.appendLog('approve', actor, `${candidateId} -> ${memory.meta.id}; superseded=${conflicts.length}`);
      return { memoryId: memory.meta.id, memoryPath: memory.path };
    });
    return { ...mutation.value, commit: mutation.commit };
  }

  async reject(candidateId: string, reason: string, actor: Actor = this.principal): Promise<{ commit: string | null }> {
    this.assertInitialized();
    if (!reason.trim()) throw new AgentMemoryError('VALIDATION_FAILED', 'A rejection reason is required');
    const mutation = await this.withMutation('review', actor, 'reject', `memory: reject ${safeLogToken(candidateId)}`, async () => {
      const candidate = await this.requireById<CandidateMeta>('candidates', candidateId);
      if (candidate.meta.status === 'promoted') throw new AgentMemoryError('VALIDATION_FAILED', `Candidate ${candidateId} was already promoted`);
      if (candidate.meta.status === 'rejected' && candidate.meta.rejectionReason === reason.trim()) return;
      candidate.meta.status = 'rejected';
      candidate.meta.rejectionReason = reason.trim();
      candidate.meta.updatedAt = nowIso();
      await this.writeDocument(candidate);
      const memories = (await this.readDirectory<MemoryMeta>('wiki')).filter((memory) =>
        memory.meta.type === 'memory' && memory.meta.status === 'conflicted' &&
        memory.meta.scope === candidate.meta.scope && memory.meta.kind === candidate.meta.kind &&
        normalizeKey(memory.meta.key) === normalizeKey(candidate.meta.key));
      const remaining = (await this.readDirectory<CandidateMeta>('candidates')).filter((other) =>
        other.meta.id !== candidate.meta.id && other.meta.status === 'pending' &&
        other.meta.scope === candidate.meta.scope && other.meta.kind === candidate.meta.kind &&
        normalizeKey(other.meta.key) === normalizeKey(candidate.meta.key));
      if (remaining.length === 0) {
        for (const memory of memories) {
          memory.meta.status = 'active';
          memory.meta.updatedAt = candidate.meta.updatedAt;
          memory.meta.validatedAt = candidate.meta.updatedAt;
          memory.meta.revision += 1;
          await this.writeDocument(memory);
        }
      }
      await this.appendLog('reject', actor, `${candidateId}; reason-recorded=true`);
    });
    return { commit: mutation.commit };
  }

  async forget(selector: string, reason: string, actor: Actor = this.principal): Promise<{ memoryId: string; commit: string | null }> {
    this.assertInitialized();
    if (!reason.trim()) throw new AgentMemoryError('VALIDATION_FAILED', 'A revocation reason is required');
    const mutation = await this.withMutation('review', actor, 'forget', 'memory: revoke record', async () => {
      const memory = await this.findOneMemory(selector);
      const timestamp = nowIso();
      memory.meta.status = 'revoked';
      memory.meta.revokedAt = timestamp;
      memory.meta.revocationReason = reason.trim();
      memory.meta.updatedAt = timestamp;
      memory.meta.revision += 1;
      await this.writeDocument(memory);
      await this.appendLog('forget', actor, `${memory.meta.id}; reason-recorded=true`);
      return memory.meta.id;
    });
    return { memoryId: mutation.value, commit: mutation.commit };
  }

  async erase(selector: string, reason: string, actor: Actor = this.principal): Promise<{ memoryId: string; keyErased: boolean; commit: string | null }> {
    this.assertInitialized();
    const config = await this.config();
    authorize(this.principal, 'admin');
    if (!reason.trim()) throw new AgentMemoryError('VALIDATION_FAILED', 'An erasure reason is required');
    authorize(this.principal, 'admin', { tenantId: config.tenantId });
    return this.telemetry.operation('erase', this.principal, () => withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      await this.git.initialize();
      await recoverTransactions(this.root, this.git, this.journalKey);
      await this.recoverErasureIntentsLocked();
      const memory = await this.findOneMemory(selector);
      if (!config.policy.requireEncryptionFor.includes(memory.meta.sensitivity)) {
        throw new AgentMemoryError('VALIDATION_FAILED', 'Cryptographic erasure only applies to memory covered by the encryption policy');
      }
      const intent: ErasureIntent = {
        version: 1,
        id: memory.meta.id,
        path: memory.path,
        scope: memory.meta.scope,
        createdAt: memory.meta.createdAt,
        requestedAt: nowIso(),
        actor,
        reasonSha256: sha256(reason.trim()),
      };
      await this.persistErasureIntent(intent);
      const commit = await this.completeErasureIntentLocked(intent);
      await this.telemetry.gauge('wrapped_keys_last_erasure', 1);
      return { memoryId: intent.id, keyErased: true, commit };
    }), [auditSelector(selector)]);
  }

  async get(id: string): Promise<MarkdownDocument<Record<string, unknown>>> {
    this.assertInitialized();
    const config = await this.config();
    authorize(this.principal, 'read', { tenantId: config.tenantId });
    for (const directory of ['wiki', 'candidates', 'evidence']) {
      const found = await this.findById<Record<string, unknown>>(directory, id);
      if (found && found.meta.type !== 'memory-erased') return found;
    }
    throw new AgentMemoryError('NOT_FOUND', `Document not found: ${id}`);
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    return (await this.searchDetailed(query, options)).hits;
  }

  async searchDetailed(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    this.assertInitialized();
    const config = await this.config();
    authorize(this.principal, 'read', { tenantId: config.tenantId });
    const normalized = query.trim();
    if (!normalized) throw new AgentMemoryError('VALIDATION_FAILED', 'A search query is required');
    if (normalized.length > config.limits.maxQueryCharacters) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Search query exceeds the configured limit');
    const index = this.searchIndex(config);
    const result = await index.search(normalized, { ...options, principal: this.principal });
    if (result.indexRebuilt) await this.telemetry.increment('index_rebuilds');
    return result;
  }

  async reindex(semantic = false): Promise<ReindexResult> {
    this.assertInitialized();
    const config = await this.config();
    authorize(this.principal, 'maintain', { tenantId: config.tenantId });
    const result = await this.searchIndex(config).refresh({ semantic });
    if (result.rebuilt) await this.telemetry.increment('index_rebuilds');
    await this.telemetry.gauge('index_documents', result.documents);
    return result;
  }

  async context(query: string, options: SearchOptions & { maxCharacters?: number } = {}): Promise<string> {
    const config = await this.config();
    const residentMemories = (await this.readDirectory<MemoryMeta>('wiki'))
      .filter((memory) => memory.meta.type === 'memory' && memory.meta.status === 'active')
      .filter((memory) => !memory.meta.expiresAt || Date.parse(memory.meta.expiresAt) > Date.now())
      .filter((memory) => config.policy.residentSensitivities.includes(memory.meta.sensitivity))
      .filter((memory) => memory.meta.sensitivity !== 'sensitive' || options.includeSensitive === true)
      .filter((memory) => memory.meta.sensitivity !== 'secret' || options.includeSecret === true)
      .sort((a, b) => residentRank(a) - residentRank(b) || b.meta.confidence - a.meta.confidence || b.meta.updatedAt.localeCompare(a.meta.updatedAt))
      .slice(0, config.residentBudget);
    const residentLines = residentMemories.map((memory) => `- [${memory.meta.key}](${memory.path}): ${candidateStatement(memory.body)}`);
    const resident = ['# Resident memory', '', ...(residentLines.length ? residentLines : ['_No authorized resident memories._'])].join('\n');
    const hits = await this.search(query, options);
    const sections = hits.map((hit) => `## [${hit.path}]\n${hit.snippet}`);
    const context = `${resident.trim()}\n\n# Retrieved memory\n\n${sections.join('\n\n')}`;
    const maximum = Math.max(500, Math.min(options.maxCharacters ?? 12_000, config.limits.maxContextCharacters));
    return context.slice(0, maximum);
  }

  async answer(question: string, options: SearchOptions & { maxCharacters?: number } = {}): Promise<string> {
    return this.llm.answer(question, await this.context(question, options));
  }

  async recover(): Promise<RecoveryResult> {
    this.assertInitialized();
    authorize(this.principal, 'maintain');
    await this.config();
    return this.telemetry.operation('recover', this.principal, () => withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      const result = await recoverTransactions(this.root, this.git, this.journalKey);
      await this.recoverErasureIntentsLocked();
      if (result.rolledBack.length || result.replayed.length) {
        try { await this.reconcileAfterSync(); } catch (error) {
          if (!(error instanceof AgentMemoryError && error.code === 'CONFIG_VERSION_UNSUPPORTED')) throw error;
        }
      }
      return result;
    }));
  }

  async expireDue(actor: Actor = this.principal): Promise<{ expired: string[]; commit: string | null }> {
    this.assertInitialized();
    const mutation = await this.withMutation('maintain', actor, 'expire', 'maintenance: expire due memories', async () => {
      const expired: string[] = [];
      const timestamp = nowIso();
      for (const memory of await this.readDirectory<MemoryMeta>('wiki')) {
        if (memory.meta.status !== 'active' || !memory.meta.expiresAt || Date.parse(memory.meta.expiresAt) > Date.now()) continue;
        memory.meta.status = 'revoked';
        memory.meta.revokedAt = timestamp;
        memory.meta.revocationReason = 'Automatically revoked at configured expiry';
        memory.meta.updatedAt = timestamp;
        memory.meta.revision += 1;
        await this.writeDocument(memory);
        expired.push(memory.meta.id);
      }
      if (expired.length) await this.appendLog('expire', actor, `count=${expired.length}`);
      return expired;
    });
    return { expired: mutation.value, commit: mutation.commit };
  }

  async configureRemote(remote: VaultConfig['remote']): Promise<{ configured: boolean; commit: string | null }> {
    this.assertInitialized();
    authorize(this.principal, 'sync');
    return this.telemetry.operation('remote_configure', this.principal, async () => {
      if (remote) validateRemote(remote.name, remote.url);
      const current = await this.config();
      const snapshots = new Map<string, string | null>();
      let remoteChanged = false;
      try {
        const mutation = await this.withMutation('sync', this.principal, 'remote_config', 'config: update remote', async () => {
          for (const name of unique([current.remote?.name, remote?.name].filter((value): value is string => Boolean(value)))) {
            snapshots.set(name, await this.git.getRemoteUrl(name));
          }
          remoteChanged = true;
          if (remote) await this.git.configureRemote(remote.name, remote.url);
          if (current.remote && (!remote || current.remote.name !== remote.name)) await this.git.removeRemote(current.remote.name);
          const next = { ...(await this.config()), remote };
          await this.writeManaged('agent-memory.json', `${JSON.stringify(next, null, 2)}\n`);
          await this.appendLog('remote-config', this.principal, remote ? `${remote.name}/${remote.branch}; push=${remote.push}` : 'removed=true');
          return Boolean(remote);
        });
        return { configured: mutation.value, commit: mutation.commit };
      } catch (error) {
        if (remoteChanged && !(await this.remoteConfigMatches(remote))) {
          for (const [name, url] of snapshots) {
            if (url) await this.git.configureRemote(name, url);
            else await this.git.removeRemote(name);
          }
        }
        throw error;
      }
    });
  }

  async remoteStatus(fetch = true): Promise<RemoteStatus> {
    const config = await this.config();
    authorize(this.principal, 'sync', { tenantId: config.tenantId });
    if (!config.remote) return { configured: false, ahead: 0, behind: 0, diverged: false, conflicts: [], lastSuccessfulSync: null };
    return this.git.remoteStatus(config.remote.name, config.remote.branch, fetch);
  }

  async sync(options: { push?: boolean } = {}): Promise<RemoteStatus & { pushed: boolean; merged: boolean }> {
    const config = await this.config();
    authorize(this.principal, 'sync', { tenantId: config.tenantId });
    if (!config.remote) throw new AgentMemoryError('REMOTE_INVALID', 'No remote is configured');
    return this.telemetry.operation('remote_sync', this.principal, () => withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      await recoverTransactions(this.root, this.git, this.journalKey);
      const integrity = await this.git.integrity();
      if (!integrity.healthy) throw new AgentMemoryError('REMOTE_CONFLICT', 'Shadow Git repository failed integrity validation', { error: integrity.error });
      if (integrity.dirty) throw new AgentMemoryError('REMOTE_CONFLICT', 'Managed vault files contain uncommitted changes');
      const result = await this.git.sync(config.remote!.name, config.remote!.branch, {
        push: options.push ?? config.remote!.push,
        actor: this.principal,
        reconcile: async () => {
          try {
            await this.reconcileAfterSync();
          } catch (error) {
            throw new AgentMemoryError('REMOTE_CONFLICT', 'Synchronized vault failed canonical reconciliation', {
              causeCode: error instanceof AgentMemoryError ? error.code : 'VALIDATION_FAILED',
            });
          }
        },
        validate: () => this.validateManagedState(),
      });
      await this.reindex(false);
      return result;
    }));
  }

  async doctor(): Promise<DoctorReport> {
    this.assertInitialized();
    authorize(this.principal, 'maintain');
    let config: VaultConfig;
    try {
      config = await this.config();
    } catch (error) {
      if (!(error instanceof AgentMemoryError && ['CONFIG_VERSION_UNSUPPORTED', 'CONFIG_INVALID'].includes(error.code))) throw error;
      const [git, pending] = await Promise.all([this.git.integrity(), pendingTransactionCount(this.root)]);
      let version: number | undefined;
      try {
        const raw = JSON.parse(await readFile(join(this.root, 'agent-memory.json'), 'utf8')) as { version?: unknown };
        if (typeof raw.version === 'number') version = raw.version;
      } catch { /* The configuration error below is sufficient. */ }
      return {
        healthy: false,
        counts: { evidence: 0, candidates: 0, activeMemories: 0 },
        pendingCandidates: [], conflicts: [], expired: [], deadLinks: [], orphans: [],
        ...(version === undefined ? {} : { configVersion: version }),
        git,
        index: { healthy: false, documents: 0, error: 'Index validation skipped because configuration is invalid' },
        evidence: { healthy: false, errors: ['Evidence validation skipped because configuration is invalid'] },
        documents: { healthy: false, errors: ['Document validation skipped because configuration is invalid'] },
        recovery: { pending },
        configuration: { healthy: false, error: error.message },
      };
    }
    const [candidateScan, memoryScan, git, pending, evidenceIntegrity] = await Promise.all([
      this.scanDirectory<CandidateMeta>('candidates'),
      this.scanDirectory<MemoryMeta>('wiki'),
      this.git.integrity(),
      pendingTransactionCount(this.root),
      this.verifyEvidenceIntegrity(),
    ]);
    const evidence = evidenceIntegrity.documents;
    const candidates = candidateScan.documents;
    const memories = memoryScan.documents.filter((document) => document.meta.type === 'memory');
    const documentErrors = [...candidateScan.errors, ...memoryScan.errors];
    const managedDocuments: Array<MarkdownDocument<object>> = [...evidence, ...candidates, ...memoryScan.documents];
    documentErrors.push(...metadataReferenceErrors(managedDocuments));
    const documents = [...evidence, ...candidates, ...memories];
    const known = new Set(documents.map((document) => document.path));
    const backlinks = new Map<string, string[]>();
    const deadLinks: Array<{ source: string; target: string }> = [];
    for (const document of documents) {
      for (const link of extractMarkdownLinks(document.body)) {
        const target = resolveMarkdownLink(document.path, link);
        if (!target || !known.has(target)) deadLinks.push({ source: document.path, target: link });
        else backlinks.set(target, unique([...(backlinks.get(target) ?? []), document.path]));
      }
    }
    const now = Date.now();
    const pendingCandidates = candidates.filter((item) => item.meta.status === 'pending').map((item) => item.meta.id);
    const conflicts = memories.filter((item) => item.meta.status === 'conflicted').map((item) => item.meta.id);
    const expired = memories.filter((item) => item.meta.status === 'active' && item.meta.expiresAt && Date.parse(item.meta.expiresAt) <= now).map((item) => item.meta.id);
    const orphans = memories.filter((item) => !backlinks.has(item.path)).map((item) => item.path);
    let indexHealth: DoctorReport['index'];
    try {
      indexHealth = await this.searchIndex(config).health();
    } catch (error) {
      indexHealth = { healthy: false, documents: 0, error: error instanceof Error ? error.message : String(error) };
    }
    const healthy = conflicts.length === 0 && expired.length === 0 && deadLinks.length === 0 && git.healthy && pending === 0 && indexHealth.healthy && evidenceIntegrity.errors.length === 0 && documentErrors.length === 0;
    return {
      healthy,
      counts: { evidence: evidence.length, candidates: candidates.length, activeMemories: memories.filter((item) => item.meta.status === 'active').length },
      pendingCandidates,
      conflicts,
      expired,
      deadLinks,
      orphans,
      configVersion: config.version,
      git,
      index: indexHealth,
      evidence: { healthy: evidenceIntegrity.errors.length === 0, errors: evidenceIntegrity.errors },
      documents: { healthy: documentErrors.length === 0, errors: documentErrors },
      recovery: { pending },
      configuration: { healthy: true },
    };
  }

  async history(limit = 20, path?: string): Promise<Array<Record<string, string>>> {
    this.assertInitialized();
    const config = await this.config();
    authorize(this.principal, 'read', { tenantId: config.tenantId });
    const safePath = path ? toPosix(relative(this.root, resolveInside(this.root, path))) : undefined;
    const admin = this.principal.permissions.includes('admin');
    if (safePath && !admin && isCanonicalDocumentPath(safePath) && existsSync(resolveInside(this.root, safePath))) {
      await this.readDocument<Record<string, unknown>>(safePath);
    }
    const entries = await this.git.history(Math.max(1, Math.min(limit, 100)), safePath);
    return admin ? entries : entries.map((entry) => ({ ...entry, subject: '[redacted]' }));
  }

  private async withMutation<T>(
    permission: Permission,
    actor: Actor,
    operation: string,
    message: string,
    action: () => Promise<T>,
    resourceIds?: string[],
    options: { allowLegacyEvidence?: boolean; allowPlaintextRequiredEncryption?: boolean } = {},
  ): Promise<{ value: T; commit: string | null }> {
    authorize(this.principal, permission);
    const config = await this.config();
    return this.telemetry.operation(operation, this.principal, async () => withFileLock(join(this.root, '.amem', 'write.lock'), async () => {
      await this.git.initialize();
      await recoverTransactions(this.root, this.git, this.journalKey);
      await this.recoverErasureIntentsLocked();
      const evidenceIntegrity = await this.verifyEvidenceIntegrity(options);
      if (evidenceIntegrity.errors.length > 0) {
        throw new AgentMemoryError('VALIDATION_FAILED', 'Immutable evidence failed integrity validation', { errors: evidenceIntegrity.errors.slice(0, 20) });
      }
      const transaction = await VaultTransaction.begin(
        this.root,
        this.git,
        actor,
        message,
        this.journalKey,
        config.policy.requireEncryptionFor,
      );
      this.activeTransaction = transaction;
      this.activePermission = permission;
      let ready = false;
      try {
        await migrateVaultConfig(this.root, (path, content) => this.writeManaged(path, content));
        await this.installRuntimeIgnore();
        const value = await action();
        await this.rebuildGenerated(await this.config());
        ready = true;
        const commit = await transaction.commit();
        this.activeTransaction = null;
        this.activePermission = null;
        try {
          await this.reindex(false);
        } catch {
          this.cachedSearchIndex?.value.invalidate();
          this.cachedSearchIndex = null;
          await this.telemetry.increment('index_refresh_errors');
        }
        return { value, commit };
      } catch (error) {
        this.activeTransaction = null;
        this.activePermission = null;
        if (!ready) await transaction.rollback();
        throw error;
      }
    }), resourceIds);
  }

  private searchIndex(config: VaultConfig): PersistentSearchIndex {
    const signature = JSON.stringify({
      index: config.index,
      limits: config.limits,
      requireEncryptionFor: config.policy.requireEncryptionFor,
      tenantId: config.tenantId,
    });
    if (this.cachedSearchIndex?.signature === signature) return this.cachedSearchIndex.value;
    const value = new PersistentSearchIndex(this.root, config, this.llm, (path) => this.readDocument<Record<string, unknown>>(path));
    this.cachedSearchIndex = { signature, value };
    return value;
  }

  private async reconcileAfterSync(): Promise<void> {
    const config = await this.config();
    const transaction = await VaultTransaction.begin(
      this.root,
      this.git,
      this.principal,
      'sync: rebuild derived memory',
      this.journalKey,
      config.policy.requireEncryptionFor,
    );
    this.activeTransaction = transaction;
    this.activePermission = 'sync';
    let ready = false;
    try {
      await migrateVaultConfig(this.root, (path, content) => this.writeManaged(path, content));
      await this.installRuntimeIgnore();
      await this.rebuildGenerated(config);
      ready = true;
      await transaction.commit();
    } catch (error) {
      if (!ready) await transaction.rollback();
      throw error;
    } finally {
      this.activeTransaction = null;
      this.activePermission = null;
    }
    await this.searchIndex(await this.config()).refresh();
  }

  private async persistErasureIntent(intent: ErasureIntent): Promise<void> {
    await writeText(this.erasureIntentPath(intent.id), `${JSON.stringify(intent, null, 2)}\n`);
  }

  private async remoteConfigMatches(expected: VaultConfig['remote']): Promise<boolean> {
    try {
      const actual = (await readVaultConfig(this.root)).remote;
      return JSON.stringify(actual) === JSON.stringify(expected);
    } catch {
      return false;
    }
  }

  private async recoverErasureIntentsLocked(): Promise<string[]> {
    const directory = join(this.root, '.amem', 'erasures');
    if (!existsSync(directory)) return [];
    const completed: string[] = [];
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.json')).sort()) {
      let intent: ErasureIntent;
      try {
        intent = JSON.parse(await readFile(join(directory, name), 'utf8')) as ErasureIntent;
        if (intent.version !== 1 || !intent.id || !intent.path || !intent.scope || !intent.createdAt || !intent.actor?.id) throw new Error('Malformed erasure intent');
        if (intent.reasonSha256 !== undefined && !/^[a-f0-9]{64}$/.test(intent.reasonSha256)) throw new Error('Malformed erasure reason commitment');
        resolveInside(this.root, intent.path);
      } catch (error) {
        throw new AgentMemoryError('TRANSACTION_RECOVERY_FAILED', `Invalid erasure intent: ${name}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      await this.completeErasureIntentLocked(intent);
      completed.push(intent.id);
    }
    return completed;
  }

  private async completeErasureIntentLocked(intent: ErasureIntent): Promise<string | null> {
    await this.encryption.erase(intent.id);
    if (await this.encryption.hasKey(intent.id)) {
      throw new AgentMemoryError('ENCRYPTION_FAILED', `Unable to destroy the wrapped key for ${intent.id}`);
    }
    const config = await this.config();
    const transaction = await VaultTransaction.begin(
      this.root,
      this.git,
      intent.actor,
      `memory: cryptographically erase ${safeLogToken(intent.id)}`,
      this.journalKey,
      config.policy.requireEncryptionFor,
    );
    this.activeTransaction = transaction;
    this.activePermission = 'admin';
    let ready = false;
    try {
      const timestamp = nowIso();
      const tombstone = {
        id: intent.id,
        type: 'memory-erased',
        scope: intent.scope,
        sensitivity: 'internal' as const,
        status: 'revoked',
        createdAt: intent.createdAt,
        updatedAt: timestamp,
        erasedAt: timestamp,
        reasonRecorded: Boolean(intent.reasonSha256),
        ...(intent.reasonSha256 ? { reasonSha256: intent.reasonSha256 } : {}),
      };
      const tombstoneBody = `# Erased memory ${intent.id}\n\nThe encrypted payload and its wrapped data key were destroyed.`;
      const serializedTombstone = config.policy.requireEncryptionFor.includes(tombstone.sensitivity)
        ? serializeMarkdown(...encryptedParts(await this.encryption.encrypt(tombstone, tombstoneBody, `tombstone:${intent.id}`)))
        : serializeMarkdown(tombstone, tombstoneBody);
      await this.writeManaged(intent.path, serializedTombstone);
      await this.installRuntimeIgnore();
      await this.appendLog('erase', intent.actor, `${intent.id}; cryptographic-erasure=true`);
      await this.rebuildGenerated(config);
      ready = true;
      const commit = await transaction.commit();
      await rm(this.erasureIntentPath(intent.id), { force: true });
      return commit;
    } catch (error) {
      if (!ready) await transaction.rollback();
      throw error;
    } finally {
      this.activeTransaction = null;
      this.activePermission = null;
    }
  }

  private erasureIntentPath(id: string): string {
    return join(this.root, '.amem', 'erasures', `${safeLogToken(id)}.json`);
  }

  private async verifyEvidenceIntegrity(
    options: { allowLegacyEvidence?: boolean; allowPlaintextRequiredEncryption?: boolean } = {},
  ): Promise<{ errors: string[]; documents: Array<MarkdownDocument<EvidenceMeta>> }> {
    const errors: string[] = [];
    const documents: Array<MarkdownDocument<EvidenceMeta>> = [];
    for (const file of await listMarkdown(resolveInside(this.root, 'evidence'))) {
      const path = toPosix(relative(this.root, file));
      try {
        const parsed = parseMarkdown<Record<string, unknown>>(await readFile(file, 'utf8'));
        const document = await this.materializeDocument<Record<string, unknown>>(path, parsed, options);
        documents.push(asEvidenceDocument(document, options));
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { errors, documents };
  }

  private async assertEvidenceReferences(paths: readonly string[]): Promise<void> {
    for (const path of unique(paths)) {
      if (!path.startsWith('evidence/')) {
        throw new AgentMemoryError('VALIDATION_FAILED', `Candidate evidence reference is outside evidence/: ${path}`);
      }
      try {
        const document = await this.readDocument<Record<string, unknown>>(path);
        if (document.meta.type !== 'evidence' || document.meta.immutable !== true) throw new Error('not immutable evidence');
      } catch (error) {
        if (error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED') throw error;
        throw new AgentMemoryError('VALIDATION_FAILED', `Candidate evidence reference is invalid: ${path}`);
      }
    }
  }

  private async validateManagedState(): Promise<void> {
    try {
      const config = await readVaultConfig(this.root);
      assertTenant(this.principal, config.tenantId);
      for (const directory of ['evidence', 'candidates', 'wiki']) {
        for (const file of await listMarkdown(resolveInside(this.root, directory))) {
          await this.readDocument<Record<string, unknown>>(toPosix(relative(this.root, file)));
        }
      }
      const report = await this.doctor();
      if (!report.healthy) throw new AgentMemoryError('REMOTE_CONFLICT', 'Synchronized vault failed health validation', {
        conflicts: report.conflicts.length,
        expired: report.expired.length,
        deadLinks: report.deadLinks.length,
      });
    } catch (error) {
      if (error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT') throw error;
      throw new AgentMemoryError('REMOTE_CONFLICT', 'Synchronized vault failed canonical validation', {
        causeCode: error instanceof AgentMemoryError ? error.code : 'VALIDATION_FAILED',
      });
    }
  }

  private async findOneMemory(selector: string): Promise<MarkdownDocument<MemoryMeta>> {
    const memories = (await this.readDirectory<MemoryMeta>('wiki')).filter((document) => document.meta.type === 'memory');
    const matches = memories.filter((memory) => memory.meta.id === selector || normalizeKey(memory.meta.key) === normalizeKey(selector));
    if (matches.length === 0) throw new AgentMemoryError('NOT_FOUND', `Memory not found: ${selector}`);
    if (matches.length > 1) throw new AgentMemoryError('VALIDATION_FAILED', `Selector is ambiguous; use an id: ${matches.map((item) => item.meta.id).join(', ')}`);
    return matches[0]!;
  }

  private async promoteCandidate(candidate: MarkdownDocument<CandidateMeta>, superseded: Array<MarkdownDocument<MemoryMeta>>, reviewed: boolean): Promise<MarkdownDocument<MemoryMeta>> {
    const statement = candidateStatement(candidate.body);
    const id = `mem-${shortId(`${candidate.meta.scope}\0${candidate.meta.kind}\0${candidate.meta.key}\0${statement}`)}`;
    const config = await this.config();
    const filename = config.policy.requireEncryptionFor.includes(candidate.meta.sensitivity) ? id : `${slugify(candidate.meta.key)}-${id.slice(-6)}`;
    const path = `wiki/${candidate.meta.scope}/${candidate.meta.kind}/${filename}.md`;
    const timestamp = nowIso();
    for (const old of superseded) {
      old.meta.status = 'superseded';
      old.meta.supersededBy = path;
      old.meta.updatedAt = timestamp;
      old.meta.revision += 1;
      await this.writeDocument(old);
    }
    const meta: MemoryMeta = {
      id,
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
    const memory = { path, meta, body: memoryBody(meta, statement, path) };
    await this.writeDocument(memory);
    candidate.meta.status = 'promoted';
    candidate.meta.promotedTo = path;
    candidate.meta.updatedAt = timestamp;
    candidate.meta.conflictsWith = [];
    await this.writeDocument(candidate);
    return memory;
  }

  private async rebuildGenerated(config: VaultConfig): Promise<void> {
    const memories = existsSync(join(this.root, 'wiki')) ? (await this.readProjectionDirectory<MemoryMeta>('wiki')).filter((document) => document.meta.type === 'memory') : [];
    const candidates = existsSync(join(this.root, 'candidates')) ? await this.readProjectionDirectory<CandidateMeta>('candidates') : [];
    const now = Date.now();
    const safeMemories = memories.filter((memory) =>
      !isEncryptedEnvelope(memory.meta) && !config.policy.requireEncryptionFor.includes(memory.meta.sensitivity));
    const active = safeMemories.filter((memory) => memory.meta.status === 'active' && (!memory.meta.expiresAt || Date.parse(memory.meta.expiresAt) > now));
    const resident = active
      .filter((memory) => config.policy.residentSensitivities.includes(memory.meta.sensitivity))
      .sort((a, b) => residentRank(a) - residentRank(b) || b.meta.confidence - a.meta.confidence || b.meta.updatedAt.localeCompare(a.meta.updatedAt))
      .slice(0, config.residentBudget);
    const memoryLines = resident.map((memory) => `- [${memory.meta.key}](./${memory.path}): ${candidateStatement(memory.body)}`);
    await this.writeManaged('MEMORY.md', ['# Resident memory', '', '> Auto-generated. Stable, frequently useful facts only; confidential entries are excluded.', '', ...(memoryLines.length ? memoryLines : ['_No approved resident memories yet._']), ''].join('\n'));

    const rows = safeMemories
      .sort((a, b) => a.meta.scope.localeCompare(b.meta.scope) || a.meta.key.localeCompare(b.meta.key))
      .map((memory) => `| [${escapeTable(memory.meta.key)}](./${memory.path}) | ${memory.meta.scope} | ${memory.meta.kind} | ${memory.meta.status} | ${memory.meta.confidence.toFixed(2)} |`);
    const pending = candidates.filter((candidate) =>
      candidate.meta.status === 'pending' &&
      !isEncryptedEnvelope(candidate.meta) &&
      !config.policy.requireEncryptionFor.includes(candidate.meta.sensitivity));
    await this.writeManaged('INDEX.md', [
      '# Memory index', '', '> Auto-generated from canonical Markdown. Confidential records are intentionally omitted.', '',
      '| Memory | Scope | Kind | Status | Confidence |', '| --- | --- | --- | --- | ---: |',
      ...(rows.length ? rows : ['| _None_ |  |  |  |  |']), '', `Pending non-confidential candidates: ${pending.length}.`,
      ...(pending.length ? ['', ...pending.map((candidate) => `- [${candidate.meta.id}](./${candidate.path}): ${candidate.meta.key}`)] : []), '',
    ].join('\n'));
  }

  private async appendLog(action: string, actor: Actor, detail: string): Promise<void> {
    await this.appendManaged('log.md', `\n- ${nowIso()} \`${safeLogToken(action)}\` by \`${safeLogToken(actor.id)}\`: ${detail.replaceAll('\n', ' ').slice(0, 500)}\n`);
  }

  private async installAgentInstructions(): Promise<void> {
    const path = join(this.root, 'AGENTS.md');
    const instructions = agentInstructions();
    if (!existsSync(path)) return this.writeManaged('AGENTS.md', instructions);
    const existing = await readFile(path, 'utf8');
    if (!existing.includes('<!-- AGENT_MEMORY_WIKI_START -->')) await this.writeManaged('AGENTS.md', `${existing.trimEnd()}\n\n${instructions}`);
  }

  private async installRuntimeIgnore(): Promise<void> {
    const path = join(this.root, '.gitignore');
    const existing = existsSync(path) ? await readFile(path, 'utf8') : '';
    const ignoresRuntime = existing.split(/\r?\n/).some((line) => {
      const normalized = line.trim().replace(/^\//, '').replace(/\/$/, '');
      return normalized === '.amem';
    });
    if (ignoresRuntime) return;
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    await this.writeManaged('.gitignore', `${existing}${prefix}\n# MemoBranch local runtime state\n.amem/\n`);
  }

  private async writeManaged(path: string, content: string): Promise<void> {
    if (this.activeTransaction) await this.activeTransaction.write(path, content);
    else await writeText(resolveInside(this.root, path), content);
  }

  private async appendManaged(path: string, content: string): Promise<void> {
    if (this.activeTransaction) await this.activeTransaction.append(path, content);
    else {
      const absolute = resolveInside(this.root, path);
      const current = existsSync(absolute) ? await readFile(absolute, 'utf8') : '';
      await writeText(absolute, `${current}${content}`);
    }
  }

  private async writeDocument<T extends object>(document: MarkdownDocument<T>): Promise<void> {
    const sensitivity = sensitivityOf(document.meta as Record<string, unknown>);
    const scope = scopeOf(document.meta as Record<string, unknown>);
    authorize(this.principal, this.activePermission ?? 'write', { scope, sensitivity });
    const config = await readVaultConfig(this.root);
    const serialized = config.policy.requireEncryptionFor.includes(sensitivity)
      ? serializeMarkdown(...encryptedParts(await this.encryption.encrypt(document.meta, document.body)))
      : serializeMarkdown(document.meta, document.body);
    await this.writeManaged(document.path, serialized);
  }

  private async readDocument<T extends object>(rootPath: string): Promise<MarkdownDocument<T>> {
    const config = await readVaultConfig(this.root);
    assertTenant(this.principal, config.tenantId);
    const normalized = toPosix(relative(this.root, resolveInside(this.root, rootPath)));
    const parsed = parseMarkdown<Record<string, unknown>>(await readFile(resolveInside(this.root, normalized), 'utf8'));
    const scope = scopeOf(parsed.meta);
    const sensitivity = sensitivityOf(parsed.meta);
    authorize(this.principal, 'read', { scope, sensitivity });
    const document = await this.materializeDocument<T>(normalized, parsed, { config });
    const logicalMeta = document.meta as Record<string, unknown>;
    authorize(this.principal, 'read', { scope: scopeOf(logicalMeta), sensitivity: sensitivityOf(logicalMeta) });
    return document;
  }

  private async materializeDocument<T extends object>(
    path: string,
    parsed: { meta: Record<string, unknown>; body: string },
    options: { allowLegacyEvidence?: boolean; allowPlaintextRequiredEncryption?: boolean; config?: VaultConfig } = {},
  ): Promise<MarkdownDocument<T>> {
    const config = options.config ?? await readVaultConfig(this.root);
    const sensitivity = sensitivityOf(parsed.meta);
    if (config.policy.requireEncryptionFor.includes(sensitivity) && !isEncryptedEnvelope(parsed.meta) && !options.allowPlaintextRequiredEncryption) {
      throw new AgentMemoryError('ENCRYPTION_FAILED', `Confidential document is not encrypted: ${path}`);
    }
    let document: MarkdownDocument<Record<string, unknown>>;
    if (isEncryptedEnvelope(parsed.meta)) {
      const logical = await this.encryption.decrypt<Record<string, unknown>>(parsed.meta as EncryptedEnvelopeMeta, parsed.body);
      const logicalMeta = logical.meta;
      if (logicalMeta.id !== parsed.meta.id || logicalMeta.type !== parsed.meta.type || logicalMeta.scope !== parsed.meta.scope || logicalMeta.sensitivity !== parsed.meta.sensitivity) {
        throw new AgentMemoryError('ENCRYPTION_FAILED', `Encrypted envelope metadata mismatch for ${String(parsed.meta.id ?? 'unknown')}`);
      }
      document = { path, meta: logicalMeta, body: logical.body };
    } else {
      document = { path, meta: parsed.meta, body: parsed.body };
    }
    assertManagedDocument(document, options);
    return document as unknown as MarkdownDocument<T>;
  }

  private async readProjectionDirectory<T extends object>(directory: string): Promise<Array<MarkdownDocument<T>>> {
    const documents: Array<MarkdownDocument<T>> = [];
    for (const file of await listMarkdown(resolveInside(this.root, directory))) {
      const path = toPosix(relative(this.root, file));
      const parsed = parseMarkdown<Record<string, unknown>>(await readFile(file, 'utf8'));
      // Confidential documents are excluded before their body is used by generated
      // projections, so the minimal envelope is sufficient and needs no key.
      const document = { path, meta: parsed.meta, body: parsed.body };
      if (!isEncryptedEnvelope(parsed.meta)) assertManagedDocument(document);
      documents.push(document as unknown as MarkdownDocument<T>);
    }
    return documents;
  }

  private async readDirectory<T extends object>(directory: string): Promise<Array<MarkdownDocument<T>>> {
    const documents: Array<MarkdownDocument<T>> = [];
    for (const file of await listMarkdown(resolveInside(this.root, directory))) {
      try {
        documents.push(await this.readDocument<T>(toPosix(relative(this.root, file))));
      } catch (error) {
        if (error instanceof AgentMemoryError && error.code !== 'AUTHORIZATION_DENIED') throw error;
      }
    }
    return documents;
  }

  private async scanDirectory<T extends object>(directory: string): Promise<{ documents: Array<MarkdownDocument<T>>; errors: string[] }> {
    const documents: Array<MarkdownDocument<T>> = [];
    const errors: string[] = [];
    for (const file of await listMarkdown(resolveInside(this.root, directory))) {
      const path = toPosix(relative(this.root, file));
      try {
        documents.push(await this.readDocument<T>(path));
      } catch (error) {
        if (error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED') continue;
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { documents, errors };
  }

  private async findById<T extends object>(directory: string, id: string): Promise<MarkdownDocument<T> | null> {
    return (await this.readDirectory<T>(directory)).find((document) => (document.meta as { id?: unknown }).id === id) ?? null;
  }

  private async requireById<T extends object>(directory: string, id: string): Promise<MarkdownDocument<T>> {
    const document = await this.findById<T>(directory, id);
    if (!document) throw new AgentMemoryError('NOT_FOUND', `${directory} document not found: ${id}`);
    return document;
  }

  private assertInitialized(): void {
    if (!existsSync(join(this.root, 'agent-memory.json'))) throw new AgentMemoryError('VAULT_NOT_INITIALIZED', `Not a MemoBranch vault: ${this.root}. Run "amem init" first.`);
  }
}

async function listMarkdown(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  if ((await lstat(root)).isSymbolicLink()) {
    throw new AgentMemoryError('VALIDATION_FAILED', `Symbolic links are not allowed in managed vault paths: ${root}`);
  }
  const entries = await readdir(root, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new AgentMemoryError('VALIDATION_FAILED', `Symbolic links are not allowed in managed vault paths: ${path}`);
    }
    if (entry.isDirectory()) output.push(...(await listMarkdown(path)));
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push(path);
  }
  return output;
}

function validateProposal(proposal: ProposedMemory, maximum: number): void {
  if (!proposal.statement.trim() || !proposal.key.trim()) throw new AgentMemoryError('VALIDATION_FAILED', 'Memory statement and key are required');
  if (proposal.statement.length > maximum) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Memory statement exceeds the configured limit');
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) throw new AgentMemoryError('VALIDATION_FAILED', 'Confidence must be between 0 and 1');
  if (proposal.expiresAt && Number.isNaN(Date.parse(proposal.expiresAt))) throw new AgentMemoryError('VALIDATION_FAILED', 'expiresAt must be an ISO date');
}

function metadataReferenceErrors(documents: Array<MarkdownDocument<object>>): string[] {
  const errors: string[] = [];
  const entries = documents.map((document) => ({ document, meta: document.meta as Record<string, unknown> }));
  const byId = new Map<string, string[]>();
  const evidencePaths = new Set(entries.filter(({ meta }) => meta.type === 'evidence').map(({ document }) => document.path));
  const memoryPaths = new Set(entries
    .filter(({ meta }) => meta.type === 'memory' || meta.type === 'memory-erased')
    .map(({ document }) => document.path));
  const memoryIds = new Set(entries.filter(({ meta }) => meta.type === 'memory').map(({ meta }) => String(meta.id)));
  for (const { document, meta } of entries) {
    const id = String(meta.id);
    byId.set(id, [...(byId.get(id) ?? []), document.path]);
    if (meta.type === 'memory-candidate' || meta.type === 'memory') {
      for (const reference of meta.evidence as string[]) {
        if (!evidencePaths.has(reference)) errors.push(`${document.path}: evidence reference is missing or invalid: ${reference}`);
      }
    }
    if (meta.type === 'memory-candidate') {
      if (typeof meta.promotedTo === 'string' && !memoryPaths.has(meta.promotedTo)) {
        errors.push(`${document.path}: promotedTo reference is missing: ${meta.promotedTo}`);
      }
      for (const reference of meta.conflictsWith as string[]) {
        if (!memoryIds.has(reference)) errors.push(`${document.path}: conflictsWith reference is missing: ${reference}`);
      }
    }
    if (meta.type === 'memory') {
      if (typeof meta.supersededBy === 'string' && !memoryPaths.has(meta.supersededBy)) {
        errors.push(`${document.path}: supersededBy reference is missing: ${meta.supersededBy}`);
      }
      for (const reference of (meta.supersedes as string[] | undefined) ?? []) {
        if (!memoryPaths.has(reference)) errors.push(`${document.path}: supersedes reference is missing: ${reference}`);
      }
    }
  }
  for (const [id, paths] of byId) {
    if (paths.length > 1) errors.push(`Duplicate managed document id ${id}: ${paths.join(', ')}`);
  }
  return errors;
}

function isCanonicalDocumentPath(path: string): boolean {
  return path.endsWith('.md') && ['evidence/', 'candidates/', 'wiki/'].some((prefix) => path.startsWith(prefix));
}

function auditSelector(selector: string): string {
  return /^mem-[a-f0-9]{12}$/.test(selector) ? selector : `selector-sha256:${sha256(selector).slice(0, 16)}`;
}

function constrainToEvidence(
  proposal: ProposedMemory,
  evidence: Array<{ scope: Scope; sensitivity: Sensitivity }>,
): ProposedMemory {
  if (evidence.length === 0) return proposal;
  const maximumScope = evidence.reduce((current, item) => Math.min(current, scopes.indexOf(item.scope)), scopes.length - 1);
  const minimumSensitivity = evidence.reduce((current, item) => Math.max(current, sensitivities.indexOf(item.sensitivity)), 0);
  const scope = scopes[Math.min(scopes.indexOf(proposal.scope), maximumScope)] ?? evidence[0]!.scope;
  const sensitivity = sensitivities[Math.max(sensitivities.indexOf(proposal.sensitivity), minimumSensitivity)] ?? evidence[0]!.sensitivity;
  return { ...proposal, scope, sensitivity };
}

function candidateBody(meta: CandidateMeta, statement: string): string {
  const evidence = meta.evidence.length ? meta.evidence.map((path) => `- [${basename(path)}](${relativeLink(`candidates/${meta.id}.md`, path)})`) : ['- _No evidence attached; manual review required._'];
  return [`# Candidate: ${meta.key}`, '', statement.trim(), '', '## Evidence', '', ...evidence].join('\n');
}

function memoryBody(meta: MemoryMeta, statement: string, memoryPath: string): string {
  const conditions = meta.conditions.length ? meta.conditions.map((condition) => `- ${condition}`) : ['- Always, unless superseded or expired.'];
  const evidence = meta.evidence.length ? meta.evidence.map((path) => `- [${basename(path)}](${relativeLink(memoryPath, path)})`) : ['- _Approved explicitly without attached evidence._'];
  return [`# ${meta.key}`, '', statement.trim(), '', '## Applies when', '', ...conditions, '', '## Evidence', '', ...evidence].join('\n');
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

function scopeOf(meta: Record<string, unknown>): Scope {
  return ['user', 'project', 'team', 'public'].includes(String(meta.scope)) ? (meta.scope as Scope) : 'project';
}

function sensitivityOf(meta: Record<string, unknown>): Sensitivity {
  return ['public', 'internal', 'sensitive', 'secret'].includes(String(meta.sensitivity)) ? (meta.sensitivity as Sensitivity) : 'internal';
}

function encryptedParts(value: { meta: EncryptedEnvelopeMeta; body: string }): [EncryptedEnvelopeMeta, string] {
  return [value.meta, value.body];
}

function safeLogToken(value: string): string {
  return value.replace(/[^\p{L}\p{N}._:/=-]+/gu, ' ').trim().slice(0, 160);
}

function agentInstructions(): string {
  return `<!-- AGENT_MEMORY_WIKI_START -->
# MemoBranch instructions

This folder is a durable, Git-versioned memory vault. Read \`MEMORY.md\` first, then use search for long-tail details.

## Invariants

- \`evidence/\` is immutable evidence. Never edit or delete captured files.
- \`candidates/\` is a review queue. Pending candidates are not truth.
- \`wiki/\` contains canonical memories. Respect scope, sensitivity, status, conditions, and expiry.
- Use the CLI or MCP tools for writes so transactions, Git attribution, policy, and indexes stay correct.
- Confidential records require the configured master key and are never written to resident or persistent search indexes.
- Conflicts stay visible until an authorized reviewer approves a replacement.
- A single anecdote must not become a general procedure.

## Retrieval

Call \`memory_context\` with the current question. Cite returned paths when using a memory.
<!-- AGENT_MEMORY_WIKI_END -->
`;
}
