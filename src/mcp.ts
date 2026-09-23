#!/usr/bin/env node
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { toAgentMemoryError } from './errors.js';
import { MaintenanceService } from './maintenance.js';
import { throwIfCancelled, withOperation } from './operation.js';
import { authorize, principalFromEnv } from './policy.js';
import { memoryKinds, scopes, sensitivities } from './types.js';
import { MemoryVault } from './vault.js';

import { VERSION } from './version.js';
const vaultRoot = resolve(process.argv[2] ?? process.env.AMEM_VAULT ?? process.cwd());

function createServer(): McpServer {
  const principal = principalFromEnv();
  const vault = new MemoryVault(vaultRoot, { principal });
  const server = new McpServer(
    { name: 'memobranch', version: VERSION },
    { instructions: 'Call memory_context before using durable context. Identity and authorization are server-owned. Pending candidates are not truth; confidential retrieval requires both policy authorization and an encryption key.' },
  );

  server.registerTool('memory_capture', {
    title: 'Capture immutable evidence',
    description: 'Idempotently capture evidence and optionally extract candidates.',
    inputSchema: z.object({
      content: z.string().min(1).max(1_000_000),
      sourceUri: z.string().max(2_048).optional(),
      scope: z.enum(scopes).default('user'),
      sensitivity: z.enum(sensitivities).default('internal'),
      extract: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  }, async (input) => execute(() => vault.capture({
    content: input.content,
    ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}),
    scope: input.scope,
    sensitivity: input.sensitivity,
    extract: input.extract,
  })));

  server.registerTool('memory_propose', {
    title: 'Propose a durable memory',
    description: 'Write an atomic candidate to the review queue.',
    inputSchema: z.object({
      statement: z.string().min(1).max(1_000_000),
      key: z.string().min(1).max(512),
      kind: z.enum(memoryKinds).default('fact'),
      scope: z.enum(scopes).default('user'),
      sensitivity: z.enum(sensitivities).default('internal'),
      confidence: z.number().min(0).max(1).default(0.8),
      explicit: z.boolean().default(false),
      conditions: z.array(z.string().max(2_000)).max(100).default([]),
      tags: z.array(z.string().max(200)).max(100).default([]),
      expiresAt: z.string().optional(),
      evidence: z.array(z.string().max(2_048)).max(100).default([]),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async (input) => execute(() => vault.propose({
    statement: input.statement,
    key: input.key,
    kind: input.kind,
    scope: input.scope,
    sensitivity: input.sensitivity,
    confidence: input.confidence,
    explicit: input.explicit,
    conditions: input.conditions,
    tags: input.tags,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  }, input.evidence)));

  server.registerTool('memory_search', {
    title: 'Search durable memory',
    description: 'Search canonical memory with authorization applied before ranking and expansion.',
    inputSchema: z.object({
      query: z.string().min(1).max(2_000),
      limit: z.number().int().min(1).max(50).default(8),
      includeSensitive: z.boolean().default(false),
      includeSecret: z.boolean().default(false),
      includeEvidence: z.boolean().default(false),
      expandLinks: z.boolean().default(true),
      semantic: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async (input) => execute(() => vault.searchDetailed(input.query, input)));

  server.registerTool('memory_version', {
    title: 'Read service version',
    description: 'Return the stable package and vault schema versions.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async () => execute(async () => ({ version: VERSION, schemaVersion: (await vault.config()).version })));

  server.registerTool('memory_config', {
    title: 'Read effective configuration',
    description: 'Return the non-secret vault policy, limits, feature, and remote configuration.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async () => execute(() => vault.config()));

  server.registerTool('memory_policy', {
    title: 'Read effective principal policy',
    description: 'Return the immutable server-owned principal permissions and clearances.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async () => execute(async () => ({ principal })));

  server.registerTool('memory_context', {
    title: 'Build authorized context',
    description: 'Return resident memory plus ranked snippets bounded for prompt use.',
    inputSchema: z.object({
      query: z.string().min(1).max(2_000),
      limit: z.number().int().min(1).max(50).default(8),
      maxCharacters: z.number().int().min(500).max(50_000).default(12_000),
      includeSensitive: z.boolean().default(false),
      includeSecret: z.boolean().default(false),
      semantic: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async (input) => executeText(() => vault.context(input.query, input)));

  server.registerTool('memory_get', {
    title: 'Read a memory document',
    description: 'Read one authorized evidence, candidate, or canonical record by id.',
    inputSchema: z.object({ id: z.string().min(1).max(512) }),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async ({ id }) => execute(() => vault.get(id)));

  server.registerTool('memory_consolidate', {
    title: 'Consolidate candidates',
    description: 'Promote eligible candidates, merge duplicates, and surface conflicts.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async () => execute(() => vault.consolidate()));

  server.registerTool('memory_review', {
    title: 'Approve or reject a candidate',
    description: 'Perform an authorized review decision.',
    inputSchema: z.discriminatedUnion('action', [
      z.object({ action: z.literal('approve'), candidateId: z.string().min(1).max(512) }),
      z.object({ action: z.literal('reject'), candidateId: z.string().min(1).max(512), reason: z.string().min(1).max(4_000) }),
    ]),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async (input) => execute(() => input.action === 'approve'
    ? vault.approve(input.candidateId)
    : vault.reject(input.candidateId, input.reason)));

  server.registerTool('memory_forget', {
    title: 'Revoke a memory',
    description: 'Stop retrieval while retaining auditable encrypted history.',
    inputSchema: z.object({ selector: z.string().min(1).max(512), reason: z.string().min(1).max(4_000) }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  }, async (input) => execute(() => vault.forget(input.selector, input.reason)));

  server.registerTool('memory_erase', {
    title: 'Cryptographically erase confidential memory',
    description: 'Administrator-only replacement with a tombstone and wrapped-key destruction.',
    inputSchema: z.object({ selector: z.string().min(1).max(512), reason: z.string().min(1).max(4_000) }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  }, async (input) => execute(() => vault.erase(input.selector, input.reason)));

  server.registerTool('memory_doctor', {
    title: 'Audit vault health',
    description: 'Validate configuration, Git, index, transactions, links, expiry, and conflicts.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async () => execute(() => vault.doctor()));

  server.registerTool('memory_history', {
    title: 'Read Git history',
    description: 'Show attributed vault commits.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20), path: z.string().max(2_048).optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async (input) => execute(() => vault.history(input.limit, input.path)));

  server.registerTool('memory_recover', {
    title: 'Recover transactions',
    description: 'Roll back incomplete writes and replay commit-ready transactions.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true },
  }, async () => execute(() => vault.recover()));

  server.registerTool('memory_reindex', {
    title: 'Rebuild persistent search index',
    description: 'Incrementally refresh lexical data and optional embedding vectors.',
    inputSchema: z.object({ semantic: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async ({ semantic }) => execute(() => vault.reindex(semantic)));

  server.registerTool('memory_remote_status', {
    title: 'Inspect remote synchronization',
    description: 'Fetch and report ahead, behind, and divergence state.',
    inputSchema: z.object({ fetch: z.boolean().default(true) }),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async ({ fetch }) => execute(() => vault.remoteStatus(fetch)));

  server.registerTool('memory_remote_sync', {
    title: 'Synchronize remote memory',
    description: 'Fetch, integrate conflict-safely, validate, and optionally push.',
    inputSchema: z.object({ push: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  }, async ({ push }) => execute(() => vault.sync({ push })));

  server.registerTool('memory_maintenance', {
    title: 'Run maintenance cycle',
    description: 'Recover, expire, reindex, diagnose, and optionally synchronize once.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true },
  }, async () => execute(() => new MaintenanceService(vault).runOnce()));

  server.registerTool('memory_wiki_catalog', {
    title: 'Navigate Wiki pages',
    description: 'Read the authorized Wiki catalog with page categories, summaries, and revisions.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async (_input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiCatalog()));

  server.registerTool('memory_wiki_rules', {
    title: 'Read Wiki purpose and rules',
    description: 'Read authorized versioned purpose and maintenance rules.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  }, async (_input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiRules()));

  server.registerTool('memory_wiki_set_rules', {
    title: 'Set Wiki purpose and rules',
    description: 'Create or revise Wiki rules with maintain permission and optional revision precondition.',
    inputSchema: z.strictObject({
      purpose: z.string().trim().min(1).max(4_000),
      instructions: z.string().trim().min(1).max(100_000),
      scope: z.enum(scopes).default('user'),
      sensitivity: z.enum(sensitivities).default('internal'),
      expectedRevision: z.number().int().min(0).optional(),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  }, async (input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiSetRules({
    purpose: input.purpose,
    instructions: input.instructions,
    scope: input.scope,
    sensitivity: input.sensitivity,
    ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
  })));

  server.registerTool('memory_wiki_migrate', {
    title: 'Initialize Wiki storage',
    description: 'Explicitly initialize compatible Wiki storage and default rules with maintain permission.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async (_input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiMigrate()));

  server.registerTool('memory_wiki_ingest', {
    title: 'Compile evidence into Wiki pages',
    description: 'Prepare a bounded linked-page plan with write permission. Only apply=true commits it, requiring review permission before compilation.',
    inputSchema: z.strictObject({
      evidenceIds: z.array(z.string().trim().min(1).max(512)).min(1).max(100),
      apply: z.boolean().default(false),
      maxPages: z.number().int().min(1).max(50).optional(),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  }, async (input, ctx) => executeWiki(ctx.mcpReq.signal, () => {
    if (input.apply) authorize(principal, 'review');
    return vault.wikiIngest({ evidenceIds: input.evidenceIds, apply: input.apply,
      ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }) });
  }));

  server.registerTool('memory_wiki_apply', {
    title: 'Apply an approved Wiki plan',
    description: 'Validate and atomically apply an explicit ingest, filing, or repair plan with review permission. Plans remain untrusted input.',
    inputSchema: z.strictObject({ plan: z.record(z.string(), z.unknown()) }),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async (input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiApply(input.plan)));

  server.registerTool('memory_wiki_query', {
    title: 'Ask a cited Wiki question',
    description: 'Navigate authorized Wiki pages and return a cited answer with uncertainty. Never files the answer automatically.',
    inputSchema: z.strictObject({
      question: z.string().trim().min(1).max(8_000),
      maxPages: z.number().int().min(1).max(50).optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false },
  }, async (input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiQuery(input.question,
    input.maxPages === undefined ? {} : { maxPages: input.maxPages })));

  server.registerTool('memory_wiki_file', {
    title: 'File an explicit Wiki answer',
    description: 'Prepare a reviewable query or comparison page from a Wiki query result with write permission. apply=true additionally requires review before any work.',
    inputSchema: z.strictObject({
      result: z.record(z.string(), z.unknown()),
      title: z.string().trim().min(1).max(300),
      key: z.string().trim().min(1).max(200).optional(),
      pageType: z.enum(['query', 'comparison']).default('query'),
      apply: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  }, async (input, ctx) => executeWiki(ctx.mcpReq.signal, () => {
    if (input.apply) authorize(principal, 'review');
    return vault.wikiFile(input.result, { title: input.title, pageType: input.pageType, apply: input.apply,
      ...(input.key === undefined ? {} : { key: input.key }) });
  }));

  server.registerTool('memory_wiki_lint', {
    title: 'Inspect Wiki health',
    description: 'Check Wiki structure and optionally request cited semantic suggestions with maintain permission. No repairs are applied; semantic analysis may be unavailable.',
    inputSchema: z.strictObject({
      semantic: z.boolean().default(false),
      maxPages: z.number().int().min(1).max(50).optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false },
  }, async (input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiLint({ semantic: input.semantic,
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }) })));

  server.registerTool('memory_wiki_revoke', {
    title: 'Revoke a Wiki page',
    description: 'Revoke a Wiki page by key with review permission, retaining its auditable history.',
    inputSchema: z.strictObject({ key: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(4_000) }),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  }, async (input, ctx) => executeWiki(ctx.mcpReq.signal, () => vault.wikiRevoke(input.key, input.reason)));

  return server;
}

async function executeWiki(signal: AbortSignal, action: () => Promise<unknown>) {
  return execute(() => withOperation(signal, async () => {
    const value = await action();
    throwIfCancelled();
    return value;
  }));
}

async function execute(action: () => Promise<unknown>) {
  try {
    return result(await action());
  } catch (error) {
    const normalized = toAgentMemoryError(error);
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(normalized.toJSON()) }] };
  }
}

async function executeText(action: () => Promise<string>) {
  try {
    return { content: [{ type: 'text' as const, text: await action() }] };
  } catch (error) {
    const normalized = toAgentMemoryError(error);
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(normalized.toJSON()) }] };
  }
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

void serveStdio(createServer);
process.stderr.write(`memobranch MCP ${VERSION} serving ${vaultRoot}\n`);
