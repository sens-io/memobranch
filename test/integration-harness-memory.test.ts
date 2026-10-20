import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore, type Session, type SessionEvent } from '@deepseek-ai/dsh-session';
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import * as plugin from '../src/deepseek-harness.js';
import { LlmClient } from '../src/llm.js';
import { AgentMemoryError } from '../src/errors.js';
import { operationSignal, throwIfCancelled } from '../src/operation.js';
import { MemoryVault } from '../src/vault.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

class WikiFixture extends LlmClient {
  override async wiki<T>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    assert.equal(operation, 'compile');
    const sources = (input as { sources: Array<{ id: string }> }).sources;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string): WikiPageDraft => ({
      key, pageType, title: key, summary: 'Release deployment facts', body,
      evidenceIds: sources.map((source) => source.id), links: [], status: 'active',
      conditions: ['Only for staging deployments.'], uncertainty: ['Production behavior is not verified.'],
    });
    return { pages: [
      ...sources.map((source) => draft(`source:${source.id}`, 'source', '# Source\n\nAtlas deploys with pnpm.')),
      draft('entity:atlas', 'entity', '# Atlas deployment\n\nAtlas deploys with pnpm and literal {{untrusted_variable}} tokens.'),
    ] } as T;
  }
}

interface Harness {
  root: string;
  vault: MemoryVault;
  ctx: Context;
  makeSession(id?: string): Session;
  assemble(session: Session, signal?: AbortSignal): Promise<string>;
  flush(session: Session): Promise<void>;
  unload(): Promise<void>;
}
async function withHarness(mode: plugin.Config['automaticMemory'], action: (harness: Harness) => Promise<void>, permissions = 'read,write'): Promise<void> {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch', 'automatic-memory-test-'));
  const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('AMEM_') || key === 'OPENAI_API_KEY'));
  const originalFetch = globalThis.fetch;
  let ctx: Context | undefined;
  try {
    clearEnvironment();
    const vault = new MemoryVault(root, { llm: new WikiFixture({ apiKey: '', embeddingModel: '' }) });
    await vault.initialize('automatic-memory');
    Object.assign(process.env, {
      AMEM_TENANT_ID: (await vault.config()).tenantId,
      AMEM_PERMISSIONS: permissions, AMEM_ALLOWED_SCOPES: 'user,project,public', AMEM_MAX_SENSITIVITY: 'internal',
    });
    globalThis.fetch = async () => { throw new Error('Automatic integration tests must not make paid provider requests'); };
    ctx = new Context();
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(SessionStore);
    const fiber = ctx.plugin(plugin, {
      vaultRoot: root, defaultScope: 'project', defaultSensitivity: 'internal',
      defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000,
      ...(mode === undefined ? {} : { automaticMemory: mode }),
      automaticMaxCaptureCharacters: 2_000,
    });
    await fiber;
    const active = ctx;
    await action({
      root, vault, ctx: active,
      makeSession: (id) => active.sessions.create(id ? SessionId(id) : undefined),
      async assemble(session, signal) {
        // The driver owns the Agent; the test supplies only the identity/session
        // fields read by our adapter and uses the real SDK assembly service.
        const agent = { id: session.id, session } as Agent;
        return renderContextSnapshot(await active.systemPrompt.assemble({ agent, scope: agent, ...(signal ? { signal } : {}) }));
      },
      async flush(session) { await active.parallel('session/flush', session); },
      async unload() { await fiber.dispose(); },
    });
  } finally {
    await ctx?.fiber.dispose();
    globalThis.fetch = originalFetch;
    clearEnvironment();
    Object.assign(process.env, previous);
    await rm(root, { recursive: true, force: true });
  }
}
function clearEnvironment(): void { for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key]; }
function startTurn(session: Session, text: string, turn = 1): void {
  session.append('turn/start', { turn });
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' });
}
function completeTurn(session: Session, text: string, turn = 1): SessionEvent<'turn/end'> {
  session.append('assistant/message', { turn, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'fixture', model: 'fixture' } }) }, { surfaceOp: 'append' });
  return session.append('turn/end', { turn, reason: { kind: 'completed' } });
}

test('default privacy off contributes no context and writes no conversation evidence', async () => withHarness(undefined, async (harness) => {
  const session = harness.makeSession();
  const head = await harness.vault.git.run(['rev-parse', 'HEAD']);
  startTurn(session, 'private conversation text');
  assert.equal(await harness.assemble(session), '');
  completeTurn(session, 'private answer');
  await harness.flush(session);
  assert.equal((await harness.vault.listRecords({ collection: 'evidence' })).total, 0);
  assert.equal((await harness.vault.listRecords({ collection: 'candidates' })).total, 0);
  assert.equal(await harness.vault.git.run(['rev-parse', 'HEAD']), head);
}));

