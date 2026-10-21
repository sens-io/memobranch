import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { LlmClient } from '../src/llm.js';
import { serializeMarkdown } from '../src/markdown.js';
import { PersistentSearchIndex } from '../src/search.js';
import { MemoryVault } from '../src/vault.js';
import { operationSignal, withOperation } from '../src/operation.js';

const start = Date.parse('2030-01-01T00:00:00Z'), end = '2030-06-01T00:00:00.000Z', after = Date.parse('2031-01-01T00:00:00Z');
async function fixture(t: TestContext, count: number, endedCount = count) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/effective-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = start;
  t.mock.method(Date, 'now', () => now);
  const advance = () => { now = after; };
  const llm = new LlmClient({ apiKey: 'fixture', model: 'time-fixture', embeddingModel: 'time-vector',
    baseUrl: 'https://effective-fixture.invalid/v1', maxRetries: 1 });
  const vault = new MemoryVault(root, { llm }); await vault.initialize('provider boundaries');
  const config = await vault.config(); config.index.embeddingModel = 'time-vector';
  await writeFile(join(root, 'agent-memory.json'), JSON.stringify(config));
  for (let index = 0; index < count; index += 1) {
    await writeFile(join(root, 'wiki', `time-${String(index).padStart(2, '0')}.md`), serializeMarkdown({
      id: `mem-${String(index).padStart(12, '0')}`, type: 'memory', key: `time ${index}`, kind: 'fact', scope: 'public', sensitivity: 'public',
      status: 'active', confidence: 1, evidence: [], conditions: [], tags: [], revision: 1,
      createdAt: '2029-01-01T00:00:00Z', updatedAt: '2029-01-01T00:00:00Z', validatedAt: '2029-01-01T00:00:00Z',
      ...(index < endedCount ? { validUntil: end } : {}),
    }, `# shared fact\n\nshared fact ${index < endedCount ? 'ENDING_CANARY' : 'CURRENT_CANARY'} ${index}`));
  }
  const requests: Array<{ at: number; body: { input?: string[] }; raw: string }> = [];
  const intercept = (respond: (body: { input?: string[] }, raw: string) => Response | Promise<Response>) => {
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
      assert.ok(String(url).startsWith('https://effective-fixture.invalid/v1/'));
      const raw = String(options?.body), body = JSON.parse(raw) as { input?: string[] };
      requests.push({ at: Date.now(), body, raw });
      return respond(body, raw);
    });
  };
  return { vault, root, llm, advance, requests, intercept };
}
function embeddings(input: string[], vector: (text: string) => number[] = () => [1, 0]): Response {
  return new Response(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: vector(text) })) }), { status: 200 });
}

test('effective provider: 33 documents cannot send a later batch after its interval ends', async t => {
  const { vault, advance, requests, intercept } = await fixture(t, 33);
  intercept(body => { const response = embeddings(body.input!); advance(); return response; });
  assert.equal((await vault.reindex(true)).semanticStatus, 'ready');
  assert.equal(requests.length, 1); assert.equal(requests[0]!.body.input!.length, 32);
  assert.ok(requests.every(request => request.at < Date.parse(end)));
});

test('effective provider: real embedding transport retry rechecks the batch before resending', async t => {
  const { vault, advance, requests, intercept } = await fixture(t, 1);
  intercept(() => { advance(); return new Response('retry later', { status: 503 }); });
  assert.equal((await vault.reindex(true)).semanticStatus, 'degraded');
  assert.equal(requests.length, 1); assert.match(requests[0]!.raw, /ENDING_CANARY/);
});

test('effective provider: query wait cannot let an ended match consume the only result slot', async t => {
  const { vault, advance, requests, intercept } = await fixture(t, 2, 1);
  intercept(body => {
    if (body.input?.[0] === 'shared fact') { advance(); return embeddings(body.input); }
    return embeddings(body.input!, text => text.includes('ENDING_CANARY') ? [1, 0] : [0.1, 1]);
  });
  const result = await vault.searchDetailed('shared fact', { semantic: true, limit: 1, expandLinks: false });
  assert.equal(result.semanticStatus, 'ready');
  assert.deepEqual(result.hits.map(hit => hit.id), ['mem-000000000001']);
  assert.equal(requests.length, 2);
});

test('effective provider: final canonical rejection is replaced by the next current match', async t => {
  const { vault, root, llm, advance } = await fixture(t, 2, 1);
  const index = new PersistentSearchIndex(root, await vault.config(), llm, async path => {
    if (path.endsWith('time-00.md')) advance();
    return vault.get(path.endsWith('time-00.md') ? 'mem-000000000000' : 'mem-000000000001');
  });
  const result = await index.search('shared fact', { limit: 1, expandLinks: false });
  assert.deepEqual(result.hits.map(hit => hit.id), ['mem-000000000001']);
});

test('effective provider: real Wiki retry cannot resend a legacy navigation title after its interval ends', async t => {
  const { vault, advance, requests, intercept } = await fixture(t, 0);
  const source = await vault.capture({ content: 'ENDING_CANARY source', scope: 'public', sensitivity: 'public' });
  const candidate = await vault.propose({ key: 'ENDING_CANARY Wiki', statement: 'ENDING_CANARY source', kind: 'fact', scope: 'public', sensitivity: 'public',
    confidence: 1, explicit: true, conditions: [], tags: [] }, [source.evidencePath]);
  const memory = await vault.approve(candidate.id);
  await vault.setMemoryValidity(memory.memoryId, { validFrom: null, validUntil: end, expectedRevision: 1 });
  const before = await readFile(join(vault.root, source.evidencePath), 'utf8');
  intercept(() => { advance(); return new Response('retry later', { status: 503 }); });
  await assert.rejects(vault.wikiQuery('shared fact'), { code: 'VALIDATION_FAILED' });
  assert.equal(requests.length, 1); assert.match(requests[0]!.raw, /ENDING_CANARY/);
  assert.equal(await readFile(join(vault.root, source.evidencePath), 'utf8'), before);
});

