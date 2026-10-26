import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { SharedWikiImporter } from '../src/shared-wiki-import.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId } from '../src/wiki-schema.js';
import { importedWikiCaution } from '../src/wiki-import-artifact.js';
import { integrity, sharedFixture } from './shared-wiki-fixture.js';
import { withFileLock } from '../src/utils.js';
import type { WikiIntegrationOptions } from '../src/wiki-integration.js';
import type { Sensitivity } from '../src/types.js';

async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal', conflicted = false, expiresAt?: string) {
  const data = await sharedFixture(t, sensitivity); data.principal.permissions = ['read', 'write', 'review'];
  if (conflicted || expiresAt) {
    for (const name of await readdir(join(data.source.root, 'wiki/pages'))) {
      const path = join(data.source.root, 'wiki/pages', name), page = parseMarkdown<Record<string, unknown>>(await readFile(path, 'utf8'));
      if (conflicted) page.meta.status = 'conflicted'; if (expiresAt) page.meta.expiresAt = expiresAt;
      await writeFile(path, serializeMarkdown(page.meta, page.body));
    }
    await data.source.git.commit('Synthetic current conflict', data.source.principal, ['wiki']);
  }
  const importer = new SharedWikiImporter(data.caller, { configPath: data.configPath, env: data.env });
  const { plan } = await importer.prepare({ ...data.input, expectedCommit: data.binding.commit });
  const copied = await importer.apply(plan, { confirm: true });
  t.mock.method(data.caller.llm, 'wiki', async () => { throw new Error('Manual integration must not call a model'); });
  const input: WikiIntegrationOptions = { evidenceId: copied.evidenceId, pageKey: 'concept:reviewed-import', expectedRevision: 0,
    title: 'Reviewed integration', summary: 'A human-authored integration.', body: 'HUMAN_INTEGRATION_CANARY 中文 🧠',
    includeSecret: sensitivity === 'secret', includeSensitive: sensitivity === 'sensitive' };
  return { ...data, copied, input };
}

test('Wiki integration: complete signed comparison, grounded source summary, separate approval and exact retry preserve copied evidence', async t => {
  const { source, caller, callerAdmin, copied, input, calls } = await fixture(t), before = await Promise.all([source, caller].map(integrity)), count = calls();
  const bytes = await readFile(join(caller.root, copied.evidencePath));
  const prepared = await caller.wikiIntegrationPrepare(input);
  assert.equal(prepared.plan.kind, 'integrate'); assert.equal(prepared.plan.integration!.evidenceId, copied.evidenceId);
  assert.equal(prepared.comparison.current, null); assert.match(JSON.stringify(prepared.comparison.artifact), /DATED_WIKI_OLD_CANARY/);
  const target = prepared.preview.pages.find(page => page.key === input.pageKey)!;
  assert.equal(target.before, null); assert.match(target.after.body, /HUMAN_INTEGRATION_CANARY/);
  assert.ok(target.after.uncertainty.includes(importedWikiCaution)); assert.ok(target.after.conditions.includes('Synthetic dates, not verified facts.'));
  assert.deepEqual(target.after.evidence, [copied.evidencePath]);
  const summary = prepared.preview.pages.find(page => page.key === 'source:' + copied.evidenceId)!;
  assert.match(summary.after.body, /Retained page revisions/); assert.match(summary.after.body, new RegExp(prepared.comparison.artifact.source.commit));
  assert.ok(target.after.body.includes(summary.key) || prepared.plan.pages.find(page => page.key === input.pageKey)!.links.includes(summary.key));
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before); assert.deepEqual(await callerAdmin.wikiCatalog(), []);
  const applied = await caller.wikiApply(prepared.plan); assert.ok(applied.commit);
  assert.deepEqual(await caller.wikiApply(prepared.plan), { pageIds: [], commit: null });
  assert.equal(await caller.git.run(['rev-parse', 'HEAD']), applied.commit);
  assert.deepEqual(await readFile(join(caller.root, copied.evidencePath)), bytes); assert.deepEqual(await integrity(source), before[0]); assert.equal(calls(), count);
});

