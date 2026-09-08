import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import * as plugin from '../src/deepseek-harness.js';
import { GitStore } from '../src/git-store.js';
import { VaultTransaction } from '../src/transaction.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault, type CaptureResult } from '../src/vault.js';

test('real Harness registry keeps concurrent capture cancellation isolated', { timeout: 15_000 }, async () => {
  await withHarness(async (harness) => {
    const a = new AbortController();
    const b = new AbortController();
    const first = harness.capture('Remember the preference from session A.', a.signal);
    const second = harness.capture('Remember the preference from session B.', b.signal);
    await waitFor(() => harness.provider.requests.length === 2, 'both provider requests');
    const requestA = harness.provider.requests.find((request) => request.source.includes('session A'))!;
    const requestB = harness.provider.requests.find((request) => request.source.includes('session B'))!;
    assert.ok(requestA);
    assert.ok(requestB);

    a.abort();
    assertCancellation(await bounded(first, 'cancelled capture A'));
    assert.equal(requestA.signal.aborted, true);
    assert.equal(requestB.signal.aborted, false);
    assert.equal(b.signal.aborted, false);
    requestB.respond('Session B prefers concise answers.');
    const result = assertSuccess(await bounded(second, 'successful capture B'));
    assert.equal(result.candidates.length, 1);
    assert.equal((await markdownFiles(join(harness.root, 'evidence'))).length, 2);
    const candidates = await markdownFiles(join(harness.root, 'candidates'));
    assert.equal(candidates.length, 1);
    assert.match(await readFile(candidates[0]!, 'utf8'), /Session B prefers concise answers/);
    assert.equal(harness.provider.requests.length, 2, 'cancellation must not retry a provider request');
    await assertCleanRuntime(harness.root);
  });
});

test('real Harness cancellation after transaction readiness reports the one completed commit', { timeout: 15_000 }, async () => {
  await withHarness(async (harness) => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const originalCommit = GitStore.prototype.commit;
    let commitCalls = 0;
    const baselineHead = await harness.vault.git.run(['rev-parse', 'HEAD']);
    const controller = new AbortController();
    GitStore.prototype.commit = async function (...args: Parameters<GitStore['commit']>) {
      if (this.root === harness.root && args[0].startsWith('memory: capture ')) {
        commitCalls += 1;
        entered.resolve();
        await release.promise;
      }
      return originalCommit.apply(this, args);
    };
    try {
      const pending = harness.capture('Remember this evidence even if extraction is cancelled.', controller.signal);
      await bounded(entered.promise, 'ready transaction commit gate');
      const journals = await readdir(join(harness.root, '.amem', 'transactions'));
      assert.equal(journals.length, 1);
      assert.equal(JSON.parse(await readFile(join(harness.root, '.amem', 'transactions', journals[0]!), 'utf8')).phase, 'ready');
      controller.abort();
      release.resolve();
      const failure = assertCancellation(await bounded(pending, 'ready transaction completion'));
      const head = await harness.vault.git.run(['rev-parse', 'HEAD']);
      assert.notEqual(head, baselineHead);
      assert.equal(await harness.vault.git.run(['rev-list', '--count', `${baselineHead}..HEAD`]), '1');
      assert.deepEqual(failure.details?.committed, [{ operation: 'capture', commit: head }]);
      assert.equal(commitCalls, 1);
      assert.equal((await markdownFiles(join(harness.root, 'evidence'))).length, 1);
      assert.equal((await markdownFiles(join(harness.root, 'candidates'))).length, 0);
      assert.equal(harness.provider.requests.length, 0, 'extraction must not start after cancellation');
      assert.equal(await harness.vault.git.run(['status', '--porcelain']), '');
      await assertCleanRuntime(harness.root);
    } finally {
      controller.abort();
      release.resolve();
      GitStore.prototype.commit = originalCommit;
    }
  });
});

test('real Harness cancellation before transaction readiness rolls back managed writes', { timeout: 15_000 }, async () => {
  await withHarness(async (harness) => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const originalWrite = VaultTransaction.prototype.write;
    const baseline = await managedSnapshot(harness.root);
    const baselineHead = await harness.vault.git.run(['rev-parse', 'HEAD']);
    const controller = new AbortController();
    VaultTransaction.prototype.write = async function (...args: Parameters<VaultTransaction['write']>) {
      await originalWrite.apply(this, args);
      if (this.root === harness.root && args[0].startsWith('evidence/')) {
        entered.resolve();
        await release.promise;
      }
    };
    try {
      const pending = harness.capture('This interrupted evidence must be rolled back.', controller.signal);
      await bounded(entered.promise, 'managed evidence write gate');
      assert.equal((await markdownFiles(join(harness.root, 'evidence'))).length, 1, 'the gate follows a real disk write');
      controller.abort();
      release.resolve();
      const failure = assertCancellation(await bounded(pending, 'transaction rollback'));
      assert.equal(failure.details?.committed, undefined);
      assert.deepEqual(await managedSnapshot(harness.root), baseline);
      assert.equal(await harness.vault.git.run(['rev-parse', 'HEAD']), baselineHead);
      assert.equal(await harness.vault.git.run(['status', '--porcelain']), '');
      assert.equal(harness.provider.requests.length, 0);
      await assertCleanRuntime(harness.root);
    } finally {
      controller.abort();
      release.resolve();
      VaultTransaction.prototype.write = originalWrite;
    }
  });
});

