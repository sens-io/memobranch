import { resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { MaintenanceService } from './maintenance.js';
import { principalFromEnv, type Permission, type Principal } from './policy.js';
import { memoryKinds, scopes, sensitivities, type Scope, type Sensitivity } from './types.js';
import { MemoryVault } from './vault.js';

export const name = 'memobranch-deepseek-harness';
export const inject = ['tools'] as const;
export const VERSION = '1.0.0';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Config {
  vaultRoot: string;
  defaultScope: Scope;
  defaultSensitivity: Sensitivity;
  defaultSearchLimit: number;
  defaultMaxContextCharacters: number;
}

export const Config: Schema<Config> = Schema.object({
  vaultRoot: Schema.string()
    .max(4_096)
    .description('Absolute vault path. Empty uses AMEM_VAULT, then the process working directory.')
    .default(''),
  defaultScope: Schema.union(scopes)
    .description('Scope used when a capture or proposal omits scope.')
    .default('user'),
  defaultSensitivity: Schema.union(sensitivities)
    .description('Sensitivity used when a capture or proposal omits sensitivity.')
    .default('internal'),
  defaultSearchLimit: Schema.number()
    .min(1)
    .max(50)
    .step(1)
    .description('Default maximum search and context result count.')
    .default(8),
  defaultMaxContextCharacters: Schema.number()
    .min(500)
    .max(50_000)
    .step(1)
    .description('Default maximum rendered context size.')
    .default(12_000),
});

const jsonOutput = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
};

const stringOutput = {
  schema: { type: 'string' } as const,
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
};

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config);
  const principal = principalFromEnv();
  const vaultRoot = resolve(resolved.vaultRoot || process.env.AMEM_VAULT || process.cwd());
  const vault = new MemoryVault(vaultRoot, { principal });
  ctx.effect(() => () => vault.llm.cancelPending());

  if (granted(principal, 'read')) registerReadTools(ctx, vault, principal, resolved);
  if (granted(principal, 'write')) registerWriteTools(ctx, vault, resolved);
  if (granted(principal, 'review')) registerReviewTools(ctx, vault);
  if (granted(principal, 'admin')) registerAdminTools(ctx, vault);
  if (granted(principal, 'maintain')) registerMaintenanceTools(ctx, vault);
  if (granted(principal, 'sync')) registerSyncTools(ctx, vault);
}