for (const status of [200, 503]) {
  test(`effective provider: ordinary answer rejects stale context ${status === 503 ? 'before retry' : 'after provider response'}`, async t => {
    const { vault, advance, requests, intercept } = await fixture(t, 1);
    intercept(() => { advance(); return new Response(status === 503 ? 'retry later' : JSON.stringify({ choices: [{ message: { content: 'STALE_ANSWER' } }] }), { status }); });
    await assert.rejects(vault.answer('shared fact'), { code: 'VALIDATION_FAILED' });
    assert.equal(requests.length, 1); assert.match(requests[0]!.raw, /ENDING_CANARY/);
  });
}

test('effective provider: pre-request validation shares the transport deadline and cleans up', async t => {
  const { intercept, requests } = await fixture(t, 0);
  intercept(body => embeddings(body.input!));
  const client = new LlmClient({ apiKey: 'fixture', embeddingModel: 'time-vector', baseUrl: 'https://effective-fixture.invalid/v1', requestTimeoutMs: 100 });
  await assert.rejects(client.embed(['deadline'], 'time-vector', () => delay(5000, undefined, { signal: operationSignal() })), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.equal(requests.length, 0);
  assert.deepEqual(await client.embed(['later']), [[1, 0]]);
});

test('effective provider: caller cancellation interrupts pre-request validation without sending', async t => {
  const { intercept, requests } = await fixture(t, 0);
  intercept(body => embeddings(body.input!));
  const client = new LlmClient({ apiKey: 'fixture', embeddingModel: 'time-vector', baseUrl: 'https://effective-fixture.invalid/v1' });
  const controller = new AbortController();
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = withOperation(controller.signal, () => client.embed(['cancel'], 'time-vector', async () => {
    entered(); await delay(5000, undefined, { signal: operationSignal() });
  }));
  const stopped = assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
  await ready; controller.abort(); await stopped;
  assert.equal(requests.length, 0);
});

test('effective provider: deadline ends a non-cooperative guard that never settles', { timeout: 2000 }, async t => {
  const { intercept, requests } = await fixture(t, 0);
  intercept(body => embeddings(body.input!));
  const client = new LlmClient({ apiKey: 'fixture', embeddingModel: 'time-vector', baseUrl: 'https://effective-fixture.invalid/v1', requestTimeoutMs: 100 });
  const keepAlive = setTimeout(() => {}, 1500);
  try {
    await assert.rejects(client.embed(['never'], 'time-vector', () => new Promise<void>(() => {})), { code: 'DEPENDENCY_UNAVAILABLE' });
    assert.equal(requests.length, 0);
    assert.deepEqual(await client.embed(['later']), [[1, 0]]);
  } finally { clearTimeout(keepAlive); }
});

test('effective provider: non-cooperative guard cancellation detaches listeners and observes late failure', { timeout: 2000 }, async t => {
  const { intercept, requests } = await fixture(t, 0);
  intercept(body => embeddings(body.input!));
  const client = new LlmClient({ apiKey: 'fixture', embeddingModel: 'time-vector', baseUrl: 'https://effective-fixture.invalid/v1' });
  const controller = new AbortController();
  let entered!: () => void, rejectGuard!: (error: Error) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = withOperation(controller.signal, () => client.embed(['cancel-late'], 'time-vector', () => {
    entered(); return new Promise<void>((_resolve, reject) => { rejectGuard = reject; });
  }));
  const stopped = assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
  await ready; controller.abort(); await stopped;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  rejectGuard(new Error('late callback failure')); await delay(10);
  assert.equal(requests.length, 0);
});

test('effective provider: concurrent review cannot send an old embedding after canonical time changes', async t => {
  const { vault, root, intercept, requests } = await fixture(t, 0);
  const candidate = await vault.propose({ key: 'shared fact', statement: 'shared fact ENDING_CANARY', kind: 'fact', scope: 'public', sensitivity: 'public',
    confidence: 1, explicit: true, conditions: [], tags: [] });
  const memory = await vault.approve(candidate.id);
  let annotated = false;
  class ConcurrentReview extends LlmClient {
    override async embed(inputs: string[], model = this.embeddingModel, check?: () => void | Promise<void>) {
      if (!annotated && inputs.some(input => input.includes('ENDING_CANARY'))) {
        annotated = true;
        await vault.setMemoryValidity(memory.memoryId, { validFrom: '2999-01-01T00:00:00Z', validUntil: null, expectedRevision: 1 });
      }
      return super.embed(inputs, model, check);
    }
  }
  const concurrent = new MemoryVault(root, { llm: new ConcurrentReview({ apiKey: 'fixture', embeddingModel: 'time-vector', baseUrl: 'https://effective-fixture.invalid/v1' }) });
  intercept(body => embeddings(body.input!));
  const result = await concurrent.searchDetailed('shared fact', { semantic: true });
  assert.equal(annotated, true); assert.equal(result.semanticStatus, 'degraded');
  assert.deepEqual(result.hits, []); assert.equal(requests.length, 0);
});
