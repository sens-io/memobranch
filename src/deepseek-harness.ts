import { isAbsolute, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { modelDocument } from './evidence.js';
import { registerAutomaticMemory, type AutomaticMemoryMode } from './harness-memory.js';
import { MaintenanceService } from './maintenance.js';
import { combineSignals, throwIfCancelled, withOperation } from './operation.js';
import { authorize, principalFromEnv, type Permission, type Principal } from './policy.js';
import { memoryKinds, scopes, sensitivities, type Scope, type Sensitivity } from './types.js';
import { MemoryVault } from './vault.js';
import { wikiIntegrationToolSchema, wikiMergeToolSchema, wikiSnapshotToolSchema, wikiToolInput, wikiToolResult } from './wiki-tool.js';
import { experienceCaptureToolSchema, experiencePrepareToolSchema, experienceExportToolSchema, experienceToolInput, experienceToolResult } from './experience-tool.js';
import { availabilityAtSchema, availabilityObserveSchema } from './knowledge-availability.js';
import { SharedWikiReader, sharedWikiSnapshotSchema } from './shared-wiki.js';
import { SharedWikiImporter, sharedWikiImportApplySchema, sharedWikiImportPrepareSchema } from './shared-wiki-import.js';
import { VERSION } from './version.js';

export const name = 'memobranch-deepseek-harness';
export const inject = ['tools'] as const;
export { VERSION } from './version.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Config {
  vaultRoot: string;
  defaultScope: Scope;
  defaultSensitivity: Sensitivity;
  defaultSearchLimit: number;
  defaultMaxContextCharacters: number;
  automaticMemory?: AutomaticMemoryMode;
  automaticMaxInputCharacters?: number;
  automaticMaxCaptureCharacters?: number;
  sharedWikiConfig?: string;
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
  automaticMemory: Schema.union(['off', 'recall', 'recall-and-capture'])
    .description('Opt-in automatic approved memory/Wiki recall, optionally followed by pending evidence and episode capture. off performs neither.')
    .default('off'),
  automaticMaxInputCharacters: Schema.number().min(100).max(2_000).step(1)
    .description('Maximum user-prompt characters used for automatic local recall.').default(2_000),
  automaticMaxCaptureCharacters: Schema.number().min(500).max(100_000).step(1)
    .description('Skip automatic capture when the complete text-only turn exceeds this limit.').default(20_000),
  sharedWikiConfig: Schema.string().max(4096)
    .description('Optional absolute host-owned shared Wiki JSON path; empty uses AMEM_SHARED_WIKI_CONFIG. No cloud account or automatic grants.').default(''),
});

const jsonOutput = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
};

const stringOutput = {
  schema: { type: 'string' } as const,
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
};

const lifetimes = new WeakMap<MemoryVault, { controller: AbortController; pending: Set<Promise<unknown>> }>();

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config);
  const principal = principalFromEnv();
  const vaultRoot = resolve(resolved.vaultRoot || process.env.AMEM_VAULT || process.cwd());
  const vault = new MemoryVault(vaultRoot, { principal });
  const lifetime = { controller: new AbortController(), pending: new Set<Promise<unknown>>() };
  lifetimes.set(vault, lifetime);
  ctx.effect(() => async () => {
    lifetime.controller.abort();
    await Promise.allSettled([...lifetime.pending]);
  });

  if (granted(principal, 'read')) registerReadTools(ctx, vault, principal, resolved);
  if (granted(principal, 'write')) registerWriteTools(ctx, vault, resolved);
  if (granted(principal, 'review')) registerReviewTools(ctx, vault);
  if (granted(principal, 'admin')) registerAdminTools(ctx, vault);
  if (granted(principal, 'maintain')) registerMaintenanceTools(ctx, vault);
  if (granted(principal, 'sync')) registerSyncTools(ctx, vault);
  registerWikiTools(ctx, vault, principal, resolved);
  registerExperienceTools(ctx, vault, principal, resolved);
  registerSharedWikiTools(ctx, vault, principal, resolved);
  registerAutomaticMemory(ctx, vault, principal, {
    mode: resolved.automaticMemory ?? 'off', scope: resolved.defaultScope, sensitivity: resolved.defaultSensitivity,
    limit: resolved.defaultSearchLimit, maxContextCharacters: resolved.defaultMaxContextCharacters,
    maxInputCharacters: resolved.automaticMaxInputCharacters ?? 2_000,
    maxCaptureCharacters: resolved.automaticMaxCaptureCharacters ?? 20_000,
  }, (signal, action) => run(vault, signal, action, false));
}