test('real Harness cancellation while waiting for the vault lock leaves no action or contender', { timeout: 15_000 }, async () => {
  await withHarness(async (harness) => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const lockPath = join(harness.root, '.amem', 'write.lock');
    const baseline = await managedSnapshot(harness.root);
    const baselineHead = await harness.vault.git.run(['rev-parse', 'HEAD']);
    const held = withFileLock(lockPath, async () => {
      entered.resolve();
      await release.promise;
    });
    const controller = new AbortController();
    try {
      await bounded(entered.promise, 'lock owner');
      const pending = harness.capture('This lock waiter must perform no capture.', controller.signal);
      await waitFor(async () => (await readdir(`${lockPath}.queue`)).length === 2, 'capture lock contender');
      controller.abort();
      assertCancellation(await bounded(pending, 'cancelled lock waiter'));
      assert.equal(existsSync(lockPath), true, 'the cancelled waiter must preserve the other lock owner');
      assert.equal((await readdir(`${lockPath}.queue`)).length, 1, 'only the original owner remains queued');
      assert.deepEqual(await managedSnapshot(harness.root), baseline);
      assert.equal(await harness.vault.git.run(['rev-parse', 'HEAD']), baselineHead);
      assert.equal(harness.provider.requests.length, 0);
    } finally {
      controller.abort();
      release.resolve();
      await bounded(held, 'lock owner cleanup');
    }
    await assertCleanRuntime(harness.root);
  });
});

test('disposing the real Harness context cancels active providers and waits for their settlement', { timeout: 15_000 }, async () => {
  await withHarness(async (harness) => {
    harness.provider.delayAbort = true;
    const pending = harness.capture('This provider must settle before plugin disposal completes.');
    await waitFor(() => harness.provider.requests.length === 1, 'active provider');
    const request = harness.provider.requests[0]!;
    let disposed = false;
    const disposal = harness.dispose().then(() => { disposed = true; });
    try {
      await bounded(request.aborted, 'provider abort on context disposal');
      await nextTurn();
      assert.equal(disposed, false, 'disposal must wait while the provider is still settling');
      assert.equal(request.signal.aborted, true);
      request.finishAbort();
      assertCancellation(await bounded(pending, 'provider cancellation result'));
      await bounded(disposal, 'context disposal');
      assert.equal(disposed, true);
      assert.deepEqual(harness.tools.schemas(), [], 'all registered schemas are removed on disposal');
      assert.equal((await markdownFiles(join(harness.root, 'candidates'))).length, 0);
      await assertCleanRuntime(harness.root);
    } finally {
      request.finishAbort();
      await bounded(disposal, 'disposal cleanup');
    }
  });
});

interface Harness {
  root: string;
  vault: MemoryVault;
  tools: ToolRuntime;
  provider: FakeProvider;
  capture(content: string, signal?: AbortSignal): Promise<ToolExecutionResult>;
  dispose(): Promise<void>;
}

