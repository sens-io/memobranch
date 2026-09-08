import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { operationSignal, throwIfCancelled, withOperation } from '../src/operation.js';
import { VaultTransaction } from '../src/transaction.js';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];
const masterKey = '72'.repeat(32);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshVault(): Promise<MemoryVault> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-boundaries-'));
  roots.push(root);
  const vault = new MemoryVault(root, { masterKey });
  await vault.initialize('operation-boundaries');
  return vault;
}

test('cancellation during key destruction settles erasure and reports the durable commit', async () => {
  const vault = await freshVault();
  const candidate = await vault.propose({
    kind: 'fact', key: 'erase boundary', statement: 'CONFIDENTIAL_ERASURE_BOUNDARY',
    scope: 'user', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  const memory = await vault.approve(candidate.id);
  const controller = new AbortController();
  const erase = vault.encryption.erase.bind(vault.encryption);
  vault.encryption.erase = async (id) => {
    assert.equal(operationSignal(), undefined, 'irreversible section is cancellation-shielded');
    controller.abort();
    return erase(id);
  };
  let cancelled: AgentMemoryError | undefined;
  await assert.rejects(withOperation(controller.signal, () => vault.erase(memory.memoryId, 'test erasure')), (error) => {
    assert.ok(error instanceof AgentMemoryError);
    cancelled = error;
    return error.code === 'OPERATION_CANCELLED';
  });
  assert.equal(await vault.encryption.hasKey(memory.memoryId), false);
  const raw = await readFile(join(vault.root, memory.memoryPath), 'utf8');
  assert.match(raw, /memory-erased/);
  assert.doesNotMatch(raw, /CONFIDENTIAL_ERASURE_BOUNDARY/);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.deepEqual(cancelled?.safeDetails?.committed, [{ operation: 'erase', commit: head }]);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'erasures')), []);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'transactions')), []);
  assert.equal(existsSync(join(vault.root, '.amem', 'write.lock')), false);
  assert.equal((await vault.git.integrity()).dirty, false);
  assert.match(await readFile(vault.telemetry.auditPath, 'utf8'), /OPERATION_CANCELLED/);
});

test('started recovery finishes a ready journal after cancellation without losing its commit receipt', async () => {
  const vault = await freshVault();
  const transaction = await VaultTransaction.begin(vault.root, vault.git, vault.principal, 'test: recovery receipt');
  await transaction.write('log.md', `${await readFile(join(vault.root, 'log.md'), 'utf8')}\nRECOVERED_ONCE\n`);
  const commit = vault.git.commit.bind(vault.git);
  vault.git.commit = async () => { throw new Error('simulated crash after ready journal'); };
  await assert.rejects(transaction.commit(), /simulated crash/);
  const controller = new AbortController();
  vault.git.commit = async (...args) => {
    assert.equal(operationSignal(), undefined);
    controller.abort();
    return commit(...args);
  };
  let cancelled: AgentMemoryError | undefined;
  await assert.rejects(withOperation(controller.signal, async () => {
    await vault.recover();
    throwIfCancelled();
  }), (error) => {
    assert.ok(error instanceof AgentMemoryError);
    cancelled = error;
    return error.code === 'OPERATION_CANCELLED';
  });
  vault.git.commit = commit;
  const receipts = cancelled?.safeDetails?.committed as Array<{ operation: string; commit: string }>;
  assert.ok(receipts.some((entry) => entry.operation === 'recover' && /^[a-f0-9]{40}$/.test(entry.commit)));
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'transactions')), []);
  assert.equal(existsSync(join(vault.root, '.amem', 'write.lock')), false);
  assert.equal((await vault.git.integrity()).dirty, false);
  assert.equal((await vault.recover()).replayed.length, 0);
  assert.equal((await readFile(join(vault.root, 'log.md'), 'utf8')).split('RECOVERED_ONCE').length, 2);
});

test('cancellation on a retryable provider response does not dispatch another request', async () => {
  const controller = new AbortController();
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    controller.abort();
    return new Response('retryable', { status: 503 });
  };
  try {
    const llm = new LlmClient({ apiKey: 'fake-test-key', baseUrl: 'https://test.invalid', maxRetries: 4 });
    await assert.rejects(withOperation(controller.signal, () => llm.answer('question', 'context')), (error) =>
      error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
