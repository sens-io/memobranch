#!/usr/bin/env node
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { toAgentMemoryError } from './errors.js';
import { MaintenanceService } from './maintenance.js';
import { principalFromEnv } from './policy.js';
import { memoryKinds, scopes, sensitivities } from './types.js';
import { MemoryVault } from './vault.js';

const VERSION = '1.0.0';
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
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
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
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
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
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
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
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
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
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  }, async () => execute(() => new MaintenanceService(vault).runOnce()));

  return server;
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
