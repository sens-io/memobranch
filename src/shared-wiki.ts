import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { LlmClient } from './llm.js';
import { combineSignals, operationSignal, throwIfCancelled, withOperation } from './operation.js';
import { authorize, permissions, type Principal } from './policy.js';
import { scopes, sensitivities, type VaultConfig } from './types.js';
import { sha256 } from './utils.js';
import { MemoryVault } from './vault.js';
import type { WikiSnapshot } from './wiki-snapshot.js';
import { stableWikiJson } from './wiki-proof.js';

const text = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const sourceId = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
const path = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value));
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const uniqueScopes = z.array(z.enum(scopes)).min(1).max(4).refine(values => new Set(values).size === values.length);
const bindingSchema = z.object({ id: sourceId, title: text, root: path, commit, vaultId: text, tenantId: text,
  readers: z.array(z.object({ id: text, tenantId: text }).strict()).min(1).max(100)
    .refine(values => new Set(values.map(value => `${value.tenantId}\0${value.id}`)).size === values.length),
  scopes: uniqueScopes, maxSensitivity: z.enum(sensitivities),
  masterKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/).optional(),
}).strict();
const configSchema = z.object({ version: z.literal(1), sources: z.array(bindingSchema).max(20)
  .refine(values => new Set(values.map(source => source.id)).size === values.length) }).strict();
const principalSchema = z.object({ id: text, name: z.string().min(1).max(500), email: z.string().max(500).optional(),
  tenantId: text.optional(), permissions: z.array(z.enum(permissions)).min(1).max(6), scopes: uniqueScopes, maxSensitivity: z.enum(sensitivities) });

export const sharedWikiSnapshotSchema = z.object({ sourceId,
  pageKeys: z.array(text).min(1).max(25).refine(values => new Set(values).size === values.length),
  expectedCommit: commit.optional(),
  includeSensitive: z.boolean().default(false), includeSecret: z.boolean().default(false),
}).strict();
export type SharedWikiSnapshotOptions = z.input<typeof sharedWikiSnapshotSchema> & { signal?: AbortSignal | undefined };
export interface SharedWikiReaderOptions { configPath: string; env?: NodeJS.ProcessEnv }
export interface SharedWikiView {
  version: 1;
  kind: 'shared-wiki-view';
  source: { id: string; title: string; vaultId: string; tenantId: string; commit: string };
  snapshot: WikiSnapshot;
  warnings: string[];
}
type Binding = z.infer<typeof bindingSchema>;
type State = { config: VaultConfig; bindings: z.infer<typeof configSchema>; identity: string; configHash: string; bindingsHash: string; principal: Principal };
const signalSchema = z.object({ signal: z.instanceof(AbortSignal).optional() }).strict();
const warnings = [
  'Explicit host-configured local/Git read access at a fixed commit, not a share token, import, merge or approval.',
  'Current local caller/source authority, lifecycle and keys apply. An offline clone cannot learn remote withdrawals without an explicit update.',
  'Previously copied plaintext cannot be recalled. No model call, checkout, fetch, push, permission change or canonical write is performed.',
];

