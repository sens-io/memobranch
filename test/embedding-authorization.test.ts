import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, type TestContext } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { localAdminPrincipal, type Permission, type Principal } from '../src/policy.js';
import { PersistentSearchIndex } from '../src/search.js';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];
const masterKey = '72'.repeat(32);
const allowed = 'ALLOWED_EMBEDDING_BODY';
const forbidden = /OUTSIDE_SCOPE_BODY|OUTSIDE_SENSITIVITY_BODY|ENCRYPTED_BODY|EXPIRED_BODY|REVOKED_BODY|CONFLICTED_BODY|SUPERSEDED_BODY/;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function provider(t: TestContext) {
  const requests: Array<{ model: string; input: string[] }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), 'https://embedding-test.invalid/v1/embeddings');
    const payload = JSON.parse(String(options?.body)) as { model: string; input: string[] };
    requests.push(payload);
    return new Response(JSON.stringify({ data: payload.input.map((_, index) => ({ index, embedding: [1, 0, 0] })) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  const llm = new LlmClient({ baseUrl: 'https://embedding-test.invalid/v1', apiKey: 'local-intercept', maxRetries: 0 });
  return { llm, requests, inputs: () => requests.flatMap((request) => request.input) };
}

async function fixture(llm: LlmClient) {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-embedding-auth-'));
  roots.push(root);
  const admin = new MemoryVault(root, { masterKey, llm });
  await admin.initialize('embedding-authorization');
  const encryptedCandidate = await admin.propose({
    kind: 'fact', key: 'encrypted retained memory', statement: 'ENCRYPTED_BODY shared memory',
    scope: 'user', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  const encrypted = await admin.approve(encryptedCandidate.id);
  const timestamp = new Date().toISOString();
  const records = [
    { id: 'allowed', body: allowed },
    { id: 'scope', body: 'OUTSIDE_SCOPE_BODY', scope: 'project' },
    { id: 'sensitivity', body: 'OUTSIDE_SENSITIVITY_BODY', sensitivity: 'internal' },
    { id: 'expired', body: 'EXPIRED_BODY', expiresAt: '2000-01-01T00:00:00.000Z' },
    { id: 'revoked', body: 'REVOKED_BODY', status: 'revoked', revokedAt: timestamp, revocationReason: 'Retired' },
    { id: 'conflicted', body: 'CONFLICTED_BODY', status: 'conflicted' },
    { id: 'superseded', body: 'SUPERSEDED_BODY', status: 'superseded', supersededBy: 'allowed' },
  ];
  const directory = join(root, 'wiki', 'embedding-fixtures');
  await mkdir(directory, { recursive: true });
  for (const { body, ...record } of records) {
    await writeFile(join(directory, `${record.id}.md`), serializeMarkdown({
      type: 'memory', createdAt: timestamp, updatedAt: timestamp, validatedAt: timestamp,
      kind: 'fact', key: record.id, scope: 'user', sensitivity: 'public', confidence: 1,
      status: 'active', evidence: [], conditions: [], tags: [], revision: 1, ...record,
    }, `# ${record.id}\n\n${body} shared memory`));
  }
  await setModel(admin, 'embedding-model-a');
  await Promise.all(['search-index.json', 'embeddings.json'].map((name) => rm(join(root, '.amem', name), { force: true })));
  return { admin, encrypted };
}

async function setModel(admin: MemoryVault, model: string) {
  const config = await admin.config();
  config.index.embeddingModel = model;
  await writeFile(join(admin.root, 'agent-memory.json'), `${JSON.stringify(config, null, 2)}\n`);
}

async function restricted(admin: MemoryVault, llm: LlmClient, permission: Permission) {
  const principal: Principal = {
    id: 'restricted', name: 'Restricted caller', permissions: [permission], scopes: ['user'],
    maxSensitivity: 'public', tenantId: (await admin.config()).tenantId,
  };
  return new MemoryVault(admin.root, { principal, masterKey, llm });
}

function denied(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED';
}

test('semantic search sends only readable active documents on cold, warm, and changed-model caches', async (t) => {
  const recording = provider(t);
  const { admin } = await fixture(recording.llm);
  const reader = await restricted(admin, recording.llm, 'read');
  const query = 'shared memory';

  const cold = await reader.searchDetailed(query, { semantic: true, includeSecret: true });
  assert.equal(cold.semanticStatus, 'ready');
  assert.deepEqual(cold.hits.map((hit) => hit.id), ['allowed']);
  assert.ok((cold.hits[0]?.semanticScore ?? 0) > 0);
  assert.ok(recording.inputs().some((input) => input.includes(allowed)));
  assert.doesNotMatch(JSON.stringify(recording.requests), forbidden);

  recording.requests.length = 0;
  const warm = await reader.searchDetailed(query, { semantic: true });
  assert.equal(warm.semanticStatus, 'ready');
  assert.deepEqual(recording.inputs(), [query]);

  await setModel(admin, 'embedding-model-b');
  recording.requests.length = 0;
  assert.equal((await reader.searchDetailed(query, { semantic: true })).semanticStatus, 'ready');
  assert.ok(recording.requests.every((request) => request.model === 'embedding-model-b'));
  assert.ok(recording.inputs().some((input) => input.includes(allowed)));
  assert.doesNotMatch(JSON.stringify(recording.requests), forbidden);

  // The shared lexical index remains complete after a restricted caller builds it.
  assert.equal((await admin.search('OUTSIDE_SCOPE_BODY'))[0]?.id, 'scope');
  assert.equal((await admin.search('OUTSIDE_SENSITIVITY_BODY'))[0]?.id, 'sensitivity');
  const index = JSON.parse(await readFile(join(admin.root, '.amem', 'search-index.json'), 'utf8'));
  assert.ok(index.documents.some((document: { id: string }) => document.id === 'scope'));
  assert.ok(index.documents.some((document: { id: string }) => document.id === 'sensitivity'));
});

test('maintain-only semantic reindex embeds its authorized subset and retains cache and admin capabilities', async (t) => {
  const recording = provider(t);
  const { admin } = await fixture(recording.llm);
  const maintainer = await restricted(admin, recording.llm, 'maintain');

  assert.equal((await maintainer.reindex(true)).semanticStatus, 'ready');
  assert.ok(recording.inputs().some((input) => input.includes(allowed)));
  assert.doesNotMatch(JSON.stringify(recording.requests), forbidden);
  recording.requests.length = 0;
  assert.equal((await maintainer.reindex(true)).semanticStatus, 'ready');
  assert.equal(recording.requests.length, 0);

  await setModel(admin, 'embedding-model-b');
  assert.equal((await maintainer.reindex(true)).semanticStatus, 'ready');
  assert.ok(recording.inputs().some((input) => input.includes(allowed)));
  assert.ok(recording.requests.every((request) => request.model === 'embedding-model-b'));
  assert.doesNotMatch(JSON.stringify(recording.requests), forbidden);

  recording.requests.length = 0;
  await assert.rejects(maintainer.search('shared memory', { semantic: true }), denied);
  assert.deepEqual(recording.requests, []);
  assert.equal((await admin.reindex(true)).semanticStatus, 'ready');
  assert.match(JSON.stringify(recording.requests), /OUTSIDE_SCOPE_BODY/);
  assert.match(JSON.stringify(recording.requests), /OUTSIDE_SENSITIVITY_BODY/);
  assert.doesNotMatch(JSON.stringify(recording.requests), /ENCRYPTED_BODY|EXPIRED_BODY|REVOKED_BODY|CONFLICTED_BODY|SUPERSEDED_BODY/);
  assert.equal((await admin.search('OUTSIDE_SCOPE_BODY'))[0]?.id, 'scope');
});

test('encrypted documents remain searchable with a key but never enter provider input after encryption policy is relaxed', async (t) => {
  const recording = provider(t);
  const { admin, encrypted } = await fixture(recording.llm);
  // Persisted config disallows this relaxation, but direct index callers can supply
  // a config object. The encrypted envelope itself must still exclude embedding.
  const config = await admin.config();
  config.policy.requireEncryptionFor = [];
  const index = new PersistentSearchIndex(admin.root, config, recording.llm, async (path) => {
    const outer = parseMarkdown<{ id: string }>(await readFile(join(admin.root, path), 'utf8'));
    return admin.get(outer.meta.id);
  });
  const result = await index.search('shared memory', { semantic: true, includeSecret: true, limit: 20 });
  assert.equal(result.semanticStatus, 'ready');
  assert.ok(result.hits.some((hit) => hit.id === encrypted.memoryId));
  assert.ok(recording.inputs().some((input) => input.includes(allowed)));
  assert.doesNotMatch(JSON.stringify(recording.requests), /ENCRYPTED_BODY/);
  recording.requests.length = 0;
  config.index.embeddingModel = 'embedding-model-b';
  assert.equal((await index.refresh({ semantic: true })).semanticStatus, 'ready');
  assert.doesNotMatch(JSON.stringify(recording.requests), /ENCRYPTED_BODY|EXPIRED_BODY|REVOKED_BODY|CONFLICTED_BODY|SUPERSEDED_BODY/);
  const storedIndex = await readFile(join(admin.root, '.amem', 'search-index.json'), 'utf8');
  assert.doesNotMatch(storedIndex, /ENCRYPTED_BODY/);
  assert.ok(!JSON.parse(storedIndex).documents.some((document: { path: string }) => document.path === encrypted.memoryPath));
});

test('direct index entry points enforce operation and tenant before any provider request', async (t) => {
  const recording = provider(t);
  const { admin } = await fixture(recording.llm);
  const config = await admin.config();
  const index = new PersistentSearchIndex(admin.root, config, recording.llm);
  const maintainer: Principal = {
    id: 'maintainer', name: 'Maintainer', permissions: ['maintain'], scopes: ['user'],
    maxSensitivity: 'public', tenantId: config.tenantId,
  };
  await assert.rejects(index.search('shared memory', { principal: maintainer, semantic: true }), denied);
  await assert.rejects(index.refresh({ semantic: true, principal: { ...maintainer, tenantId: 'other-tenant' } }), denied);
  await assert.rejects(index.refresh({ semantic: true, principal: { ...maintainer, permissions: ['read'] } }), denied);
  await assert.rejects(index.search('shared memory', {
    semantic: true, principal: { ...maintainer, permissions: ['read'], tenantId: 'other-tenant' },
  }), denied);
  assert.deepEqual(recording.requests, []);

  assert.equal((await index.refresh({ semantic: true, principal: maintainer })).semanticStatus, 'ready');
  assert.ok(recording.inputs().some((input) => input.includes(allowed)));
  assert.doesNotMatch(JSON.stringify(recording.requests), forbidden);
  recording.requests.length = 0;
  assert.equal((await index.refresh({ semantic: true })).semanticStatus, 'ready');
  assert.match(JSON.stringify(recording.requests), /OUTSIDE_SCOPE_BODY/);
  assert.match(JSON.stringify(recording.requests), /OUTSIDE_SENSITIVITY_BODY/);
  // A tenant-bound admin also must match the vault tenant.
  await assert.rejects(index.refresh({ semantic: true, principal: { ...localAdminPrincipal(), tenantId: 'other-tenant' } }), denied);
});