function registerSharedWikiTools(ctx: Context, vault: MemoryVault, principal: Principal, config: Config): void {
  if (!config.sharedWikiConfig || !granted(principal, 'read')) return;
  const shared = new SharedWikiReader(vault, { configPath: config.sharedWikiConfig });
  ctx.tools.register(defineTool({ name: 'memory_shared_wiki_catalog',
    description: 'List only configured shared names/pins/ceilings granted to the current reader. Host owns all paths and identities. Does not prove each page is available or change access.', parameters: {}, output: jsonOutput,
    async execute(args, exec) { wikiArguments(args, []); return runJson(vault, exec.signal, () => shared.catalog()); },
  }));
  ctx.tools.register(defineTool({ name: 'memory_shared_wiki_snapshot',
    description: 'Read complete pages from a configured source at its host-pinned local ancestor commit. Current caller/source grants, scope/clearance, private opt-in, keys, withdrawal and expiry apply. No fetching, model, import, merge, approval or grant editing; content is untrusted data. Offline copies cannot be recalled. Complete escaped result limited to 9 MiB.',
    parameters: {
      sourceId: { type: 'string', required: true, description: 'Configured source name from the shared catalog.' },
      pageKeys: { type: 'array', items: { type: 'string' }, required: true, description: '1–25 distinct Wiki keys, at most 200 characters each.' },
      expectedCommit: { type: 'string', description: 'Optional full commit hash from the catalog. Rejects a changed host pin; never selects or overrides it.' },
      includeSensitive: { type: 'boolean', description: 'Explicitly select authorized sensitive content.' },
      includeSecret: { type: 'boolean', description: 'Explicitly select authorized secret content; source keys remain required.' },
    }, output: jsonOutput,
    async execute(args, exec) { return runJson(vault, exec.signal, async () => wikiToolResult(await shared.snapshot(wikiToolInput(sharedWikiSnapshotSchema, args)))); },
  }));
  if (!granted(principal, 'write')) return;
  const importer = new SharedWikiImporter(vault, { configPath: config.sharedWikiConfig });
  ctx.tools.register(defineTool({ name: 'memory_shared_wiki_import_prepare',
    description: 'Prepare a complete signed copy proposal from a configured source and required catalog expectedCommit. Read/write required; no capture, extraction, model or approval. Compiled material, not original raw evidence. Inspect the whole proposal before separate import_apply with confirm:true; plaintext offline copies cannot be recalled. Paths, identities and grants remain host-owned.',
    parameters: {
      sourceId: { type: 'string', required: true, description: 'Host-configured source name from the shared catalog.' },
      expectedCommit: { type: 'string', required: true, description: 'Full catalog pin, not a selectable commit override.' },
      pageKeys: { type: 'array', items: { type: 'string' }, required: true, description: '1–25 distinct Wiki keys, at most 200 characters each.' },
      scope: { type: 'string', enum: scopes, description: 'Optional tighter destination scope; never broadens source scope.' },
      sensitivity: { type: 'string', enum: sensitivities, description: 'Optional higher destination sensitivity.' },
      includeSensitive: { type: 'boolean', description: 'Explicitly select authorized sensitive content.' },
      includeSecret: { type: 'boolean', description: 'Explicitly select authorized secret content; keys remain required.' },
    }, output: jsonOutput,
    async execute(args, exec) { return runJson(vault, exec.signal, async () => {
      const prepared = await importer.prepare(wikiToolInput(sharedWikiImportPrepareSchema, args));
      return wikiToolResult(prepared, prepared.plan, 'memory_shared_wiki_import_apply');
    }); },
  }));
  if (granted(principal, 'review')) ctx.tools.register(defineTool({ name: 'memory_shared_wiki_import_apply',
    description: 'Explicitly confirm a completely reviewed signed copy with read/write/review authority and confirm:true. Rechecks current host source, pin, grants and keys. Retains immutable compiled evidence only, no Wiki approval or integration. Plaintext offline copies cannot be recalled.',
    parameters: {
      plan: { type: 'object', additionalProperties: true, required: true, description: 'Complete unchanged copy plan returned by import_prepare.' },
      confirm: { type: 'boolean', required: true, description: 'Must be true after explicit approval of the complete copy proposal.' },
    }, output: jsonOutput,
    async execute(args, exec) { return runJson(vault, exec.signal, () => {
      const input = wikiToolInput(sharedWikiImportApplySchema, args);
      return importer.apply(input.plan, { confirm: input.confirm });
    }); },
  }));
}