test('Wiki integration: updates retain existing local evidence, links, conditions and unresolved conflicts', async t => {
  const { caller, callerAdmin, input, copied } = await fixture(t, 'internal', true);
  const local = await callerAdmin.capture({ content: 'LOCAL_ORIGINAL_CANARY', scope: 'project', sensitivity: 'internal', extract: false });
  t.mock.method(callerAdmin.llm, 'wiki', async (_operation: string, value: object) => {
    const sources = (value as { sources: Array<{ id: string; body: string }> }).sources;
    return { pages: [{ key: 'source:' + local.evidenceId, pageType: 'source', title: 'Local original', summary: 'Local original', body: sources[0]!.body,
      evidenceIds: [local.evidenceId], links: [], status: 'active', conditions: ['LOCAL_CONDITION'], uncertainty: ['LOCAL_UNCERTAINTY'] },
    { key: input.pageKey, pageType: 'concept', title: 'Local concept', summary: 'Existing local knowledge', body: 'LOCAL_ORIGINAL_CANARY',
      evidenceIds: [local.evidenceId], links: ['source:' + local.evidenceId], status: 'active', conditions: ['LOCAL_CONDITION'], uncertainty: ['LOCAL_UNCERTAINTY'] }] };
  });
  await callerAdmin.wikiIngest({ evidenceIds: [local.evidenceId], apply: true });
  const before = await callerAdmin.get(wikiPageId(input.pageKey)), prepared = await caller.wikiIntegrationPrepare({ ...input, expectedRevision: 1 });
  assert.equal(prepared.comparison.current!.body, before.body);
  const target = prepared.preview.pages.find(page => page.key === input.pageKey)!;
  assert.match(target.before!.body, /LOCAL_ORIGINAL_CANARY/); assert.match(target.after.body, /HUMAN_INTEGRATION_CANARY/);
  assert.equal(target.after.status, 'conflicted'); assert.ok(target.after.conditions.includes('LOCAL_CONDITION')); assert.ok(target.after.uncertainty.includes('LOCAL_UNCERTAINTY'));
  assert.deepEqual(new Set(target.after.evidence), new Set([local.evidencePath, copied.evidencePath]));
  assert.ok(prepared.plan.pages.find(page => page.key === input.pageKey)!.links.includes('source:' + local.evidenceId));
  await caller.wikiApply(prepared.plan); const saved = await callerAdmin.get(wikiPageId(input.pageKey)); assert.equal(saved.meta.revision, 2); assert.equal(saved.meta.status, 'conflicted');
});

test('Wiki integration: strict inputs, reserved keys, real imported evidence and separate permissions are required', async t => {
  const { caller, callerAdmin, input, principal } = await fixture(t), before = await integrity(caller);
  for (const patch of [{ expectedRevision: -1 }, { expectedRevision: 1 }, { pageKey: 'source:reserved' }, { pageKey: 'legacy:reserved' },
    { pageKey: '__proto__' }, { body: '' }, { body: 'x'.repeat(100001) }, { body: 'bad\uD800' }, { summary: 'bad\nline' },
    { principal }, { root: caller.root }, { apply: true }, { signal: {} }]) {
    await assert.rejects(caller.wikiIntegrationPrepare({ ...input, ...patch } as WikiIntegrationOptions), { code: 'VALIDATION_FAILED' });
  }
  for (const permissions of [['read'], ['write'], ['review']] as Array<typeof principal.permissions>) {
    principal.permissions = permissions; await assert.rejects(caller.wikiIntegrationPrepare(input), { code: 'AUTHORIZATION_DENIED' });
  }
  principal.permissions = ['read', 'write']; const prepared = await caller.wikiIntegrationPrepare(input);
  await assert.rejects(caller.wikiApply(prepared.plan), { code: 'AUTHORIZATION_DENIED' });
  assert.deepEqual(await integrity(caller), before);
  const ordinary = await callerAdmin.capture({ content: 'Ordinary raw material', scope: 'project', sensitivity: 'internal', extract: false });
  await assert.rejects(caller.wikiIntegrationPrepare({ ...input, evidenceId: ordinary.evidenceId }), { code: 'VALIDATION_FAILED' });
});

test('Wiki integration: stale, edited and foreign plans refuse, while an explicitly retained offline copy remains usable', async t => {
  const { caller, callerAdmin, input, binding, saveBindings } = await fixture(t);
  const first = await caller.wikiIntegrationPrepare(input);
  for (const plan of [{ ...first.plan, kind: 'compile' }, { ...first.plan, vaultId: 'foreign' }, { ...first.plan, proof: '0'.repeat(64) },
    { ...first.plan, integration: { ...first.plan.integration!, selection: { includeSecret: true, includeSensitive: true } } },
    { ...first.plan, pages: first.plan.pages.map(page => ({ ...page, body: 'forged' })) }]) {
    await assert.rejects(caller.wikiApply(plan), { code: 'VALIDATION_FAILED' });
  }
  const alternative = await caller.wikiIntegrationPrepare({ ...input, body: 'ALTERNATIVE_CURRENT_BODY' }); await caller.wikiApply(alternative.plan);
  const before = await integrity(caller); await assert.rejects(caller.wikiApply(first.plan), { code: 'VALIDATION_FAILED' }); assert.deepEqual(await integrity(caller), before);
  binding.readers = []; await saveBindings();
  const update = await caller.wikiIntegrationPrepare({ ...input, expectedRevision: 1 }); await caller.wikiApply(update.plan);
  assert.match((await callerAdmin.get(wikiPageId(input.pageKey))).body, /HUMAN_INTEGRATION_CANARY/);
});

