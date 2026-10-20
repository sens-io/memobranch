import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LlmClient } from '../src/llm.js';
import { MemoryVault } from '../src/vault.js';
import { localAdminPrincipal, type Principal } from '../src/policy.js';
import { reviewDiff } from '../src/review-diff.js';
import { startWebServer } from '../src/web.js';
import { withFileLock } from '../src/utils.js';
import { withOperation } from '../src/operation.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

class ReviewFixture extends LlmClient {
  fail = false;
  omitTarget = false;
  constructor() { super({ apiKey: '', model: 'review-fixture', embeddingModel: '' }); }
  override async wiki<T>(operation: string, raw: object): Promise<T> {
    if (this.fail) throw new Error('fixture unavailable');
    const input = raw as { catalog?: Array<{ key: string }>; sources: Array<{ id: string; body: string }>; correction?: { key: string }; pages?: unknown[] };
    if (operation === 'navigate') return { keys: input.catalog?.map(page => page.key) ?? [] } as T;
    const evidenceIds = input.sources.map(source => source.id);
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string): WikiPageDraft => ({
      key, pageType, title: key, summary: 'Atlas backup decision', body, evidenceIds, links: [], status: 'active',
      conditions: ['Only Atlas production deployments.'], uncertainty: ['Unmeasured restoration latency.'],
    });
    return { pages: [
      ...input.sources.map(source => draft(`source:${source.id}`, 'source', source.body)),
      ...(this.omitTarget ? [] : [draft(input.correction?.key ?? 'entity:atlas', 'entity', input.correction ? 'Atlas backup retention is 14 days.' : 'Atlas backup retention is 7 days.')]),
    ] } as T;
  }
}

async function fixture(t: TestContext) {
  const scratch = join(process.cwd(), '.scratch');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'review-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const llm = new ReviewFixture();
  const vault = new MemoryVault(root, { llm, masterKey: '45'.repeat(32) });
  await vault.initialize('review-recall');
  const evidence = await vault.capture({ content: 'Atlas backup retention is 7 days.', scope: 'public', sensitivity: 'public' });
  const planned = await vault.wikiIngest({ evidenceIds: [evidence.evidenceId] });
  assert.ok(planned.plan);
  return { vault, llm, evidence, plan: planned.plan };
}

async function state(vault: MemoryVault) {
  return `${await vault.git.run(['rev-parse', 'HEAD'])}\n${await vault.git.run(['status', '--porcelain'])}`;
}

test('review: actual preview matches applied body, source restrictions and revisions without a model call', async t => {
  const { vault, llm, evidence, plan } = await fixture(t);
  const before = await state(vault);
  llm.fail = true;
  const preview = await vault.wikiPreview(plan);
  assert.equal(await state(vault), before);
  assert.deepEqual(preview.affectedPageKeys.sort(), plan.pages.map(page => page.key).sort());
  for (const page of preview.pages) {
    assert.equal(page.before, null);
    assert.equal(page.operation, 'create');
    assert.equal(page.after.revision, 1);
    assert.ok(page.after.evidence.includes(evidence.evidencePath));
    assert.equal(page.after.sensitivity, 'public');
  }
  await vault.wikiApply(plan);
  const catalog = await vault.wikiCatalog();
  for (const page of preview.pages) {
    const applied = await vault.get(catalog.find(item => item.key === page.key)!.id);
    assert.equal(applied.body, page.after.body);
    assert.equal(applied.meta.revision, page.after.revision);
    assert.deepEqual(applied.meta.conditions, page.after.conditions);
  }
});

test('review: altered and stale plans fail before exposing a comparison', async t => {
  const { vault, plan } = await fixture(t);
  await assert.rejects(vault.wikiPreview({ ...plan, kind: 'repair' }), /proof|signature/i);
  await vault.wikiApply(plan);
  await assert.rejects(vault.wikiPreview(plan), /changed|manifest/i);
});

