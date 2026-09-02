#!/usr/bin/env node
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { memoryKinds, scopes, sensitivities } from './types.js';
import { MemoryVault } from './vault.js';

const vaultRoot = resolve(process.argv[2] ?? process.env.AMEM_VAULT ?? process.cwd());

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'agent-memory-wiki', version: '0.1.0' },
    {
      instructions:
        'Call memory_context before answering questions that may depend on durable context. Capture raw events as evidence, propose atomic candidates, and consolidate them. Pending candidates are not truth. Sensitive and secret memory requires explicit authorization.',
    },
  );
  const vault = new MemoryVault(vaultRoot);

  server.registerTool(
    'memory_capture',
    {
      title: 'Capture immutable evidence',
      description: 'Idempotently append raw conversation, observation, or tool output to the evidence layer. Optionally use the configured LLM to extract candidates.',
      inputSchema: z.object({
        content: z.string().min(1),
        actorId: z.string().default('agent'),
        actorName: z.string().default('AI Agent'),
        sourceUri: z.string().optional(),
        scope: z.enum(scopes).default('user'),
        sensitivity: z.enum(sensitivities).default('internal'),
        extract: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    },
    async (input) => toolResult(await vault.capture({
      content: input.content,
      actor: { id: input.actorId, name: input.actorName },
      ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}),
      scope: input.scope,
      sensitivity: input.sensitivity,
      extract: input.extract,
    })),
  );

  server.registerTool(
    'memory_propose',
    {
      title: 'Propose a durable memory',
      description: 'Write an atomic memory candidate to the review queue. This does not make it canonical.',
      inputSchema: z.object({
        statement: z.string().min(1),
        key: z.string().min(1),
        kind: z.enum(memoryKinds).default('fact'),
        scope: z.enum(scopes).default('user'),
        sensitivity: z.enum(sensitivities).default('internal'),
        confidence: z.number().min(0).max(1).default(0.8),
        explicit: z.boolean().default(false),
        conditions: z.array(z.string()).default([]),
        tags: z.array(z.string()).default([]),
        expiresAt: z.string().optional(),
        evidence: z.array(z.string()).default([]),
        actorId: z.string().default('agent'),
        actorName: z.string().default('AI Agent'),
      }),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    },
    async (input) => toolResult(await vault.propose({
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
    }, input.evidence, { id: input.actorId, name: input.actorName })),
  );

  server.registerTool(
    'memory_search',
    {
      title: 'Search durable memory',
      description: 'Rank canonical Wiki memories and optionally follow one-hop links. Sensitive data is filtered before ranking by default.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(8),
        includeSensitive: z.boolean().default(false),
        includeSecret: z.boolean().default(false),
        includeEvidence: z.boolean().default(false),
        expandLinks: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    async (input) => toolResult(await vault.search(input.query, input)),
  );

  server.registerTool(
    'memory_context',
    {
      title: 'Build context for a question',
      description: 'Return the small resident memory card plus ranked long-tail Wiki snippets for the current question.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(8),
        maxCharacters: z.number().int().min(500).max(50_000).default(12_000),
        includeSensitive: z.boolean().default(false),
        includeSecret: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    async (input) => ({ content: [{ type: 'text' as const, text: await vault.context(input.query, input) }] }),
  );

  server.registerTool(
    'memory_get',
    {
      title: 'Read a memory document',
      description: 'Read one evidence, candidate, or canonical memory by id, including provenance metadata.',
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    async ({ id }) => toolResult(await vault.get(id)),
  );

  server.registerTool(
    'memory_consolidate',
    {
      title: 'Consolidate reviewed candidates',
      description: 'Promote eligible candidates, merge duplicates, and surface conflicts. Low-confidence and one-off procedural claims remain pending.',
      inputSchema: z.object({ actorId: z.string().default('agent'), actorName: z.string().default('AI Agent') }),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    },
    async (input) => toolResult(await vault.consolidate({ id: input.actorId, name: input.actorName })),
  );

  server.registerTool(
    'memory_review',
    {
      title: 'Approve or reject a candidate',
      description: 'Explicitly approve a candidate into canonical memory or reject it with a reason. Approval supersedes same-key conflicts.',
      inputSchema: z.discriminatedUnion('action', [
        z.object({ action: z.literal('approve'), candidateId: z.string(), actorId: z.string().default('reviewer'), actorName: z.string().default('Reviewer') }),
        z.object({ action: z.literal('reject'), candidateId: z.string(), reason: z.string().min(1), actorId: z.string().default('reviewer'), actorName: z.string().default('Reviewer') }),
      ]),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    },
    async (input) => toolResult(input.action === 'approve'
      ? await vault.approve(input.candidateId, { id: input.actorId, name: input.actorName })
      : await vault.reject(input.candidateId, input.reason, { id: input.actorId, name: input.actorName })),
  );

  server.registerTool(
    'memory_forget',
    {
      title: 'Revoke a memory',
      description: 'Stop a canonical memory from being retrieved while preserving its auditable history and evidence chain.',
      inputSchema: z.object({ selector: z.string().min(1), reason: z.string().min(1), actorId: z.string().default('reviewer'), actorName: z.string().default('Reviewer') }),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    },
    async (input) => toolResult(await vault.forget(input.selector, input.reason, { id: input.actorId, name: input.actorName })),
  );

  server.registerTool(
    'memory_doctor',
    {
      title: 'Audit memory health',
      description: 'Report pending reviews, conflicts, expired entries, dead links, and orphan pages.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    async () => toolResult(await vault.doctor()),
  );

  server.registerTool(
    'memory_history',
    {
      title: 'Read memory Git history',
      description: 'Show attributed Git commits for the whole vault or one path.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20), path: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    async (input) => toolResult(await vault.history(input.limit, input.path)),
  );

  return server;
}

function toolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

void serveStdio(createServer);
process.stderr.write(`agent-memory-wiki MCP serving ${vaultRoot}\n`);