function registerExperienceTools(ctx: Context, vault: MemoryVault, principal: Principal, config: Config): void {
  if (granted(principal, 'write')) ctx.tools.register(defineTool({
    name: 'memory_experience_capture',
    description: 'Record an unverified execution trace as immutable evidence. Fields: family, taskId, runId, context, actions, observedResult, outcome (success/failure/partial), limitations. No extraction, automatic validation, promotion or execution.',
    parameters: {
      trace: { type: 'object', additionalProperties: true, required: true, description: 'Complete structured experience trace. Observations are not independently verified facts.' },
      scope: { type: 'string', enum: scopes, description: 'Optional classification; defaults to the server configuration.' },
      sensitivity: { type: 'string', enum: sensitivities, description: 'Optional sensitivity; defaults to the server configuration.' },
    }, output: jsonOutput,
    async execute(args, exec) {
      return runJson(vault, exec.signal, async () => {
        const input = experienceToolInput(experienceCaptureToolSchema, args);
        return experienceToolResult(await vault.experienceCapture(input.trace, {
          scope: input.scope ?? config.defaultScope, sensitivity: input.sensitivity ?? config.defaultSensitivity,
        }));
      });
    },
  }));
  if (granted(principal, 'read') && granted(principal, 'write')) ctx.tools.register(defineTool({
    name: 'memory_experience_prepare',
    description: 'Prepare a signed expiring proposal with traceIds, name, description, procedure, conditions, limitations and optional confidential selection. Not approval or validation. Only trusted host library code may supply an evaluator; no runner/module path is accepted.',
    parameters: { proposal: { type: 'object', additionalProperties: true, required: true, description: 'Complete source-backed proposal input; current read/write authority still applies.' } }, output: jsonOutput,
    async execute(args, exec) {
      return runJson(vault, exec.signal, async () => {
        const input = experienceToolInput(experiencePrepareToolSchema, args);
        return experienceToolResult(await vault.experiencePrepare(input.proposal));
      });
    },
  }));
  if (granted(principal, 'read') && granted(principal, 'review')) ctx.tools.register(defineTool({
    name: 'memory_experience_export',
    description: 'Explicitly return complete skill file strings for a stored passing host-run validation. Current sources, tenant, keys, expiry and private selection still apply. Plaintext copies cannot be recalled. No installation, execution, publication or new grants.',
    parameters: {
      validationId: { type: 'string', required: true, description: 'Stored validation evidence ID (ev- plus 12 lowercase hex digits).' },
      confirm: { type: 'boolean', required: true, description: 'Must be true after explicit review of this export.' },
      includeSensitive: { type: 'boolean', description: 'Explicitly select authorized sensitive material.' },
      includeSecret: { type: 'boolean', description: 'Explicitly select authorized secret material; keys remain required.' },
    }, output: jsonOutput,
    async execute(args, exec) {
      return runJson(vault, exec.signal, async () => {
        const { validationId, ...options } = experienceToolInput(experienceExportToolSchema, args);
        return experienceToolResult(await vault.experienceExport(validationId, options));
      });
    },
  }));
}

