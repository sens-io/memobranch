import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { LlmClient } from '../src/llm.js';
import { cancellationError, operationSignal } from '../src/operation.js';
import { MemoryVault } from '../src/vault.js';
import { startWebServer, type WebHandle } from '../src/web.js';
import type { Principal } from '../src/policy.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class Compiler extends LlmClient {
  calls = 0;
  version = 1;
  entered = deferred();
  gate: ReturnType<typeof deferred> | null = null;
  constructor() { super({ apiKey: 'fixture', embeddingModel: '' }); }
  override async wiki<T>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    if (operation === 'navigate') return { keys: [] } as T;
    this.calls++; this.entered.resolve();
    if (this.gate) {
      const signal = operationSignal();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { signal?.removeEventListener('abort', abort); reject(cancellationError()); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        this.gate!.promise.then(() => { signal?.removeEventListener('abort', abort); resolve(); }, reject);
      });
    }
    const sources = (input as { sources: Array<{ id: string; body: string }> }).sources;
    return { pages: sources.map(source => ({ key: `source:${source.id}`, pageType: 'source', title: 'Source', summary: 'Summary',
      body: `${source.body}\nVersion ${this.version}`, evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] })) } as T;
  }
}
const masterKey = '37'.repeat(32);
async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/web-jobs-'));
  const llm = new Compiler(), vault = new MemoryVault(root, { masterKey, llm });
  await vault.initialize('Web jobs');
  const source = await vault.capture({ content: 'WEB_JOB_SOURCE_CANARY', scope: 'public', sensitivity: 'public', extract: false });
  const handles: WebHandle[] = [];
  t.after(async () => { llm.gate?.resolve(); await Promise.all(handles.map(handle => handle.stop())); await rm(root, { recursive: true, force: true }); });
  const start = async (principal?: Principal, key = masterKey) => {
    const tenantId = (await vault.config()).tenantId;
    const handle = await startWebServer(root, { llm, masterKey: key,
      ...(principal ? { principal: { ...principal, tenantId: principal.tenantId ?? tenantId } } : {}) }); handles.push(handle); return handle;
  };
  return { root, llm, vault, source, start };
}
async function call(handle: WebHandle, operation: string, data: unknown = {}, extra: Record<string, string> = {}) {
  const response = await fetch(`${handle.url}/api/${operation}`, { method: 'POST', headers: {
    Origin: handle.url, Authorization: `Bearer ${handle.token}`, 'Content-Type': 'application/json', ...extra,
  }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() as { result: any; error?: { code: string } } };
}
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (true) { const value = await read(); if (predicate(value)) return value; if (Date.now() > deadline) throw new Error('Persisted job did not settle'); await delay(20); }
}

test('Web jobs: accepted execution survives the response, persists encrypted progress and never auto-applies', async t => {
  const { vault, llm, source, start, root } = await fixture(t);
  const handle = await start(), head = await vault.git.run(['rev-parse', 'HEAD']);
  const enqueued = await call(handle, 'jobs-enqueue', { evidenceIds: [source.evidenceId], confirm: true });
  assert.equal(enqueued.status, 200); const id = enqueued.body.result.id;
  assert.equal(llm.calls, 0); assert.equal((await call(handle, 'jobs-show', { id })).body.result.status, 'queued');
  llm.gate = deferred();
  assert.deepEqual((await call(handle, 'jobs-run', { id, confirm: true })).body.result, { id, accepted: true });
  await llm.entered.promise;
  assert.equal((await call(handle, 'jobs-show', { id })).body.result.status, 'running');
  assert.equal((await call(handle, 'jobs-list')).body.result.length, 1);
  assert.equal((await vault.wikiCatalog()).length, 0);
  llm.gate.resolve();
  await until(() => vault.wikiJob(id), value => value.status === 'ready');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.doesNotMatch(await readFile(join(root, '.amem/wiki-jobs', `${id}.json`), 'utf8'), /WEB_JOB_SOURCE_CANARY/);
  const review = await call(handle, 'jobs-review', { id });
  assert.equal(review.status, 200); assert.deepEqual(review.body.result, await vault.wikiReviewJob(id));
  assert.equal(review.body.result.preview.pages[0]!.key, review.body.result.plan.pages[0]!.key);
  assert.ok(review.body.result.preview.pages[0]!.after.body.startsWith(review.body.result.plan.pages[0]!.body));
  assert.equal((await call(handle, 'jobs-apply', { id, proof: '0'.repeat(64), confirm: true })).body.error?.code, 'VALIDATION_FAILED');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const reviewer = await start({ ...vault.principal, permissions: ['read', 'review'] });
  assert.ok((await call(reviewer, 'jobs-apply', { id, proof: review.body.result.plan.proof, confirm: true })).body.result.commit);
  assert.equal(llm.calls, 1);
});