test('review: correction saves immutable original words and needs a separate approval', async t => {
  const { vault, plan, evidence } = await fixture(t);
  await vault.wikiApply(plan);
  const original = await readFile(join(vault.root, evidence.evidencePath), 'utf8');
  const before = await vault.wikiCatalog();
  const result = await vault.wikiCorrect('entity:atlas', 'Atlas retention was changed to 14 days.');
  assert.equal(result.plan.kind, 'repair');
  assert.equal(result.commit, null);
  assert.deepEqual(await vault.wikiCatalog(), before);
  assert.ok((await vault.get(result.evidenceId)).body.endsWith('\n\nAtlas retention was changed to 14 days.'));
  const preview = await vault.wikiPreview(result.plan);
  const target = preview.pages.find(page => page.key === 'entity:atlas')!;
  assert.equal(target.before!.revision, 1);
  assert.equal(target.after.revision, 2);
  assert.match(target.before!.body, /7 days/);
  assert.match(target.after.body, /14 days/);
  assert.ok(preview.pages.some(page => page.key === `source:${result.evidenceId}`));
  await vault.wikiApply(result.plan);
  const beforeStale = await state(vault);
  await assert.rejects(vault.wikiCorrect('entity:atlas', 'Do not record a correction to a version I have not read.', { expectedRevision: 1 }), /target changed/);
  assert.equal(await state(vault), beforeStale);
  assert.equal((await vault.wikiCatalog()).find(page => page.key === 'entity:atlas')!.revision, 2);
  assert.equal(await readFile(join(vault.root, evidence.evidencePath), 'utf8'), original);
});

test('review: failed or incomplete correction preserves evidence but never updates canonical pages', async t => {
  const { vault, llm, plan } = await fixture(t);
  await vault.wikiApply(plan);
  const before = await vault.wikiCatalog();
  llm.omitTarget = true;
  await assert.rejects(vault.wikiCorrect('entity:atlas', 'Correction without its intended target.'), /intended target/);
  llm.fail = true;
  await assert.rejects(vault.wikiCorrect('entity:atlas', 'Correction while the provider is unavailable.'), /unavailable/);
  assert.deepEqual(await vault.wikiCatalog(), before);
  const raw = await vault.listRecords({ collection: 'evidence', offset: 0, limit: 100, query: '', status: '' });
  assert.equal(raw.total, 3);
});

test('review: read-only and write-only callers cannot record corrections; narrowed readers cannot preview broader plans', async t => {
  const { vault, plan } = await fixture(t);
  await vault.wikiApply(plan);
  const tenantId = (await vault.config()).tenantId;
  for (const permissions of [['read'], ['write']] as Principal['permissions'][]) {
    const restricted = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId, permissions } });
    const before = await state(vault);
    await assert.rejects(restricted.wikiCorrect('entity:atlas', 'Must not be captured.'), { code: 'AUTHORIZATION_DENIED' });
    assert.equal(await state(vault), before);
  }
  const restricted = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId, permissions: ['read'], scopes: ['user'] } });
  await assert.rejects(restricted.wikiPreview(plan));
});

test('recall: complete approved ordinary and Wiki records include sources and limits, not evidence or pending candidates', async t => {
  const { vault, plan } = await fixture(t);
  await vault.wikiApply(plan);
  const approved = await vault.propose({ key: 'Atlas preference', statement: 'Atlas uses a separate restore instance.', kind: 'preference',
    scope: 'public', sensitivity: 'public', confidence: 1, explicit: true, conditions: ['Only manual restores.'], tags: [] });
  await vault.approve(approved.id);
  await vault.propose({ key: 'Atlas pending', statement: 'Atlas pending canary must not appear.', kind: 'fact',
    scope: 'public', sensitivity: 'public', confidence: 1, explicit: true, conditions: [], tags: [] });
  const before = await state(vault);
  const result = await vault.recall('Atlas', { limit: 30, maxCharacters: 40_000, includeCandidates: true, includeEvidence: true });
  assert.equal(result.memories.length, 1);
  assert.equal(result.wikiPages.length, 2);
  assert.match(result.text, /Only manual restores/);
  assert.match(result.text, /Unmeasured restoration latency/);
  assert.doesNotMatch(result.text, /pending canary/);
  for (const page of result.wikiPages) {
    assert.equal(page.revision, 1);
    assert.ok(page.evidence.length);
  }
  assert.equal(await state(vault), before);
  const tiny = await vault.recall('Atlas', { maxCharacters: 100 });
  assert.equal(tiny.text, '');
  assert.deepEqual(tiny.memories, []);
  assert.deepEqual(tiny.wikiPages, []);
  assert.equal(tiny.truncated, true);
  for (const maxCharacters of [0, NaN, Infinity, 1.1]) await assert.rejects(vault.recall('Atlas', { maxCharacters }));
});

test('recall: revoked knowledge and unauthorized tenants never reach automatic context', async t => {
  const { vault, plan } = await fixture(t);
  await vault.wikiApply(plan);
  await vault.wikiRevoke('entity:atlas', 'Obsolete knowledge');
  assert.ok(!(await vault.recall('Atlas')).wikiPages.some(page => page.key === 'entity:atlas'));
  const restricted = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), permissions: ['read'], tenantId: 'wrong-tenant' } });
  await assert.rejects(restricted.recall('Atlas'), { code: 'AUTHORIZATION_DENIED' });
});

