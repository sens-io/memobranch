import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { effectiveTimestamp, factEffectiveAt } from './effective-time.js';
import { authorize, type Principal } from './policy.js';
import { combineSignals, operationSignal, throwIfCancelled, withOperation } from './operation.js';
import { scopes, sensitivities, type MarkdownDocument, type MemoryMeta, type Scope, type Sensitivity, type VaultConfig } from './types.js';
import { sha256 } from './utils.js';
import { stableWikiJson } from './wiki-proof.js';
import type { CaptureOptions, CaptureResult } from './vault.js';
import type { WikiSnapshot } from './wiki-snapshot.js';

const marker = 'MEMOBRANCH_KNOWLEDGE_AVAILABILITY_V1\n';
const text = z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const keys = z.array(text).min(1).max(25).refine(values => new Set(values).size === values.length);
const selectionSchema = z.object({ includeSensitive: z.boolean().default(false), includeSecret: z.boolean().default(false) });
export const availabilityObserveSchema = selectionSchema.extend({ pageKeys: keys, confirm: z.literal(true) }).strict();
export const availabilityAtSchema = selectionSchema.extend({ pageKeys: keys, at: z.string().min(1).max(64),
  observationIds: z.array(z.string().regex(/^ev-[a-f0-9]{12}$/)).min(1).max(40).refine(values => new Set(values).size === values.length).optional(),
}).strict();
const documentSchema = z.object({ path: z.string().min(1).max(1000), hash, id: text,
  scope: z.enum(scopes), sensitivity: z.enum(sensitivities) }).strict();
const observationSchema = z.object({ kind: z.literal('knowledge-availability'), version: z.literal(1),
  eventId: z.string().uuid(), vaultId: text, tenantId: text, actorId: text, configHash: hash,
  observedAt: z.string().datetime(), commit, requestedKeys: keys,
  builtinRulesHash: hash.nullable(),
  pages: z.array(z.object({ key: text, path: documentSchema.shape.path }).strict()).min(1).max(50),
  documents: z.array(documentSchema).min(1).max(200), scope: z.enum(scopes), sensitivity: z.enum(sensitivities), proof: hash,
}).strict();

export type AvailabilityObserveOptions = z.input<typeof availabilityObserveSchema> & { signal?: AbortSignal | undefined };
export type AvailabilityAtOptions = z.input<typeof availabilityAtSchema> & { signal?: AbortSignal | undefined };
type Selection = z.output<typeof selectionSchema>;
type Observation = z.infer<typeof observationSchema>;
type Document = MarkdownDocument<Record<string, unknown>>;
export interface AvailabilitySnapshot { snapshot: WikiSnapshot; documentHashes: Array<{ path: string; hash: string }>; builtinRulesHash: string | null; validate(): void }

export interface AvailabilityPort {
  principal: Principal;
  config(): Promise<VaultConfig>;
  read<T>(action: () => Promise<T>): Promise<T>;
  snapshot(pageKeys: string[], selection: Selection, commit?: string): Promise<AvailabilitySnapshot>;
  document(path: string, selection: Selection): Promise<Document>;
  records(selection: Selection, ids?: string[]): Promise<Document[]>;
  head(): Promise<string>;
  sign(value: object): Promise<string>;
  verify(value: object, proof: string): Promise<void>;
  capture(options: CaptureOptions, guard: { revalidate(): Promise<void>; validate(): void }): Promise<CaptureResult>;
}

/** Explicit local observations, not inferred Git dates or a model's thought history. */
export class AvailabilityEngine {
  constructor(private readonly port: AvailabilityPort) {}

  async observe(input: AvailabilityObserveOptions) {
    const { signal, ...options } = parse(availabilityObserveSchema.extend({ signal: z.instanceof(AbortSignal).optional() }).strict(), input);
    return this.signalled(signal, () => this.observeChecked(options));
  }