test('actual prompt lifecycle injects approved ordinary memory and Wiki revision/citations across sessions without a model call', async () => withHarness('recall', async (harness) => {
  const proposed = await harness.vault.propose({ key: 'deployment', kind: 'procedure', statement: 'Atlas releases require the staging check.', scope: 'project', sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [] });
  await harness.vault.approve(proposed.id);
  const source = await harness.vault.capture({ content: 'Atlas deployment uses pnpm in staging.', scope: 'project', sensitivity: 'internal' });
  await harness.vault.wikiMigrate();
  const plan = await harness.vault.wikiIngest({ evidenceIds: [source.evidenceId] });
  await harness.vault.wikiApply(plan.plan);
  const entity = (await harness.vault.wikiCatalog()).find((page) => page.key === 'entity:atlas')!;
  const page = await harness.vault.get(entity.id);
  const head = await harness.vault.git.run(['rev-parse', 'HEAD']);
  const sessionA = harness.makeSession();
  startTurn(sessionA, 'How does Atlas deployment work?');
  const first = await harness.assemble(sessionA);
  assert.match(first, /staging check/);
  assert.match(first, /pnpm/);
  assert.match(first, /\{\{untrusted_variable\}\}/, 'memory content is not evaluated as an SDK prompt template');
  assert.ok(first.includes(page.path));
  assert.match(first, /revision[^\n]*1|r1\b/i);
  assert.match(first, /Only for staging deployments/);
  assert.match(first, /Production behavior is not verified/);
  assert.ok(first.includes(source.evidencePath));
  assert.equal((await harness.assemble(sessionA)), first, 'assembly retries do not duplicate a named contribution');
  completeTurn(sessionA, 'Read-only response');
  await harness.flush(sessionA);
  const sessionB = harness.makeSession();
  startTurn(sessionB, 'How does Atlas deployment work?');
  assert.equal(await harness.assemble(sessionB), first);
  await harness.vault.wikiRevoke('entity:atlas', 'No longer valid');
  assert.doesNotMatch(await harness.assemble(sessionB), /literal \{\{untrusted_variable\}\}/);
  assert.notEqual(await harness.vault.git.run(['rev-parse', 'HEAD']), head, 'only the explicit revocation wrote knowledge');
}));

test('successful completed turns produce immutable evidence and pending episode candidates; event retries are idempotent', async () => withHarness('recall-and-capture', async (harness) => {
  const session = harness.makeSession('stable-session');
  startTurn(session, 'For Atlas use pnpm.');
  const end = completeTurn(session, 'Atlas uses pnpm.');
  await harness.flush(session);
  const evidence = await harness.vault.listRecords({ collection: 'evidence' });
  const candidates = await harness.vault.listRecords({ collection: 'candidates' });
  assert.equal(evidence.total, 1);
  assert.equal(candidates.total, 1);
  const candidate = await harness.vault.get(candidates.items[0]!.id);
  const evidenceDocument = await harness.vault.get(evidence.items[0]!.id);
  assert.equal(candidate.meta.status, 'pending');
  assert.equal(candidate.meta.kind, 'episode');
  assert.deepEqual(candidate.meta.evidence, [evidenceDocument.path]);
  assert.equal((await harness.vault.listRecords({ collection: 'memories' })).total, 0);
  const bytes = await readFile(join(harness.root, evidenceDocument.path), 'utf8');
  assert.match(bytes, /immutable: true/);
  assert.match(bytes, /User:\nFor Atlas use pnpm/);
  const head = await harness.vault.git.run(['rev-parse', 'HEAD']);
  // Simulate the host retrying an already committed notification.
  harness.ctx.emit('session/event', session, end);
  harness.ctx.emit('session/event', session, end);
  await harness.flush(session);
  assert.equal((await harness.vault.listRecords({ collection: 'candidates' })).total, 1);
  assert.equal(await readFile(join(harness.root, evidenceDocument.path), 'utf8'), bytes);
  assert.equal(await harness.vault.git.run(['rev-parse', 'HEAD']), head);
}));