function registerReadTools(ctx: Context, vault: MemoryVault, principal: Principal, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'memory_context',
    description: 'Build authorized resident and retrieved memory context before a task that depends on durable knowledge.',
    parameters: {
      query: { type: 'string', required: true, description: 'Current task or question.' },
      limit: { type: 'integer', description: 'Maximum retrieved records (1-50).' },
      maxCharacters: { type: 'integer', description: 'Maximum returned characters (500-50000).' },
      includeSensitive: { type: 'boolean', description: 'Request sensitive records when principal clearance permits.' },
      includeSecret: { type: 'boolean', description: 'Request secret records when principal clearance permits.' },
      semantic: { type: 'boolean', description: 'Enable semantic ranking when configured.' },
    },
    output: stringOutput,
    async execute(args, exec) {
      const query = boundedString(args.query, 'query', 2_000);
      const limit = boundedInteger(args.limit ?? config.defaultSearchLimit, 'limit', 1, 50);
      const maxCharacters = boundedInteger(args.maxCharacters ?? config.defaultMaxContextCharacters, 'maxCharacters', 500, 50_000);
      return run(vault, exec.signal, () => vault.context(query, {
        limit,
        maxCharacters,
        includeSensitive: args.includeSensitive ?? false,
        includeSecret: args.includeSecret ?? false,
        semantic: args.semantic ?? false,
      }));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: 'Search authorized canonical memory with policy filtering before ranking and graph expansion.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query.' },
      limit: { type: 'integer', description: 'Maximum results (1-50).' },
      includeSensitive: { type: 'boolean', description: 'Request sensitive records when authorized.' },
      includeSecret: { type: 'boolean', description: 'Request secret records when authorized.' },
      includeEvidence: { type: 'boolean', description: 'Include authorized immutable evidence.' },
      expandLinks: { type: 'boolean', description: 'Expand authorized graph neighbors.' },
      semantic: { type: 'boolean', description: 'Enable semantic ranking when configured.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      const query = boundedString(args.query, 'query', 2_000);
      const limit = boundedInteger(args.limit ?? config.defaultSearchLimit, 'limit', 1, 50);
      return runJson(vault, exec.signal, () => vault.searchDetailed(query, {
        limit,
        includeSensitive: args.includeSensitive ?? false,
        includeSecret: args.includeSecret ?? false,
        includeEvidence: args.includeEvidence ?? false,
        expandLinks: args.expandLinks ?? true,
        semantic: args.semantic ?? false,
      }));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_get',
    description: 'Read one authorized evidence, candidate, or canonical memory document by ID.',
    parameters: { id: { type: 'string', required: true, description: 'Managed document ID.' } },
    output: jsonOutput,
    async execute({ id }, exec) {
      return runJson(vault, exec.signal, () => vault.get(boundedString(id, 'id', 512)));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_version',
    description: 'Return MemoBranch package and vault schema versions.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return runJson(vault, exec.signal, async () => ({ version: VERSION, schemaVersion: (await vault.config()).version }));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_config',
    description: 'Read effective non-secret vault policy, limits, feature, maintenance, and remote configuration.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return runJson(vault, exec.signal, () => vault.config());
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_policy',
    description: 'Read the immutable server-owned principal permissions, scopes, clearance, and tenant binding.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return runJson(vault, exec.signal, async () => ({ principal }));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_history',
    description: 'Read attributed Git history for the vault or one authorized managed path.',
    parameters: {
      limit: { type: 'integer', description: 'Maximum commits (1-100).' },
      path: { type: 'string', description: 'Optional vault-relative managed path.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      const limit = boundedInteger(args.limit ?? 20, 'limit', 1, 100);
      const path = optionalBoundedString(args.path, 'path', 2_048);
      return runJson(vault, exec.signal, () => vault.history(limit, path));
    },
  }));
}

function registerWriteTools(ctx: Context, vault: MemoryVault, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'memory_capture',
    description: 'Idempotently capture immutable evidence and optionally extract review candidates.',
    parameters: {
      content: { type: 'string', required: true, description: 'Evidence content.' },
      sourceUri: { type: 'string', description: 'Optional provenance URI.' },
      scope: { type: 'string', enum: scopes, description: 'Memory scope.' },
      sensitivity: { type: 'string', enum: sensitivities, description: 'Sensitivity classification.' },
      extract: { type: 'boolean', description: 'Use the configured LLM to extract candidates.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      const content = boundedString(args.content, 'content', 1_000_000);
      const sourceUri = optionalBoundedString(args.sourceUri, 'sourceUri', 2_048);
      return runJson(vault, exec.signal, () => vault.capture({
        content,
        ...(sourceUri ? { sourceUri } : {}),
        scope: args.scope ?? config.defaultScope,
        sensitivity: args.sensitivity ?? config.defaultSensitivity,
        extract: args.extract ?? false,
      }));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_propose',
    description: 'Create an atomic memory candidate in the review queue; a candidate is not canonical truth.',
    parameters: {
      statement: { type: 'string', required: true, description: 'Proposed durable statement.' },
      key: { type: 'string', required: true, description: 'Stable human-readable memory key.' },
      kind: { type: 'string', enum: memoryKinds, description: 'Memory kind.' },
      scope: { type: 'string', enum: scopes, description: 'Memory scope.' },
      sensitivity: { type: 'string', enum: sensitivities, description: 'Sensitivity classification.' },
      confidence: { type: 'number', description: 'Confidence from 0 to 1.' },
      explicit: { type: 'boolean', description: 'Whether a user explicitly asked to remember it.' },
      conditions: { type: 'array', items: { type: 'string' }, description: 'Applicability conditions.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Searchable tags.' },
      expiresAt: { type: 'string', description: 'Optional ISO-8601 expiry.' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'Vault-relative evidence paths.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      const confidence = boundedNumber(args.confidence ?? 0.8, 'confidence', 0, 1);
      const conditions = boundedStringArray(args.conditions ?? [], 'conditions', 100, 2_000);
      const tags = boundedStringArray(args.tags ?? [], 'tags', 100, 200);
      const evidence = boundedStringArray(args.evidence ?? [], 'evidence', 100, 2_048);
      const expiresAt = optionalBoundedString(args.expiresAt, 'expiresAt', 128);
      if (expiresAt && Number.isNaN(Date.parse(expiresAt))) failValidation('expiresAt must be an ISO-8601 date');
      return runJson(vault, exec.signal, () => vault.propose({
        statement: boundedString(args.statement, 'statement', 1_000_000),
        key: boundedString(args.key, 'key', 512),
        kind: args.kind ?? 'fact',
        scope: args.scope ?? config.defaultScope,
        sensitivity: args.sensitivity ?? config.defaultSensitivity,
        confidence,
        explicit: args.explicit ?? false,
        conditions,
        tags,
        ...(expiresAt ? { expiresAt } : {}),
      }, evidence));
    },
  }));
}