  private async observeChecked(input: z.input<typeof availabilityObserveSchema>) {
    authorize(this.port.principal, 'read'); authorize(this.port.principal, 'write');
    const options = parse(availabilityObserveSchema, input);
    const prepared = await this.port.read(async () => {
      const config = await this.port.config(), state = await this.port.snapshot(options.pageKeys, options), snapshot = state.snapshot;
      if (snapshot.commit !== snapshot.authorityHead) fail('Availability must observe current HEAD');
      const paths = new Set([...snapshot.pages.map(page => page.path), ...snapshot.sources.map(source => source.path),
        ...snapshot.rules.filter(rule => rule.id !== 'builtin-wiki-rules-v1').map(rule => `wiki/.meta/${rule.id}.md`)]);
      const documents: Document[] = [];
      const expected = new Map(state.documentHashes.map(item => [item.path, item.hash]));
      for (const path of paths) {
        const document = await this.port.document(path, options);
        if (documentHash(document) !== expected.get(path)) fail('Availability snapshot changed');
        documents.push(document);
      }
      const privateScopes = new Set(documents.map(doc => doc.meta.scope as Scope).filter(scope => scope !== 'public'));
      if (privateScopes.size > 1) fail('Observe incompatible private scopes separately');
      const scope = [...privateScopes][0] ?? 'public';
      const sensitivity = sensitivities[Math.max(...documents.map(doc => sensitivities.indexOf(doc.meta.sensitivity as Sensitivity)))]!;
      const unsigned = { kind: 'knowledge-availability' as const, version: 1 as const, eventId: randomUUID(),
        vaultId: config.vaultId, tenantId: config.tenantId, actorId: this.port.principal.id, configHash: digest(config),
        observedAt: new Date().toISOString(), commit: snapshot.commit, requestedKeys: options.pageKeys,
        builtinRulesHash: state.builtinRulesHash,
        pages: snapshot.pages.map(page => ({ key: page.meta.type === 'memory' ? `legacy:${page.meta.id}` : String(page.meta.key), path: page.path })),
        documents: documents.map(doc => ({ path: doc.path, id: String(doc.meta.id), hash: documentHash(doc),
          scope: doc.meta.scope as Scope, sensitivity: doc.meta.sensitivity as Sensitivity })), scope, sensitivity };
      const observation = parse(observationSchema, { ...unsigned, proof: await this.port.sign(unsigned) });
      return { observation, documents, validateSnapshot: state.validate };
    });
    const { observation, documents } = prepared;
    const final = () => {
      prepared.validateSnapshot();
      authorize(this.port.principal, 'write', { tenantId: observation.tenantId });
      this.access(observation, options);
      for (const doc of documents) {
        authorize(this.port.principal, 'read', { tenantId: observation.tenantId, scope: doc.meta.scope as Scope, sensitivity: doc.meta.sensitivity as Sensitivity });
        if (typeof doc.meta.expiresAt === 'string' && Date.parse(doc.meta.expiresAt) <= Date.now()
            || doc.meta.type === 'memory' && !factEffectiveAt(doc.meta as unknown as MemoryMeta)) fail('Observed page is no longer current');
      }
    };
    const revalidate = async () => {
      final();
      if (digest(await this.port.config()) !== observation.configHash || await this.port.head() !== observation.commit) fail('Availability source revision changed');
      for (const expected of observation.documents) {
        if (documentHash(await this.port.document(expected.path, options)) !== expected.hash) fail('Observed document changed');
      }
      if (digest(await this.port.config()) !== observation.configHash || await this.port.head() !== observation.commit) fail('Availability source revision changed during revalidation');
    };
    throwIfCancelled(); final();
    const content = marker + stableWikiJson(observation);
    if (content.length > 160_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Availability manifest exceeds 160000 characters');
    const captured = await this.port.capture({ content, scope: observation.scope, sensitivity: observation.sensitivity,
      sourceUri: `urn:memobranch:availability:${observation.eventId}` }, { revalidate, validate: final });
    try { throwIfCancelled(); final(); }
    catch (error) {
      if (!(error instanceof AgentMemoryError)) throw error;
      throw new AgentMemoryError(error.code, error.message, { ...error.safeDetails,
        completedAvailability: { evidenceId: captured.evidenceId, commit: captured.commit } }, error.exitCode);
    }
    return { ...captured, kind: observation.kind, observedAt: observation.observedAt, observedCommit: observation.commit, pageKeys: observation.requestedKeys };
  }

  async at(input: AvailabilityAtOptions) {
    const { signal, ...options } = parse(availabilityAtSchema.extend({ signal: z.instanceof(AbortSignal).optional() }).strict(), input);
    return this.signalled(signal, () => this.atChecked(options));
  }

  private async atChecked(input: z.input<typeof availabilityAtSchema>) {
    authorize(this.port.principal, 'read');
    const options = parse(availabilityAtSchema, input), at = effectiveTimestamp(options.at), identity = stableWikiJson(this.port.principal);
    let tenantId = ''; const finalChecks: Array<() => void> = [];
    const result = await this.port.read(async () => {
      const config = await this.port.config(); tenantId = config.tenantId;
      const observations: Array<{ observation: Observation; evidenceId: string }> = [];
      for (const record of await this.port.records(options, options.observationIds)) {
        throwIfCancelled(); const prefix = `# Evidence ${record.meta.id}\n\n${marker}`;
        if (!record.body.startsWith(prefix)) continue;
        let observation: Observation;
        try {
          const raw: unknown = JSON.parse(record.body.slice(prefix.length));
          observation = parse(observationSchema, raw);
          const { proof, ...unsigned } = observation; await this.port.verify(unsigned, proof);
        } catch (error) {
          throwIfCancelled();
          if (error instanceof SyntaxError || error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED') continue;
          throw error;
        }
        if (observation.vaultId !== config.vaultId || observation.tenantId !== tenantId
            || observation.scope !== record.meta.scope || observation.sensitivity !== record.meta.sensitivity
            || Date.parse(observation.observedAt) > Date.parse(at)) continue;
        this.access(observation, options); observations.push({ observation, evidenceId: String(record.meta.id) });
      }
      let resultBytes = 0;
      const items: Array<{ key: string; status: 'observed' | 'unknown'; reason?: string;
        observedAt?: string; observationId?: string; snapshot?: WikiSnapshot }> = [];
      for (const key of options.pageKeys) {
        const matches = observations.filter(({ observation }) => observation.requestedKeys.includes(key))
          .sort((a, b) => b.observation.observedAt.localeCompare(a.observation.observedAt));
        const latest = matches[0];
        if (!latest) { items.push({ key, status: 'unknown', reason: 'No readable verifiable local availability observation supports this key and time.' }); continue; }
        const tied = matches.filter(match => match.observation.observedAt === latest.observation.observedAt);
        if (new Set(tied.map(match => digest(match.observation.documents))).size > 1) {
          items.push({ key, status: 'unknown', reason: 'Conflicting observations at the same recorded instant.' }); continue;
        }
        const state = await this.port.snapshot([key], options, latest.observation.commit), snapshot = state.snapshot;
        finalChecks.push(state.validate);
        if (state.builtinRulesHash !== latest.observation.builtinRulesHash) fail('Built-in rules no longer match the observed implementation');
        resultBytes += Buffer.byteLength(stableWikiJson(snapshot), 'utf8');
        if (resultBytes > 20_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete observed knowledge view exceeds 20 MB; request fewer keys');
        const expected = new Map(latest.observation.documents.map(doc => [doc.path, doc.hash]));
        for (const document of state.documentHashes) if (expected.get(document.path) !== document.hash) fail('Historical dependency does not match observed content');
        items.push({ key, status: 'observed', observedAt: latest.observation.observedAt, observationId: latest.evidenceId, snapshot });
      }
      return { kind: 'observed-knowledge-view' as const, at, coverage: { mode: options.observationIds ? 'explicit-observation-ids' as const : 'readable-evidence-scan' as const }, items, warnings: [
        'Partial explicit local availability observations, not a complete model thought history or proof of first learning.',
        'The host clock and local proof key are trusted operational inputs, not independently verified timestamping.',
        'Current access, lifecycle and source/key checks apply. Missing observations are unknown, never inferred from Git dates.',
        ...(options.observationIds ? ['Only the supplied observation IDs were searched. Newer or conflicting observations outside that set are not ruled out.'] : []),
      ] };
    });
    throwIfCancelled(); authorize(this.port.principal, 'read', { tenantId });
    if (stableWikiJson(this.port.principal) !== identity) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'Availability read authority changed');
    for (const validate of finalChecks) validate();
    return result;
  }

  private access(observation: Observation, selection: Selection) {
    authorize(this.port.principal, 'read', { tenantId: observation.tenantId, scope: observation.scope, sensitivity: observation.sensitivity });
    if (observation.sensitivity === 'sensitive' && !selection.includeSensitive || observation.sensitivity === 'secret' && !selection.includeSecret) {
      throw new AgentMemoryError('AUTHORIZATION_DENIED', 'Explicit confidential availability selection is required');
    }
  }

  private async signalled<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    throwIfCancelled();
    if (!signal) return action();
    const parent = operationSignal(), combined = combineSignals([signal, ...(parent ? [parent] : [])]);
    try { return await withOperation(combined.signal, async () => { throwIfCancelled(); return action(); }); }
    finally { combined.dispose(); }
  }
}

function digest(value: unknown) { return sha256(stableWikiJson(value)); }
function documentHash(doc: MarkdownDocument<object>) { return digest({ meta: doc.meta, body: doc.body }); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T { const result = schema.safeParse(input); if (!result.success) fail('Invalid availability input or observation'); return result.data; }
function fail(message: string): never { throw new AgentMemoryError('VALIDATION_FAILED', message); }