/** Host-owned bindings only. Requests never choose a root, identity, pin or source key. */
export class SharedWikiReader {
  private readonly configPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly caller: MemoryVault, options: SharedWikiReaderOptions) {
    if (!path.safeParse(options?.configPath).success) configError();
    this.configPath = options.configPath; this.env = options.env ?? process.env;
  }

  async catalog(options: { signal?: AbortSignal | undefined } = {}) {
    const input = parse(signalSchema, options);
    return this.scoped(input.signal, async () => {
      const before = await this.state();
      const sources = before.bindings.sources.filter(binding => this.accessible(before, binding)).map(binding => {
        const principal = this.sourcePrincipal(before, binding);
        return { id: binding.id, title: binding.title, commit: binding.commit, scopes: principal.scopes, maxSensitivity: principal.maxSensitivity };
      });
      this.unchanged(before, await this.state()); this.finalCaller(before);
      return { version: 1 as const, kind: 'shared-wiki-catalog' as const, sources,
        warnings: ['Configured readable source names and pins only; catalog membership does not prove every source page is currently available.'] };
    });
  }

  async snapshot(options: SharedWikiSnapshotOptions): Promise<SharedWikiView> {
    const { signal, ...input } = parse(sharedWikiSnapshotSchema.extend({ signal: z.instanceof(AbortSignal).optional() }).strict(), options);
    return this.scoped(signal, async () => {
      const before = await this.state(), binding = this.binding(before, input.sourceId), principal = this.sourcePrincipal(before, binding);
      if (input.expectedCommit !== undefined && input.expectedCommit !== binding.commit) throw new AgentMemoryError('VALIDATION_FAILED', 'Shared Wiki pin changed; reload the configured source catalog');
      const key = this.key(binding), keyHash = sha256(key);
      // Explicit empty key prevents MemoryVault's normal AMEM_MASTER_KEY fallback.
      let retained: Awaited<ReturnType<MemoryVault['wikiSnapshotWithValidation']>>;
      try {
        const source = new MemoryVault(binding.root, { principal, masterKey: key, llm: new LlmClient({ apiKey: '', embeddingModel: '' }) });
        retained = await source.withReadSnapshot(async () => {
          const config = await source.config();
          if (config.vaultId !== binding.vaultId || config.tenantId !== binding.tenantId) unavailable();
          return source.wikiSnapshotWithValidation({ commit: binding.commit, pageKeys: input.pageKeys,
            includeSensitive: input.includeSensitive, includeSecret: input.includeSecret });
        }, 'read');
      } catch (error) { this.sourceError(error, binding.id); }
      if (retained.snapshot.commit !== binding.commit) unavailable();
      // The source lock is released before waiting for the caller's final lock.
      const after = await this.state(); this.unchanged(before, after);
      if (sha256(this.key(this.binding(after, input.sourceId))) !== keyHash) deny('Shared source key selection changed');
      const result: SharedWikiView = { version: 1, kind: 'shared-wiki-view',
        source: { id: binding.id, title: binding.title, vaultId: binding.vaultId, tenantId: binding.tenantId, commit: binding.commit },
        snapshot: retained.snapshot, warnings: [...warnings] };
      if (Buffer.byteLength(stableWikiJson(result), 'utf8') > 20_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete shared Wiki view exceeds 20 MB');
      this.finalCaller(before);
      // No await after this check: the additional caller/grant wait may cross expiry.
      try { retained.validate(); } catch (error) { this.sourceError(error, binding.id); }
      return result;
    });
  }

  private async state(): Promise<State> {
    throwIfCancelled(); authorize(this.caller.principal, 'read');
    const parsed = principalSchema.safeParse(this.caller.principal);
    if (!parsed.success) deny('Invalid shared reader authority');
    const { email, tenantId, ...base } = parsed.data;
    const principal: Principal = { ...base, ...(email === undefined ? {} : { email }), ...(tenantId === undefined ? {} : { tenantId }) };
    const identity = stableWikiJson(this.caller.principal);
    const state = await this.caller.withReadSnapshot(async () => {
      const config = await this.caller.config(), bindings = await readBindings(this.configPath);
      return { config, bindings, identity, principal, configHash: digest(config), bindingsHash: digest(bindings) };
    }, 'read');
    this.finalCaller(state); return state;
  }

  private accessible(state: State, binding: Binding) {
    return binding.readers.some(reader => reader.id === state.principal.id && reader.tenantId === state.config.tenantId)
      && binding.scopes.some(scope => state.principal.scopes.includes(scope));
  }

  private binding(state: State, id: string) {
    const binding = state.bindings.sources.find(source => source.id === id && this.accessible(state, source));
    if (!binding) unavailable(); return binding;
  }

  private sourcePrincipal(state: State, binding: Binding): Principal {
    const caller = state.principal;
    return { id: caller.id, name: caller.name, ...(caller.email ? { email: caller.email } : {}), tenantId: binding.tenantId,
      permissions: ['read'], scopes: binding.scopes.filter(scope => caller.scopes.includes(scope)),
      maxSensitivity: sensitivities[Math.min(sensitivities.indexOf(caller.maxSensitivity), sensitivities.indexOf(binding.maxSensitivity))]! };
  }

  private key(binding: Binding) { return binding.masterKeyEnv ? this.env[binding.masterKeyEnv] ?? '' : ''; }

  private finalCaller(state: State) {
    throwIfCancelled(); authorize(this.caller.principal, 'read', { tenantId: state.config.tenantId });
    if (stableWikiJson(this.caller.principal) !== state.identity) deny('Shared reader authority changed');
  }

  private unchanged(before: State, after: State) {
    if (before.identity !== after.identity || before.configHash !== after.configHash || before.bindingsHash !== after.bindingsHash) deny('Shared reader configuration or grant changed');
  }

  private sourceError(error: unknown, id: string): never {
    throwIfCancelled(); const failure = toAgentMemoryError(error);
    throw new AgentMemoryError(failure.code, 'Shared Wiki source is unavailable under current authority', { sourceId: id }, failure.exitCode);
  }

  private async scoped<T>(signal: AbortSignal | undefined, action: () => Promise<T>) {
    throwIfCancelled(); if (!signal) return action();
    const parent = operationSignal(), combined = combineSignals(parent ? [parent, signal] : [signal]);
    try { return await withOperation(combined.signal, action); } finally { combined.dispose(); }
  }
}

/** Bounded regular-file reads, including final-path symlink and replacement checks. */
async function readBindings(path: string) {
  try {
    throwIfCancelled(); const initial = await lstat(path);
    if (!initial.isFile() || initial.isSymbolicLink()) configError();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let text: string;
    try {
      const start = await handle.stat();
      if (!start.isFile() || start.dev !== initial.dev || start.ino !== initial.ino) configError();
      if (start.size > 100_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Shared Wiki configuration exceeds 100000 bytes');
      const buffer = Buffer.alloc(100_001); let total = 0;
      for (;;) {
        throwIfCancelled(); const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
        if (!bytesRead) break; total += bytesRead;
        if (total > 100_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Shared Wiki configuration exceeds 100000 bytes');
      }
      const end = await handle.stat(), current = await lstat(path);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== end.dev || current.ino !== end.ino
        || start.size !== end.size || start.mtimeMs !== end.mtimeMs || start.ctimeMs !== end.ctimeMs) configError();
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total));
    } finally { await handle.close(); }
    throwIfCancelled(); const result = configSchema.safeParse(JSON.parse(text));
    if (!result.success) configError(); return result.data;
  } catch (error) {
    throwIfCancelled();
    if (error instanceof AgentMemoryError) throw error;
    return configError();
  }
}
function digest(value: unknown) { return sha256(stableWikiJson(value)); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid shared Wiki selection'); return result.data; }
function deny(message: string): never { throw new AgentMemoryError('AUTHORIZATION_DENIED', message); }
function unavailable(): never { throw new AgentMemoryError('NOT_FOUND', 'Shared Wiki source or page is unavailable'); }
function configError(): never { throw new AgentMemoryError('CONFIG_INVALID', 'Shared Wiki configuration is unavailable or invalid'); }