test('aborted, blocked, failed, oversized, synthetic-only and read-only turns never create automatic candidates', async () => {
  await withHarness('recall-and-capture', async (harness) => {
    for (const reason of [{ kind: 'aborted', reason: { kind: 'user' } }, { kind: 'blocked' }, { kind: 'error', error: { code: 'UNKNOWN', message: 'test' } }] as const) {
      const session = harness.makeSession();
      startTurn(session, 'Unsuccessful input');
      session.append('turn/end', { turn: 1, reason });
      await harness.flush(session);
    }
    const large = harness.makeSession();
    startTurn(large, 'x'.repeat(2_001));
    completeTurn(large, 'Short answer');
    await harness.flush(large);
    const synthetic = harness.makeSession();
    synthetic.append('turn/start', { turn: 1 });
    synthetic.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Injected plugin context' }], source: { kind: 'plugin', plugin: 'fixture' } }), { surfaceOp: 'append' });
    assert.equal(await harness.assemble(synthetic), '');
    completeTurn(synthetic, 'Synthetic response');
    await harness.flush(synthetic);
    const disposed = harness.makeSession();
    harness.ctx.emit('session/disposed', disposed);
    startTurn(disposed, 'Disposed before the first automatic operation');
    assert.equal(await harness.assemble(disposed), '');
    completeTurn(disposed, 'Late host retry after session disposal');
    await harness.flush(disposed);
    const empty = harness.makeSession();
    startTurn(empty, 'A turn without assistant text');
    completeTurn(empty, '');
    await harness.flush(empty);
    assert.equal((await harness.vault.listRecords({ collection: 'evidence' })).total, 0);
  });
  await withHarness('recall-and-capture', async (harness) => {
    const session = harness.makeSession();
    startTurn(session, 'Read-only input');
    completeTurn(session, 'Read-only output');
    await harness.flush(session);
    assert.equal((await harness.vault.listRecords({ collection: 'evidence' })).total, 0);
  }, 'read');
});

test('assembly cancellation is isolated, and plugin unload aborts and drains active recall before removing hooks', async () => withHarness('recall', async (harness) => {
  const original = MemoryVault.prototype.recall;
  const requests: Array<{ signal: AbortSignal; release(): void }> = [];
  MemoryVault.prototype.recall = async function (query, options) {
    if (this.root !== harness.root) return original.call(this, query, options);
    const signal = operationSignal()!;
    await new Promise<void>((resolve) => {
      requests.push({ signal, release: resolve });
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    throwIfCancelled();
    return original.call(this, query, options);
  };
  try {
    const first = harness.makeSession();
    const second = harness.makeSession();
    startTurn(first, 'First query');
    startTurn(second, 'Second query');
    const controller = new AbortController();
    const pendingA = harness.assemble(first, controller.signal);
    const pendingB = harness.assemble(second);
    const settledA = pendingA.then(() => false, (error: unknown) => error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED');
    await until(() => requests.length === 2);
    controller.abort();
    assert.equal(await settledA, true);
    assert.equal(requests[0]!.signal.aborted, true);
    assert.equal(requests[1]!.signal.aborted, false);
    const settledB = pendingB.then(() => false, (error: unknown) => error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED');
    await harness.unload();
    assert.equal(await settledB, true);
    assert.equal(requests[1]!.signal.aborted, true);
    assert.equal(await harness.assemble(second), '');
  } finally {
    for (const request of requests) request.release();
    MemoryVault.prototype.recall = original;
  }
}));

test('plugin unload cancels and drains automatic capture, and later session notifications cannot restart it', async () => withHarness('recall-and-capture', async (harness) => {
  const original = MemoryVault.prototype.capture;
  let signal: AbortSignal | undefined;
  MemoryVault.prototype.capture = async function (options) {
    if (this.root !== harness.root) return original.call(this, options);
    signal = operationSignal()!;
    await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }));
    throwIfCancelled();
    return original.call(this, options);
  };
  try {
    const session = harness.makeSession();
    startTurn(session, 'Capture waiting at unload');
    const end = completeTurn(session, 'This must not be saved after cancellation.');
    await until(() => signal !== undefined);
    await harness.unload();
    assert.equal(signal!.aborted, true);
    harness.ctx.emit('session/event', session, end);
    await harness.flush(session);
    assert.equal((await harness.vault.listRecords({ collection: 'evidence' })).total, 0);
    assert.equal((await harness.vault.listRecords({ collection: 'candidates' })).total, 0);
  } finally { MemoryVault.prototype.capture = original; }
}));

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for integration operation'); await tick(); }
}