test('Web jobs: approval refuses a substituted plan after cancel/retry and retains current review authority', async t => {
  const { vault, llm, source, start } = await fixture(t), handle = await start();
  const job = await vault.wikiEnqueue({ evidenceIds: [source.evidenceId] }); await vault.wikiRunJob({ id: job.id });
  const before = (await call(handle, 'jobs-review', { id: job.id })).body.result;
  assert.equal((await call(handle, 'jobs-cancel', { id: job.id, confirm: true })).body.result.status, 'cancelled');
  assert.equal((await call(handle, 'jobs-retry', { id: job.id, confirm: true })).body.result.status, 'queued');
  assert.equal(llm.calls, 1, 'retry must not execute automatically');
  llm.version++;
  await vault.wikiRunJob({ id: job.id });
  const current = await vault.wikiReviewJob(job.id); assert.notEqual(current.plan.proof, before.plan.proof);
  await assert.rejects(vault.wikiApplyJob(job.id, before.plan.proof), { code: 'VALIDATION_FAILED' });
  assert.equal((await call(handle, 'jobs-apply', { id: job.id, proof: before.plan.proof, confirm: true })).status, 400);
  assert.equal((await vault.wikiCatalog()).length, 0);
  const reader = await start({ ...vault.principal, permissions: ['read'] });
  assert.equal((await call(reader, 'jobs-review', { id: job.id })).status, 200);
  assert.equal((await call(reader, 'jobs-apply', { id: job.id, proof: current.plan.proof, confirm: true })).status, 403);
  assert.ok((await call(handle, 'jobs-apply', { id: job.id, proof: current.plan.proof, confirm: true })).body.result.commit);
});

test('Web jobs: simultaneous starts reserve one owned attempt and explicit cancellation releases it', async t => {
  const { vault, llm, source, start } = await fixture(t), handle = await start();
  const one = await vault.wikiEnqueue({ evidenceIds: [source.evidenceId] }), two = await vault.wikiEnqueue({ evidenceIds: [source.evidenceId] });
  llm.gate = deferred();
  const starts = await Promise.all([one, two].map(job => call(handle, 'jobs-run', { id: job.id, confirm: true })));
  assert.equal(starts.filter(value => value.status === 200).length, 1);
  assert.equal(starts.filter(value => value.body.error?.code === 'LOCK_TIMEOUT').length, 1);
  await llm.entered.promise; assert.equal(llm.calls, 1);
  const id = starts.find(value => value.status === 200)!.body.result.id;
  assert.equal((await call(handle, 'jobs-cancel', { id, confirm: true })).status, 200);
  await until(() => vault.wikiJob(id), value => value.status === 'cancelled');
  await until(() => call(handle, 'jobs-run', { id: id === one.id ? two.id : one.id, confirm: true }), value => value.status === 200);
  llm.gate.resolve();
  await until(() => vault.wikiJobs(), values => values.some(value => value.status === 'ready'));
  assert.equal(llm.calls, 2); assert.equal((await vault.wikiCatalog()).length, 0);
});

test('Web jobs: shutdown cancels and awaits its worker without cancelling an independent worker', async t => {
  const { vault, llm, source, start } = await fixture(t), handle = await start();
  const job = await vault.wikiEnqueue({ evidenceIds: [source.evidenceId] }); llm.gate = deferred();
  assert.equal((await call(handle, 'jobs-run', { id: job.id, confirm: true })).status, 200); await llm.entered.promise;
  await handle.stop(); assert.equal((await vault.wikiJob(job.id)).status, 'cancelled');
  await vault.wikiRetryJob(job.id); llm.entered = deferred();
  const independent = vault.wikiRunJob({ id: job.id }); await llm.entered.promise;
  const second = await start(); await second.stop();
  assert.equal((await vault.wikiJob(job.id)).status, 'running');
  llm.gate.resolve(); assert.equal((await independent)!.status, 'ready');
});

