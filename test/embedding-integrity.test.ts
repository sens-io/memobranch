import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { MemoryVault } from '../src/vault.js';

test('embedding batches require a complete unique index mapping and valid consistent vectors', async (t) => {
  let payload: unknown;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload)));
  const llm = new LlmClient({ apiKey: 'fixture', embeddingModel: 'fixture', maxRetries: 0 });
  payload = { data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] };
  assert.deepEqual(await llm.embed(['first', 'second']), [[1, 0], [0, 1]]);
  const invalid = [
    null, {}, { data: {} }, { data: [null, null] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }] },
    { data: [{ embedding: [1, 0] }, { embedding: [0, 1] }] },
    { data: [{ index: -1, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 2, embedding: [0, 1] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 0.5, embedding: [0, 1] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 0] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: ['1', 0] }] },
  ];
  for (const response of invalid) {
    payload = response;
    await assert.rejects(llm.embed(['first', 'second']), (error: unknown) =>
      error instanceof AgentMemoryError && error.code === 'DEPENDENCY_UNAVAILABLE', JSON.stringify(response));
  }
});

test('invalid semantic output degrades to lexical results and corrupt cached vectors are rebuilt', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-embedding-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let mode: 'valid' | 'duplicate' | 'dimension' | 'large' = 'valid';
  let batchCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const { input } = JSON.parse(String(options.body)) as { input: string[] };
    if (input.length > 1) batchCalls += 1;
    return new Response(JSON.stringify({ data: input.map((_, index) => ({
      index: mode === 'duplicate' ? 0 : index,
      embedding: mode === 'dimension' && input.length === 1 ? [1, 0, 0]
        : mode === 'large' ? [1e308, 1e308] : [1, 0],
    })) }));
  });
  const llm = new LlmClient({ apiKey: 'fixture', embeddingModel: 'fixture', maxRetries: 0 });
  const vault = new MemoryVault(root, { llm });
  await vault.initialize('embedding integrity');
  for (const key of ['alpha', 'beta']) {
    const candidate = await vault.propose({ kind: 'fact', key, statement: `${key} searchable memory`,
      scope: 'user', sensitivity: 'public', confidence: 1, explicit: true, conditions: [], tags: [] });
    await vault.approve(candidate.id);
  }
  const config = await vault.config();
  config.index.embeddingModel = 'fixture';
  await writeFile(join(root, 'agent-memory.json'), JSON.stringify(config));
  mode = 'duplicate';
  const rejected = await vault.searchDetailed('searchable memory', { semantic: true });
  assert.equal(rejected.semanticStatus, 'degraded');
  assert.equal(rejected.hits.length, 2);
  assert.ok(rejected.hits.every(hit => hit.semanticScore === 0));
  mode = 'valid';
  assert.equal((await vault.searchDetailed('searchable memory', { semantic: true })).semanticStatus, 'ready');
  const cachePath = join(root, '.amem', 'embeddings.json');
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  for (const hash of Object.keys(cache.vectors)) cache.vectors[hash] = ['not a number', 0];
  await writeFile(cachePath, JSON.stringify(cache));
  const before = batchCalls;
  const recovered = await vault.searchDetailed('searchable memory', { semantic: true });
  assert.equal(recovered.semanticStatus, 'ready');
  assert.equal(recovered.hits.length, 2);
  assert.ok(batchCalls > before);
  mode = 'dimension';
  const mismatched = await vault.searchDetailed('searchable memory', { semantic: true });
  assert.equal(mismatched.semanticStatus, 'degraded');
  assert.equal(mismatched.hits.length, 2);
  await rm(cachePath, { force: true });
  mode = 'large';
  const large = await vault.searchDetailed('searchable memory', { semantic: true });
  assert.equal(large.semanticStatus, 'ready');
  assert.equal(large.hits.length, 2);
  assert.ok(large.hits.every(hit => Number.isFinite(hit.score) && (hit.semanticScore ?? 0) > 0.99));
});