async function withHarness(action: (harness: Harness) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-harness-cancellation-'));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('AMEM_') || key === 'OPENAI_API_KEY'));
  const originalFetch = globalThis.fetch;
  const provider = new FakeProvider();
  const controllers: AbortController[] = [];
  const pending: Promise<ToolExecutionResult>[] = [];
  let ctx: Context | undefined;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => disposal ??= Promise.resolve(ctx?.fiber.dispose()).then(() => {});
  try {
    clearEnvironment();
    Object.assign(process.env, {
      AMEM_ACTOR_ID: 'harness-cancellation-test',
      AMEM_ACTOR_NAME: 'Harness Cancellation Test',
      AMEM_PERMISSIONS: 'read,write',
      AMEM_ALLOWED_SCOPES: 'user,project',
      AMEM_MAX_SENSITIVITY: 'internal',
      AMEM_LLM_API_KEY: 'fake-local-test-key',
      AMEM_LLM_BASE_URL: 'https://memobranch-tests.invalid/v1',
      AMEM_LLM_MODEL: 'test-model',
      AMEM_LLM_MAX_RETRIES: '0',
      AMEM_LLM_TIMEOUT_MS: '10000',
    });
    globalThis.fetch = provider.fetch;
    const vault = new MemoryVault(root);
    await vault.initialize('Harness cancellation tests');
    process.env.AMEM_TENANT_ID = (await vault.config()).tenantId;
    ctx = new Context();
    await bounded(Promise.resolve(ctx.plugin(SystemPrompt, {})), 'system prompt startup');
    await bounded(Promise.resolve(ctx.plugin(ToolRuntime, {})), 'tool runtime startup');
    await bounded(Promise.resolve(ctx.plugin(plugin, {
      vaultRoot: root,
      defaultScope: 'user',
      defaultSensitivity: 'internal',
      defaultSearchLimit: 8,
      defaultMaxContextCharacters: 12_000,
    })), 'MemoBranch startup');
    const tools = ctx.tools;
    assert.ok(tools.schemas().some((schema) => schema.name === 'memory_capture'));
    await action({
      root, vault, tools, provider, dispose,
      capture(content, signal) {
        const owner = new AbortController();
        controllers.push(owner);
        const result = tools.execute({
          callId: `capture-${pending.length}` as ToolExecutionInput['callId'],
          name: 'memory_capture',
          arguments: { content, extract: true },
          signal: signal ? AbortSignal.any([signal, owner.signal]) : owner.signal,
        });
        pending.push(result);
        return result;
      },
    });
  } finally {
    for (const controller of controllers) controller.abort();
    provider.releaseAll();
    try {
      await bounded(Promise.allSettled(pending), 'pending capture cleanup');
      await bounded(dispose(), 'Harness cleanup');
    } finally {
      globalThis.fetch = originalFetch;
      clearEnvironment();
      Object.assign(process.env, environment);
      await rm(root, { recursive: true, force: true });
    }
  }
}

interface ProviderRequest {
  source: string;
  signal: AbortSignal;
  aborted: Promise<void>;
  respond(statement: string): void;
  finishAbort(): void;
}

class FakeProvider {
  readonly requests: ProviderRequest[] = [];
  delayAbort = false;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://memobranch-tests.invalid/v1/chat/completions');
    assert.ok(init?.signal);
    const signal = init.signal;
    const body = JSON.parse(String(init.body));
    const source = JSON.parse(body.messages[1].content).source as string;
    const result = deferred<Response>();
    const aborted = deferred<void>();
    const finishAbort = deferred<void>();
    const onAbort = () => {
      aborted.resolve();
      if (this.delayAbort) {
        void finishAbort.promise.then(() => result.reject(new DOMException('Aborted', 'AbortError')));
      } else {
        result.reject(new DOMException('Aborted', 'AbortError'));
      }
    };
    this.requests.push({
      source, signal, aborted: aborted.promise,
      finishAbort: () => finishAbort.resolve(),
      respond: (statement) => result.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ memories: [{
          statement, key: statement, kind: 'preference', confidence: 1, explicit: true,
        }] }) } }],
      }), { headers: { 'Content-Type': 'application/json' } })),
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      return await result.promise;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };

  releaseAll(): void {
    for (const request of this.requests) {
      request.finishAbort();
      request.respond('Cleanup response.');
    }
  }
}

function clearEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
  }
}

function assertSuccess(result: ToolExecutionResult): CaptureResult {
  assert.equal(result.isError, false, JSON.stringify(result));
  return result.value as unknown as CaptureResult;
}

function assertCancellation(result: ToolExecutionResult): { code: string; details?: { committed?: unknown } } {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.ok(result.error);
  const payload = JSON.parse(result.error.message) as { error: { code: string; details?: { committed?: unknown } } };
  assert.equal(payload.error.code, 'OPERATION_CANCELLED');
  return payload.error;
}

async function assertCleanRuntime(root: string): Promise<void> {
  assert.equal(existsSync(join(root, '.amem', 'write.lock')), false);
  for (const directory of ['transactions', 'write.lock.queue']) {
    const path = join(root, '.amem', directory);
    assert.deepEqual(existsSync(path) ? await readdir(path) : [], [], `${directory} must be empty`);
  }
}

async function markdownFiles(root: string): Promise<string[]> {
  return (await filesUnder(root)).filter((path) => path.endsWith('.md'));
}

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === '.amem' || entry.name === '.git') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function managedSnapshot(root: string): Promise<Record<string, string>> {
  const entries = await Promise.all((await filesUnder(root)).map(async (path) => [relative(root, path), await readFile(path, 'utf8')]));
  return Object.fromEntries(entries);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!await condition()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
    await delay(5);
  }
}