test('Web jobs: strict schemas, confirmation, owner and current scope checks run before model calls', async t => {
  const { vault, source, llm, start } = await fixture(t), handle = await start();
  const job = await vault.wikiEnqueue({ evidenceIds: [source.evidenceId] });
  const foreign = await start({ ...vault.principal, id: 'other-operator' });
  for (const operation of ['jobs-show', 'jobs-review', 'jobs-run', 'jobs-cancel', 'jobs-retry', 'jobs-remove']) {
    const input = ['jobs-show', 'jobs-review'].includes(operation) ? { id: job.id } : { id: job.id, confirm: true };
    assert.equal((await call(foreign, operation, input)).body.error?.code, 'NOT_FOUND', operation);
  }
  assert.deepEqual((await call(foreign, 'jobs-list')).body.result, []);
  const reader = await start({ ...vault.principal, permissions: ['read'] });
  for (const operation of ['jobs-enqueue', 'jobs-run', 'jobs-cancel', 'jobs-retry', 'jobs-remove', 'jobs-apply']) {
    assert.equal((await call(reader, operation, {})).status, 403, operation);
  }
  for (const operation of ['jobs-run', 'jobs-cancel', 'jobs-retry', 'jobs-remove']) assert.equal((await call(handle, operation, { id: job.id })).status, 400);
  for (const extra of [{ principal: vault.principal }, { masterKey }, { apply: true }, { signal: {} }, { timeoutMs: 999999 }]) {
    assert.equal((await call(handle, 'jobs-enqueue', { evidenceIds: [source.evidenceId], confirm: true, ...extra })).status, 400);
  }
  assert.equal((await call(handle, 'jobs-apply', { id: job.id, confirm: true })).status, 400);
  assert.equal((await call(handle, 'jobs-run', { id: '../keys', confirm: true })).status, 400);
  for (const headers of [{ Origin: 'https://invalid.test' }, { Authorization: '' }]) assert.equal((await call(handle, 'jobs-list', {}, headers)).status, 403);
  const narrow = await start({ ...vault.principal, scopes: ['public'], maxSensitivity: 'public' });
  assert.deepEqual((await call(narrow, 'jobs-list')).body.result, []);
  assert.equal((await call(narrow, 'jobs-run', { id: job.id, confirm: true })).status, 403);
  assert.equal((await call(narrow, 'jobs-cancel', { id: job.id, confirm: true })).status, 200, 'owner can stop work after its context scope narrows');
  assert.equal((await call(narrow, 'jobs-remove', { id: job.id, confirm: true })).status, 200, 'owner can clean up without disclosing old context');
  assert.equal(llm.calls, 0); assert.equal((await vault.wikiCatalog()).length, 0);
});

test('Web jobs: missing master key and stale snapshots fail safely; removal destroys the job key', async t => {
  const { vault, source, llm, start } = await fixture(t), handle = await start();
  const missing = await start(undefined, '');
  assert.equal((await call(missing, 'jobs-enqueue', { evidenceIds: [source.evidenceId], confirm: true })).body.error?.code, 'ENCRYPTION_KEY_UNAVAILABLE');
  assert.equal(llm.calls, 0);
  const job = await vault.wikiEnqueue({ evidenceIds: [source.evidenceId] }); await vault.wikiRunJob({ id: job.id });
  const plan = await vault.wikiReviewJob(job.id);
  await vault.wikiSetRules({ purpose: 'New purpose', instructions: 'Changed rules.', scope: 'public', sensitivity: 'public' });
  assert.equal((await call(handle, 'jobs-review', { id: job.id })).body.error?.code, 'VALIDATION_FAILED');
  assert.equal((await call(handle, 'jobs-apply', { id: job.id, proof: plan.plan.proof, confirm: true })).status, 400);
  assert.equal((await call(handle, 'jobs-remove', { id: job.id, confirm: true })).body.result.removed, true);
  assert.equal(await vault.encryption.hasKey(job.id), false);
  assert.equal((await call(handle, 'jobs-show', { id: job.id })).status, 404);
});