function registerWikiTools(ctx: Context, vault: MemoryVault, principal: Principal, config: Config): void {
  const availabilityParameters = {
    pageKeys: { type: 'array' as const, items: { type: 'string' as const }, required: true as const, description: '1–25 distinct current Wiki keys, at most 200 characters each.' },
    includeSensitive: { type: 'boolean' as const, description: 'Explicitly select authorized sensitive material.' },
    includeSecret: { type: 'boolean' as const, description: 'Explicitly select authorized secret material; keys remain required.' },
  };
  if (granted(principal, 'read') && granted(principal, 'write')) ctx.tools.register(defineTool({
    name: 'memory_wiki_observe',
    description: 'Explicitly save a signed immutable observation of current committed pages and exact dependencies with read/write authority and confirm:true. Host time and identity are not caller inputs. Partial local evidence, not first learning or proof of understanding. No approval, execution or content changes.',
    parameters: { ...availabilityParameters, confirm: { type: 'boolean', required: true, description: 'Must be true after explicit review of this observation write.' } },
    output: jsonOutput,
    async execute(args, exec) {
      return runJson(vault, exec.signal, () => vault.wikiObserveAvailability(wikiToolInput(availabilityObserveSchema, args)));
    },
  }));
  if (granted(principal, 'read')) {
    ctx.tools.register(defineTool({
      name: 'memory_wiki_as_known_at',
      description: 'Read exact committed knowledge supported by explicit signed local observations at or before at, never inferred from Git dates. Legacy/ambiguous history stays unknown. Optional observationIds restrict coverage; outside newer/conflicting observations are not ruled out. Current source/key/tenant/withdrawal/private checks apply. No model or writes; complete escaped result limited to 9 MiB.',
      parameters: { ...availabilityParameters,
        at: { type: 'string', required: true, description: 'ISO timestamp with timezone and at most millisecond precision.' },
        observationIds: { type: 'array', items: { type: 'string' }, description: 'Optional 1–40 distinct ev- IDs; restricts search to these observations.' },
      }, output: jsonOutput,
      async execute(args, exec) {
        return runJson(vault, exec.signal, async () => wikiToolResult(await vault.wikiAsKnownAt(wikiToolInput(availabilityAtSchema, args))));
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_snapshot',
      description: 'Read 1–25 complete Wiki pages and dependencies using exactly one full local ancestor commit OR at ISO timestamp. Date lookup scans at most 2000 current first-parent commits by committer time, not as-known-at truth. Current permission, withdrawal, expiry and explicit confidential selection apply. No checkout, model or import. Complete escaped review is limited to 9 MiB.',
      parameters: {
        commit: { type: 'string', description: 'Full lowercase 40/64-character local ancestor hash; exactly one of commit/at. No symbolic refs or fetching.' },
        at: { type: 'string', description: 'ISO timestamp with timezone and at most millisecond precision; exactly one of at/commit. Uses Git committer time, not fact-effective dates.' },
        pageKeys: { type: 'array', items: { type: 'string' }, required: true, description: '1–25 distinct Wiki keys, at most 200 characters each.' },
        includeSensitive: { type: 'boolean', description: 'Explicitly select sensitive content; current authority is still required.' },
        includeSecret: { type: 'boolean', description: 'Explicitly select secret content; current authority and keys are still required.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        return runJson(vault, exec.signal, async () => wikiToolResult(await vault.wikiSnapshot(wikiToolInput(wikiSnapshotToolSchema, args))));
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_preview',
      description: 'Read an authorized before/after comparison of a proposed Wiki plan; validate permissions and source revisions without applying it.',
      parameters: { plan: { type: 'object', additionalProperties: true, required: true, description: 'Complete proposed Wiki plan.' } },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['plan']);
        return runJson(vault, exec.signal, () => vault.wikiPreview(args.plan));
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_catalog',
      description: 'Read authorized Wiki categories, summaries, page links, and revisions without writing knowledge.',
      parameters: {},
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, []);
        return runJson(vault, exec.signal, () => vault.wikiCatalog());
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_rules',
      description: 'Read authorized versioned Wiki purpose and maintenance rules.',
      parameters: {},
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, []);
        return runJson(vault, exec.signal, () => vault.wikiRules());
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_query',
      description: 'Navigate the authorized Wiki and return a cited answer with uncertainty. Filing requires a separate explicit operation.',
      parameters: {
        question: { type: 'string', required: true, description: 'Question to answer from Wiki pages.' },
        maxPages: { type: 'integer', description: 'Maximum pages to read (1-50).' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['question', 'maxPages']);
        const question = boundedString(args.question, 'question', 100_000);
        const options = wikiPageBudget(args.maxPages);
        return runJson(vault, exec.signal, () => vault.wikiQuery(question, options));
      },
    }));
  }
  if (granted(principal, 'write')) {
    if (granted(principal, 'read')) ctx.tools.register(defineTool({
      name: 'memory_wiki_integration_prepare',
      description: 'Prepare human-authored Wiki integration from a retained imported evidence ID and exact target revision (zero creates). Keeps local support and imported restrictions/conflicts. No model, remote read or automatic approval. Inspect the complete comparison and preview before separate memory_wiki_apply with review permission. Private output requires explicit selection and keys.',
      parameters: {
        evidenceId: { type: 'string', required: true, description: 'Retained imported Wiki artifact evidence ID, not an ordinary raw evidence ID.' },
        pageKey: { type: 'string', required: true, description: 'Target Wiki key, at most 200 characters; not source: or legacy:.' },
        expectedRevision: { type: 'integer', required: true, description: 'Zero creates a new page; otherwise the exact current revision read by the caller.' },
        title: { type: 'string', required: true, description: 'Human-authored title, 1–300 characters.' },
        summary: { type: 'string', required: true, description: 'Human-authored summary, 1–2000 characters.' },
        body: { type: 'string', required: true, description: 'Complete human-authored Markdown body, 1–100000 characters.' },
        pageType: { type: 'string', enum: ['entity', 'concept', 'synthesis', 'comparison', 'query'], description: 'Optional page purpose; cannot change an existing target purpose.' },
        scope: { type: 'string', enum: scopes, description: 'Optional tighter scope.' },
        sensitivity: { type: 'string', enum: sensitivities, description: 'Optional higher sensitivity for authored content.' },
        status: { type: 'string', enum: ['active', 'conflicted'], description: 'May add a conflict; cannot clear an existing one.' },
        conditions: { type: 'array', items: { type: 'string' }, description: 'Up to 100 distinct additional conditions, each 1–4000 characters.' },
        uncertainty: { type: 'array', items: { type: 'string' }, description: 'Up to 100 distinct additional uncertainties, each 1–4000 characters.' },
        includeSensitive: { type: 'boolean', description: 'Explicitly select authorized sensitive input and output.' },
        includeSecret: { type: 'boolean', description: 'Explicitly select authorized secret input and output; keys remain required.' },
      }, output: jsonOutput,
      async execute(args, exec) { return runJson(vault, exec.signal, async () => {
        const prepared = await vault.wikiIntegrationPrepare(wikiToolInput(wikiIntegrationToolSchema, args));
        return wikiToolResult(prepared, prepared.plan);
      }); },
    }));
    if (granted(principal, 'read')) ctx.tools.register(defineTool({
      name: 'memory_wiki_merge_prepare',
      description: 'With read/write authority, prepare a signed same-vault historical/current merge from manually authored text. No model call, approval or apply flag. Inspect all comparison/preview text, then separately approve with memory_wiki_apply and review authority. No branch/shared-vault import. Complete escaped review and approval envelope must fit 9 MiB.',
      parameters: {
        fromCommit: { type: 'string', required: true, description: 'Full lowercase 40/64-character local ancestor commit hash.' },
        pageKey: { type: 'string', required: true, description: 'Existing compiled Wiki key, at most 200 characters; not an ordinary memory.' },
        expectedRevision: { type: 'integer', required: true, description: 'Positive safe integer revision actually read by the caller.' },
        body: { type: 'string', required: true, description: 'Complete manually authored Markdown, 1–100000 characters, without the generated-links marker.' },
        summary: { type: 'string', required: true, description: 'Manually authored summary, 1–2000 characters.' },
        title: { type: 'string', description: 'Optional manually authored title, 1–300 characters.' },
        includeSensitive: { type: 'boolean', description: 'Explicitly select authorized sensitive content.' },
        includeSecret: { type: 'boolean', description: 'Explicitly select authorized secret content; keys remain required.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        return runJson(vault, exec.signal, async () => {
          const prepared = await vault.wikiMergePrepare(wikiToolInput(wikiMergeToolSchema, args));
          return wikiToolResult(prepared, prepared.plan);
        });
      },
    }));
    if (granted(principal, 'read')) ctx.tools.register(defineTool({
      name: 'memory_wiki_correct',
      description: 'Capture a natural-language correction as immutable evidence and prepare a pending Wiki plan. Never approves or applies it.',
      parameters: {
        key: { type: 'string', required: true, description: 'Current Wiki page key (up to 200 characters).' },
        instruction: { type: 'string', required: true, description: 'Correction to preserve as evidence (up to 100000 characters).' },
        expectedRevision: { type: 'integer', description: 'Revision read by the caller; reject a newer target before saving evidence.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['key', 'instruction', 'expectedRevision']);
        const key = boundedString(args.key, 'key', 200);
        const instruction = boundedString(args.instruction, 'instruction', 100_000);
        const expectedRevision = args.expectedRevision === undefined ? undefined : boundedInteger(args.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
        return runJson(vault, exec.signal, () => vault.wikiCorrect(key, instruction,
          expectedRevision === undefined ? {} : { expectedRevision }));
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_ingest',
      description: 'Prepare a bounded linked-page plan from immutable evidence. apply=true additionally requires review permission before compilation.',
      parameters: {
        evidenceIds: { type: 'array', items: { type: 'string' }, required: true, description: 'One to 100 immutable evidence IDs.' },
        apply: { type: 'boolean', description: 'Explicitly apply the plan with additional review permission (default false).' },
        maxPages: { type: 'integer', description: 'Maximum existing pages to read, including mandatory source summaries (1-50).' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['evidenceIds', 'apply', 'maxPages']);
        const evidenceIds = boundedStringArray(args.evidenceIds, 'evidenceIds', 100, 512);
        if (!evidenceIds.length) failValidation('evidenceIds is required');
        const options = wikiPageBudget(args.maxPages);
        return runJson(vault, exec.signal, () => {
          if (args.apply) authorize(principal, 'review');
          return vault.wikiIngest({ evidenceIds, apply: args.apply ?? false, ...options });
        });
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_file',
      description: 'Prepare a reviewable query or comparison page from a cited Wiki answer. apply=true additionally requires review permission before any work.',
      parameters: {
        result: { type: 'object', additionalProperties: true, required: true, description: 'Complete result returned by memory_wiki_query; revalidated by the vault.' },
        title: { type: 'string', required: true, description: 'Page title (up to 300 characters).' },
        key: { type: 'string', description: 'Optional stable page key (up to 200 characters).' },
        pageType: { type: 'string', enum: ['query', 'comparison'], description: 'Page purpose (default query).' },
        apply: { type: 'boolean', description: 'Explicitly apply with additional review permission (default false).' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['result', 'title', 'key', 'pageType', 'apply']);
        const title = boundedString(args.title, 'title', 300);
        const key = optionalBoundedString(args.key, 'key', 200);
        const pageType = oneOf(args.pageType ?? 'query', ['query', 'comparison'] as const, 'pageType');
        return runJson(vault, exec.signal, () => {
          if (args.apply) authorize(principal, 'review');
          return vault.wikiFile(args.result, { title, pageType, apply: args.apply ?? false, ...(key === undefined ? {} : { key }) });
        });
      },
    }));
  }
  if (granted(principal, 'review')) {
    ctx.tools.register(defineTool({
      name: 'memory_wiki_apply',
      description: 'Validate and atomically apply an explicit Wiki ingest, filing, repair, human-authored merge or imported-evidence integration plan. Requires review permission. Call only after explicit approval of the complete reviewed plan.',
      parameters: { plan: { type: 'object', additionalProperties: true, required: true, description: 'Complete untrusted Wiki plan; paths, citations, authorization, and revisions are revalidated.' } },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['plan']);
        return runJson(vault, exec.signal, () => vault.wikiApply(args.plan));
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_revoke',
      description: 'Revoke a Wiki page by key while retaining auditable history.',
      parameters: {
        key: { type: 'string', required: true, description: 'Wiki page key (up to 200 characters).' },
        reason: { type: 'string', required: true, description: 'Revocation reason.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['key', 'reason']);
        const key = boundedString(args.key, 'key', 200);
        const reason = boundedString(args.reason, 'reason', 4_000);
        return runJson(vault, exec.signal, () => vault.wikiRevoke(key, reason));
      },
    }));
  }
  if (granted(principal, 'maintain')) {
    ctx.tools.register(defineTool({
      name: 'memory_wiki_migrate',
      description: 'Explicitly initialize compatible Wiki storage and default purpose/rules. Safe to repeat.',
      parameters: {},
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, []);
        return runJson(vault, exec.signal, () => vault.wikiMigrate());
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_set_rules',
      description: 'Create or revise Wiki purpose and instructions with maintain permission and an optional expected revision.',
      parameters: {
        purpose: { type: 'string', required: true, description: 'User-directed purpose (up to 4000 characters).' },
        instructions: { type: 'string', required: true, description: 'Wiki maintenance instructions (up to 100000 characters).' },
        scope: { type: 'string', enum: scopes, description: 'Rules scope.' },
        sensitivity: { type: 'string', enum: sensitivities, description: 'Rules sensitivity.' },
        expectedRevision: { type: 'integer', description: 'Expected current revision; 0 requires creation.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['purpose', 'instructions', 'scope', 'sensitivity', 'expectedRevision']);
        const purpose = boundedString(args.purpose, 'purpose', 4_000);
        const instructions = boundedString(args.instructions, 'instructions', 100_000);
        const expectedRevision = args.expectedRevision === undefined ? undefined
          : boundedInteger(args.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER);
        const scope = oneOf(args.scope ?? config.defaultScope, scopes, 'scope');
        const sensitivity = oneOf(args.sensitivity ?? config.defaultSensitivity, sensitivities, 'sensitivity');
        return runJson(vault, exec.signal, () => vault.wikiSetRules({ purpose, instructions, scope, sensitivity,
          ...(expectedRevision === undefined ? {} : { expectedRevision }) }));
      },
    }));
    ctx.tools.register(defineTool({
      name: 'memory_wiki_lint',
      description: 'Check Wiki structure and optionally return cited semantic suggestions. Never applies repairs; reports unavailable semantic analysis.',
      parameters: {
        semantic: { type: 'boolean', description: 'Request semantic suggestions (default false).' },
        maxPages: { type: 'integer', description: 'Maximum pages for semantic analysis (1-50).' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        wikiArguments(args, ['semantic', 'maxPages']);
        const options = wikiPageBudget(args.maxPages);
        return runJson(vault, exec.signal, () => vault.wikiLint({ semantic: args.semantic ?? false, ...options }));
      },
    }));
  }
}

function wikiArguments(args: object, allowed: readonly string[]): void {
  if (Object.keys(args).some((key) => !allowed.includes(key))) failValidation('Unsupported Wiki tool argument');
}

function wikiPageBudget(value: number | undefined): { maxPages?: number } {
  return value === undefined ? {} : { maxPages: boundedInteger(value, 'maxPages', 1, 50) };
}

function registerReadTools(ctx: Context, vault: MemoryVault, principal: Principal, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'memory_at',
    description: 'Inspect current retained ordinary memory by explicit effective time; current authority applies, unknown dates are excluded unless requested, and superseded/conflicted records carry warnings. Not historical Wiki or as-known-then reconstruction.',
    parameters: {
      at: { type: 'string', required: true, description: 'ISO timestamp with timezone, at most millisecond precision.' },
      key: { type: 'string', description: 'Optional exact normalized memory key.' },
      includeUnknown: { type: 'boolean', description: 'Include records with no explicit interval, marked unknown.' },
      offset: { type: 'integer', description: 'Nonnegative record offset.' },
      limit: { type: 'integer', description: 'Maximum records (1-100, capped by vault policy).' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      wikiArguments(args, ['at', 'key', 'includeUnknown', 'offset', 'limit']);
      if (args.includeUnknown !== undefined && typeof args.includeUnknown !== 'boolean') failValidation('includeUnknown must be boolean');
      return runJson(vault, exec.signal, () => vault.memoriesAt(boundedString(args.at, 'at', 64), {
        ...(args.key === undefined ? {} : { key: boundedString(args.key, 'key', 512) }),
        includeUnknown: args.includeUnknown ?? false, offset: boundedInteger(args.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER),
        limit: boundedInteger(args.limit ?? 30, 'limit', 1, 100), includeSensitive: false, includeSecret: false,
      }));
    },
  }));
  ctx.tools.register(defineTool({
    name: 'memory_source_timeline',
    description: 'Inspect authorized source versions by recorded time and current references. Does not reconstruct fact-effective history or restore erased data.',
    parameters: {
      sourceUri: { type: 'string', required: true, description: 'Exact source URI.' },
      from: { type: 'string', description: 'Inclusive recorded-time lower bound, ISO timestamp with timezone.' },
      to: { type: 'string', description: 'Inclusive recorded-time upper bound, ISO timestamp with timezone.' },
      offset: { type: 'integer', description: 'Nonnegative version offset.' },
      limit: { type: 'integer', description: 'Maximum versions (1-100).' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      wikiArguments(args, ['sourceUri', 'from', 'to', 'offset', 'limit']);
      const sourceUri = boundedString(args.sourceUri, 'sourceUri', 4096);
      return runJson(vault, exec.signal, () => vault.sourceTimeline(sourceUri, {
        ...(args.from === undefined ? {} : { from: boundedString(args.from, 'from', 100) }),
        ...(args.to === undefined ? {} : { to: boundedString(args.to, 'to', 100) }),
        offset: boundedInteger(args.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER),
        limit: boundedInteger(args.limit ?? 30, 'limit', 1, 100), includeSensitive: false, includeSecret: false,
      }));
    },
  }));
  ctx.tools.register(defineTool({
    name: 'memory_recall',
    description: 'Read approved ordinary memory and Wiki pages as complete records with source paths, revisions, conditions and uncertainty; no model call.',
    parameters: {
      query: { type: 'string', required: true, description: 'Current task or question.' },
      limit: { type: 'integer', description: 'Maximum matching records (1-50).' },
      maxCharacters: { type: 'integer', description: 'Complete-record output character budget (500-50000).' },
      maxTokens: { type: 'integer', description: 'Optional estimated token budget (1-100000), using conservative UTF-8 byte counting.' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      wikiArguments(args, ['query', 'limit', 'maxCharacters', 'maxTokens']);
      const query = boundedString(args.query, 'query', 2_000);
      const limit = boundedInteger(args.limit ?? config.defaultSearchLimit, 'limit', 1, 50);
      const maxCharacters = boundedInteger(args.maxCharacters ?? config.defaultMaxContextCharacters, 'maxCharacters', 500, 50_000);
      return runJson(vault, exec.signal, () => vault.recall(query, { limit, maxCharacters,
        ...(args.maxTokens === undefined ? {} : { maxTokens: boundedInteger(args.maxTokens, 'maxTokens', 1, 100_000) }),
        includeSensitive: false, includeSecret: false, semantic: false }));
    },
  }));
  ctx.tools.register(defineTool({
    name: 'memory_explain',
    description: 'Search authorized records and expose actual matching scores and search strategy. Does not infer hidden records or fabricate reasoning.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query.' },
      limit: { type: 'integer', description: 'Maximum matching records (1-50).' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      wikiArguments(args, ['query', 'limit']);
      const query = boundedString(args.query, 'query', 2_000);
      const limit = boundedInteger(args.limit ?? config.defaultSearchLimit, 'limit', 1, 50);
      return runJson(vault, exec.signal, () => vault.explain(query, { limit, includeSensitive: false, includeSecret: false, semantic: false }));
    },
  }));
  ctx.tools.register(defineTool({
    name: 'memory_context',
    description: 'Build authorized resident and retrieved memory context before a task that depends on durable knowledge.',
    parameters: {
      query: { type: 'string', required: true, description: 'Current task or question.' },
      limit: { type: 'integer', description: 'Maximum retrieved records (1-50).' },
      maxCharacters: { type: 'integer', description: 'Maximum returned characters (500-50000).' },
      maxTokens: { type: 'integer', description: 'Optional conservative estimated token budget (1-100000).' },
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
        ...(args.maxTokens === undefined ? {} : { maxTokens: boundedInteger(args.maxTokens, 'maxTokens', 1, 100_000) }),
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
      return runJson(vault, exec.signal, async () => modelDocument(await vault.get(boundedString(id, 'id', 512))));
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
  if (config.sharedWikiConfig !== undefined && typeof config.sharedWikiConfig !== 'string') failValidation('sharedWikiConfig must be a host-owned path');
  const configured = config.sharedWikiConfig ?? '', inherited = process.env.AMEM_SHARED_WIKI_CONFIG ?? '';
  const sharedWikiConfig = configured.trim() ? configured : inherited.trim() ? inherited : '';
  if (sharedWikiConfig && (sharedWikiConfig.length > 4096 || !isAbsolute(sharedWikiConfig) || /[\x00-\x1f\x7f]/.test(sharedWikiConfig))) failValidation('sharedWikiConfig requires an absolute host-owned path of at most 4096 characters');
  return {
    vaultRoot,
    defaultScope: oneOf(config.defaultScope, scopes, 'defaultScope'),
    defaultSensitivity: oneOf(config.defaultSensitivity, sensitivities, 'defaultSensitivity'),
    defaultSearchLimit: boundedInteger(config.defaultSearchLimit, 'defaultSearchLimit', 1, 50),
    defaultMaxContextCharacters: boundedInteger(config.defaultMaxContextCharacters, 'defaultMaxContextCharacters', 500, 50_000),
    automaticMemory: oneOf(config.automaticMemory ?? 'off', ['off', 'recall', 'recall-and-capture'] as const, 'automaticMemory'),
    automaticMaxInputCharacters: boundedInteger(config.automaticMaxInputCharacters ?? 2_000, 'automaticMaxInputCharacters', 100, 2_000),
    automaticMaxCaptureCharacters: boundedInteger(config.automaticMaxCaptureCharacters ?? 20_000, 'automaticMaxCaptureCharacters', 500, 100_000),
    sharedWikiConfig,
  };
}

function granted(principal: Principal, permission: Permission): boolean {
  return principal.permissions.includes('admin') || principal.permissions.includes(permission);
}

async function run<T>(vault: MemoryVault, signal: AbortSignal, action: () => Promise<T>, sanitizeErrors = true): Promise<T> {
  const lifetime = lifetimes.get(vault);
  const combined = combineSignals(lifetime ? [signal, lifetime.controller.signal] : [signal]);
  const pending = withOperation(combined.signal, async () => {
    try {
      const value = await action();
      throwIfCancelled();
      return value;
    } catch (error) { throw sanitizeErrors ? safeError(error) : error; }
  });
  lifetime?.pending.add(pending);
  try {
    return await pending;
  } catch (error) {
    // A pre-dispatch cancellation is thrown outside the callback above.
    if (sanitizeErrors && error instanceof AgentMemoryError) throw safeError(error);
    throw error;
  } finally {
    combined.dispose();
    lifetime?.pending.delete(pending);
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