function registerReviewTools(ctx: Context, vault: MemoryVault): void {
  ctx.tools.register(defineTool({
    name: 'memory_consolidate',
    description: 'Promote eligible candidates, merge duplicates, and surface conflicts for review.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return runJson(vault, exec.signal, () => vault.consolidate());
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_review',
    description: 'Approve or reject one candidate using the server-owned reviewer identity.',
    parameters: {
      action: { type: 'string', enum: ['approve', 'reject'], required: true, description: 'Review decision.' },
      candidateId: { type: 'string', required: true, description: 'Candidate ID.' },
      reason: { type: 'string', description: 'Required rejection reason.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      const candidateId = boundedString(args.candidateId, 'candidateId', 512);
      if (args.action === 'approve') return runJson(vault, exec.signal, () => vault.approve(candidateId));
      const reason = boundedString(args.reason ?? '', 'reason', 4_000);
      return runJson(vault, exec.signal, () => vault.reject(candidateId, reason));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: 'Revoke a canonical memory while retaining auditable encrypted history.',
    parameters: {
      selector: { type: 'string', required: true, description: 'Memory ID or key.' },
      reason: { type: 'string', required: true, description: 'Revocation reason.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      const selector = boundedString(args.selector, 'selector', 512);
      const reason = boundedString(args.reason, 'reason', 4_000);
      return runJson(vault, exec.signal, () => vault.forget(selector, reason));
    },
  }));
}

function registerAdminTools(ctx: Context, vault: MemoryVault): void {
  ctx.tools.register(defineTool({
    name: 'memory_erase',
    description: 'Cryptographically erase confidential memory by replacing it with a tombstone and destroying its wrapped key.',
    parameters: {
      selector: { type: 'string', required: true, description: 'Memory ID or key.' },
      reason: { type: 'string', required: true, description: 'Operator-confirmed erasure reason.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      const selector = boundedString(args.selector, 'selector', 512);
      const reason = boundedString(args.reason, 'reason', 4_000);
      return runJson(vault, exec.signal, () => vault.erase(selector, reason));
    },
  }));
}

function registerMaintenanceTools(ctx: Context, vault: MemoryVault): void {
  ctx.tools.register(defineTool({
    name: 'memory_doctor',
    description: 'Audit vault configuration, Git, index, transactions, documents, links, expiry, and conflicts.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return runJson(vault, exec.signal, () => vault.doctor());
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_recover',
    description: 'Roll back incomplete writes and replay commit-ready transactions.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return runJson(vault, exec.signal, () => vault.recover());
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_reindex',
    description: 'Incrementally rebuild lexical state and optional embedding vectors.',
    parameters: { semantic: { type: 'boolean', description: 'Refresh embeddings when configured.' } },
    output: jsonOutput,
    async execute({ semantic }, exec) {
      return runJson(vault, exec.signal, () => vault.reindex(semantic ?? false));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_maintenance',
    description: 'Run one recovery, expiry, index, health, and optional synchronization cycle.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return runJson(vault, exec.signal, () => new MaintenanceService(vault).runOnce());
    },
  }));
}

function registerSyncTools(ctx: Context, vault: MemoryVault): void {
  ctx.tools.register(defineTool({
    name: 'memory_remote_status',
    description: 'Fetch and report configured remote ahead, behind, divergence, and conflict state.',
    parameters: { fetch: { type: 'boolean', description: 'Fetch the remote before comparing state.' } },
    output: jsonOutput,
    async execute({ fetch }, exec) {
      return runJson(vault, exec.signal, () => vault.remoteStatus(fetch ?? true));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_remote_sync',
    description: 'Fetch, integrate conflict-safely, validate, and optionally push the vault remote.',
    parameters: { push: { type: 'boolean', description: 'Push the integrated local revision.' } },
    output: jsonOutput,
    async execute({ push }, exec) {
      return runJson(vault, exec.signal, () => vault.sync({ push: push ?? false }));
    },
  }));
}

function resolveConfig(config: Config): Config {
  const vaultRoot = config.vaultRoot.trim();
  if (vaultRoot.length > 4_096) failValidation('vaultRoot exceeds 4096 characters');
  return {
    vaultRoot,
    defaultScope: oneOf(config.defaultScope, scopes, 'defaultScope'),
    defaultSensitivity: oneOf(config.defaultSensitivity, sensitivities, 'defaultSensitivity'),
    defaultSearchLimit: boundedInteger(config.defaultSearchLimit, 'defaultSearchLimit', 1, 50),
    defaultMaxContextCharacters: boundedInteger(config.defaultMaxContextCharacters, 'defaultMaxContextCharacters', 500, 50_000),
  };
}

function granted(principal: Principal, permission: Permission): boolean {
  return principal.permissions.includes('admin') || principal.permissions.includes(permission);
}

async function run<T>(vault: MemoryVault, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw safeError(cancelled());
  const cancelProvider = () => vault.llm.cancelPending();
  signal.addEventListener('abort', cancelProvider, { once: true });
  try {
    const value = await action();
    if (signal.aborted) throw cancelled();
    return value;
  } catch (error) {
    throw safeError(signal.aborted ? cancelled() : error);
  } finally {
    signal.removeEventListener('abort', cancelProvider);
  }
}

async function runJson(vault: MemoryVault, signal: AbortSignal, action: () => Promise<unknown>): Promise<JsonValue> {
  const value = await run(vault, signal, action);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) failValidation('Tool result is not JSON serializable');
  return JSON.parse(serialized) as JsonValue;
}

function safeError(error: unknown): Error {
  const normalized = toAgentMemoryError(error);
  return new Error(JSON.stringify(normalized.toJSON()));
}

function cancelled() {
  return new AgentMemoryError('OPERATION_CANCELLED', 'DeepSeek Harness tool call was cancelled');
}

function boundedString(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) failValidation(`${field} is required`);
  if (normalized.length > max) failValidation(`${field} exceeds ${max} characters`);
  return normalized;
}

function optionalBoundedString(value: string | undefined, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, field, max);
}

function boundedStringArray(values: string[], field: string, maxItems: number, maxCharacters: number): string[] {
  if (values.length > maxItems) failValidation(`${field} exceeds ${maxItems} items`);
  return values.map((value, index) => boundedString(value, `${field}[${index}]`, maxCharacters));
}

function boundedNumber(value: number, field: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) failValidation(`${field} must be between ${min} and ${max}`);
  return value;
}

function boundedInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value)) failValidation(`${field} must be an integer`);
  return boundedNumber(value, field, min, max);
}

function oneOf<T extends string>(value: T, choices: readonly T[], field: string): T {
  if (!choices.includes(value)) failValidation(`${field} is invalid`);
  return value;
}

function failValidation(message: string): never {
  throw safeError(new Error(message));
}