test('Wiki integration: secret copies require private selection and keys, and all approved pages stay encrypted', async t => {
  const { caller, callerAdmin, input, copied, principal } = await fixture(t, 'secret'), before = await integrity(caller);
  await assert.rejects(caller.wikiIntegrationPrepare({ ...input, includeSecret: false }), { code: 'VALIDATION_FAILED' });
  const keyless = new MemoryVault(caller.root, { principal, masterKey: '' });
  await assert.rejects(keyless.wikiIntegrationPrepare({ ...input, includeSecret: false }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(keyless.wikiIntegrationPrepare(input), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
  assert.deepEqual(await integrity(caller), before);
  const prepared = await caller.wikiIntegrationPrepare(input); assert.ok(prepared.preview.pages.every(page => page.after.sensitivity === 'secret'));
  await caller.wikiApply(prepared.plan);
  for (const page of prepared.preview.pages) {
    const disk = await readFile(join(caller.root, 'wiki/pages', wikiPageId(page.key) + '.md'), 'utf8');
    assert.doesNotMatch(disk, /HUMAN_INTEGRATION_CANARY|DATED_WIKI_|Copied compiled/); assert.match(disk, /encrypted/);
  }
  assert.equal((await callerAdmin.get(copied.evidenceId)).meta.digestVersion, 4);
});

test('Wiki integration: actual destination waits honour cancellation, cloned input and changed operator authority', async t => {
  const { caller, input, principal } = await fixture(t), before = await integrity(caller), lock = join(caller.root, '.amem/write.lock');
  const acquired = deferred(), release = deferred(), owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const controller = new AbortController();
    const cancelled = caller.wikiIntegrationPrepare({ ...input, signal: controller.signal }).then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); controller.abort(); assert.equal((await cancelled)?.code, 'OPERATION_CANCELLED');
    await waitFor(async () => (await readdir(lock + '.queue')).length === 1);
    const cloned = { ...input }, result = caller.wikiIntegrationPrepare(cloned); await waitFor(async () => (await readdir(lock + '.queue')).length === 2);
    cloned.body = 'MUTATED_AFTER_START'; release.resolve(); assert.match(JSON.stringify((await result).preview), /HUMAN_INTEGRATION_CANARY/);
  } finally { release.resolve(); await owner; }
  assert.deepEqual(await integrity(caller), before);
  const acquired2 = deferred(), release2 = deferred(), owner2 = withFileLock(lock, async () => { acquired2.resolve(); await release2.promise; });
  try {
    await acquired2.promise; const result = caller.wikiIntegrationPrepare(input).then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); principal.permissions = ['read']; release2.resolve();
    assert.equal((await result)?.code, 'AUTHORIZATION_DENIED');
  } finally { release2.resolve(); await owner2; }
  assert.deepEqual(await integrity(caller), before);
});

test('Wiki integration: expiry during an actual approval writer wait refuses without partial knowledge', async t => {
  const base = Date.now(); let shifted = false; t.mock.method(Date, 'now', () => base + (shifted ? 1001 : 0));
  const { caller, callerAdmin, input, copied } = await fixture(t, 'internal', false, new Date(base + 1000).toISOString());
  const prepared = await caller.wikiIntegrationPrepare(input), before = await integrity(caller);
  assert.ok(prepared.preview.pages.every(page => page.after.uncertainty.includes(importedWikiCaution)));
  const lock = join(caller.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const result = caller.wikiApply(prepared.plan).then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); shifted = true; release.resolve();
    assert.equal((await result)?.code, 'VALIDATION_FAILED');
  } finally { release.resolve(); await owner; }
  assert.deepEqual(await integrity(caller), before); assert.deepEqual(await callerAdmin.wikiCatalog(), []);
  assert.equal((await callerAdmin.get(copied.evidenceId)).meta.digestVersion, 4);
});

test('Wiki integration: an author can add restrictions and confidential content but cannot lower source classification', async t => {
  const { caller, input, principal } = await fixture(t), before = await integrity(caller);
  principal.scopes.push('public');
  for (const options of [{ scope: 'public' }, { sensitivity: 'public' }, { sensitivity: 'secret', includeSecret: false }]) {
    await assert.rejects(caller.wikiIntegrationPrepare({ ...input, ...options } as WikiIntegrationOptions), { code: 'VALIDATION_FAILED' });
  }
  assert.deepEqual(await integrity(caller), before);
  const result = await caller.wikiIntegrationPrepare({ ...input, sensitivity: 'secret', includeSecret: true,
    status: 'conflicted', conditions: ['AUTHOR_CONDITION'], uncertainty: ['AUTHOR_CAVEAT'] });
  const target = result.preview.pages.find(page => page.key === input.pageKey)!;
  assert.equal(target.after.sensitivity, 'secret'); assert.equal(target.after.status, 'conflicted');
  assert.ok(target.after.conditions.includes('AUTHOR_CONDITION')); assert.ok(target.after.uncertainty.includes('AUTHOR_CAVEAT'));
  assert.ok(target.after.uncertainty.includes(importedWikiCaution));
  await caller.wikiApply(result.plan);
  const disk = await readFile(join(caller.root, 'wiki/pages', wikiPageId(input.pageKey) + '.md'), 'utf8'); assert.doesNotMatch(disk, /HUMAN_INTEGRATION_CANARY|AUTHOR_CAVEAT/);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(check: () => Promise<boolean>) { const end = performance.now() + 10000; while (performance.now() < end) { if (await check().catch(() => false)) return; await delay(10); } throw new Error('Expected actual integration wait'); }
