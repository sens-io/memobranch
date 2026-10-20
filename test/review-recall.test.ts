import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
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
  const correction = await call('correct', { key: 'entity:atlas', instruction: 'The approved retention should be 14 days.' });
  assert.equal(correction.status, 200);
  assert.equal(correction.body.result.plan.kind, 'repair');
  assert.equal((await vault.wikiCatalog()).find(page => page.key === 'entity:atlas')!.revision, 1);
  assert.equal((await call('preview', { plan: correction.body.result.plan })).status, 200);
  assert.equal((await call('explain', { query: 'Atlas' })).body.result.explanation.strategy, 'lexical');
});