test('recall: waits for an external writer and respects cancellation while waiting', async t => {
  const { vault, plan } = await fixture(t);
  await vault.wikiApply(plan);
  let release!: () => void;
  let reached!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const writer = withFileLock(join(vault.root, '.amem', 'write.lock'), async () => { reached(); await hold; });
  t.after(() => release());
  await entered;
  const controller = new AbortController();
  const reading = withOperation(controller.signal, () => vault.recall('Atlas'));
  controller.abort();
  await assert.rejects(reading, /cancel/i);
  release();
  await writer;
  assert.ok((await vault.recall('Atlas')).wikiPages.length);
});

test('explain: reports the actual scores without calling zero semantic scores hybrid retrieval', async t => {
  const { vault, plan } = await fixture(t);
  await vault.wikiApply(plan);
  const result = await vault.explain('Atlas');
  assert.equal(result.explanation.strategy, 'lexical');
  assert.deepEqual(result.explanation.signals.map(signal => signal.score), result.hits.map(hit => hit.score));
  assert.ok(result.explanation.notes.some(note => /not probabilities/.test(note)));
});

test('recall: unrelated encrypted sources or memories do not require a key for public retrieval', async t => {
  const { vault, plan } = await fixture(t);
  const candidate = await vault.propose({ key: 'Atlas public', statement: 'Atlas uses separate restoration.', kind: 'fact',
    scope: 'public', sensitivity: 'public', confidence: 1, explicit: true, conditions: [], tags: [] });
  await vault.approve(candidate.id);
  const secret = await vault.propose({ key: 'Unrelated confidential preference', statement: 'CONFIDENTIAL_CANARY', kind: 'fact',
    scope: 'user', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [] });
  await vault.approve(secret.id);
  await vault.capture({ content: 'UNRELATED_SECRET_EVIDENCE', scope: 'user', sensitivity: 'secret' });
  const reader = new MemoryVault(vault.root, { masterKey: '' });
  assert.equal((await reader.recall('Atlas')).memories.length, 1);
  assert.doesNotMatch((await reader.recall('Atlas')).text, /CONFIDENTIAL_CANARY|UNRELATED_SECRET_EVIDENCE/);
  // The Wiki retrieval path must also filter before decrypting unrelated evidence.
  // Regenerate a proposal because the approved ordinary catalog legitimately changed.
  const regenerated = await vault.wikiIngest({ evidenceIds: plan.sourceIds });
  await vault.wikiApply(regenerated.plan);
  assert.ok((await reader.recall('Atlas')).wikiPages.length);
  await assert.rejects(reader.recall('CONFIDENTIAL_CANARY', { includeSecret: true }), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
});

test('explain: empty semantic score maps remain lexical; actually computed zero scores remain distinguishable', async t => {
  const { vault } = await fixture(t);
  const candidate = await vault.propose({ key: 'Atlas protected', statement: 'Atlas confidential deployment preference.', kind: 'preference',
    scope: 'user', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [] });
  await vault.approve(candidate.id);
  class EmbedFixture extends LlmClient {
    constructor() { super({ apiKey: 'fixture', model: 'fixture', embeddingModel: 'fixture' }); }
    override async embed(inputs: string[]): Promise<number[][]> { return inputs.map(() => [1, 0]); }
  }
  const settings = await vault.settings();
  settings.values.index.embeddingModel = 'fixture';
  await vault.updateSettings(settings.values, settings.revision);
  const reader = new MemoryVault(vault.root, { llm: new EmbedFixture(), masterKey: '45'.repeat(32) });
  const result = await reader.explain('Atlas', { semantic: true, includeSecret: true });
  assert.equal(result.semanticStatus, 'ready');
  assert.equal(result.explanation.strategy, 'lexical');
  assert.equal(result.explanation.signals[0]!.semanticScore, null);
  assert.equal(result.hits[0]!.semanticScore, 0, 'retain the existing ranking-score API');
});

test('diff: huge changed regions have bounded output and explicit omissions', () => {
  const result = reviewDiff(`same\n${'old\n'.repeat(10_000)}tail`, `same\n${'new\n'.repeat(10_000)}tail`);
  assert.equal(result.added, 10_000);
  assert.equal(result.removed, 10_000);
  assert.ok(result.lines.length <= 205);
  assert.equal(result.truncated, true);
  assert.ok(result.lines.some(line => line.kind === 'added'));
  assert.ok(result.lines.some(line => line.kind === 'removed'));
  assert.ok(result.lines.some(line => line.kind === 'omitted'));
});

test('web review: actual routes enforce authentication, preview and separate correction approval', async t => {
  const { vault, llm, plan } = await fixture(t);
  const handle = await startWebServer(vault.root, { llm, masterKey: '45'.repeat(32) });
  t.after(() => handle.stop());
  const call = async (name: string, value: unknown) => {
    const response = await fetch(`${handle.url}/api/${name}`, { method: 'POST', headers: {
      Origin: handle.url, Authorization: `Bearer ${handle.token}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() as { result?: any; error?: { code: string } } };
  };
  const preview = await call('preview', { plan });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.result.pages.length, 2);
  assert.equal((await call('preview', { plan: { ...plan, proof: '0'.repeat(64) } })).status, 400);
  assert.equal((await call('apply', { plan, confirm: true })).status, 200);
  const correction = await call('correct', { key: 'entity:atlas', instruction: 'The approved retention should be 14 days.', expectedRevision: 1 });
  assert.equal(correction.status, 200);
  assert.equal(correction.body.result.plan.kind, 'repair');
  assert.equal((await vault.wikiCatalog()).find(page => page.key === 'entity:atlas')!.revision, 1);
  assert.equal((await call('preview', { plan: correction.body.result.plan })).status, 200);
  assert.equal((await call('explain', { query: 'Atlas' })).body.result.explanation.strategy, 'lexical');
});

test('MCP adoption: cancellation while waiting prevents correction evidence and provider work', async t => {
  const { vault, plan } = await fixture(t);
  await vault.wikiApply(plan);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string>;
  Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read,write',
    AMEM_ALLOWED_SCOPES: 'public', AMEM_MAX_SENSITIVITY: 'public' });
  const client = new Client({ name: 'adoption-cancellation', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), vault.root], env, stderr: 'pipe' }));
  t.after(() => client.close());
  let release!: () => void;
  let entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const lock = withFileLock(join(vault.root, '.amem/write.lock'), async () => { entered(); await hold; });
  t.after(() => release());
  await started;
  const before = await state(vault);
  const controller = new AbortController();
  const call = client.callTool({ name: 'memory_wiki_correct', arguments: { key: 'entity:atlas', instruction: 'Cancelled words must not be saved.', expectedRevision: 1 } }, { signal: controller.signal });
  const rejected = assert.rejects(call);
  // The ordered transport has dispatched the earlier correction by this barrier.
  await client.callTool({ name: 'memory_version', arguments: {} });
  controller.abort();
  await rejected;
  await client.callTool({ name: 'memory_version', arguments: {} });
  release(); await lock;
  // Allow the abandoned handler's lock retry interval to elapse before asserting.
  await new Promise(resolve => setTimeout(resolve, 500));
  await client.callTool({ name: 'memory_recall', arguments: { query: 'Atlas' } });
  assert.equal(await state(vault), before);
  assert.equal((await vault.listRecords({ collection: 'evidence', offset: 0, limit: 100, query: '', status: '' })).total, 1);
});

test('MCP adoption: cancelling correction compilation closes its real provider request', async t => {
  const { vault, plan } = await fixture(t);
  await vault.wikiApply(plan);
  let reached!: () => void;
  let disconnected!: () => void;
  const requestStarted = new Promise<void>(resolve => { reached = resolve; });
  const requestClosed = new Promise<void>(resolve => { disconnected = resolve; });
  const provider = createServer((_req, res) => { reached(); res.once('close', disconnected); });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => { provider.closeAllConnections(); provider.close(); });
  const address = provider.address();
  assert.ok(address && typeof address !== 'string');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string>;
  Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read,write',
    AMEM_ALLOWED_SCOPES: 'public', AMEM_MAX_SENSITIVITY: 'public', AMEM_LLM_API_KEY: 'local-fixture',
    AMEM_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AMEM_LLM_TIMEOUT_MS: '10000', AMEM_LLM_MAX_RETRIES: '0' });
  const client = new Client({ name: 'adoption-provider-cancellation', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), vault.root], env, stderr: 'pipe' }));
  t.after(() => client.close());
  const controller = new AbortController();
  const call = client.callTool({ name: 'memory_wiki_correct', arguments: { key: 'entity:atlas', instruction: 'Evidence can remain, but cancel the pending provider.', expectedRevision: 1 } }, { signal: controller.signal });
  const rejected = assert.rejects(call);
  await requestStarted;
  controller.abort();
  await rejected;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([requestClosed, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Cancelled provider request did not close')), 2000);
    })]);
  } finally { clearTimeout(timeout); }
  assert.equal((await vault.wikiCatalog()).find(page => page.key === 'entity:atlas')!.revision, 1);
  assert.equal((await vault.listRecords({ collection: 'evidence', offset: 0, limit: 100, query: '', status: '' })).total, 2);
});
