import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { SharedWikiImporter } from '../src/shared-wiki-import.js';
import { MemoryVault } from '../src/vault.js';
import { withFileLock } from '../src/utils.js';
import { startWebServer, type WebHandle, type WebOptions } from '../src/web.js';
import { wikiPageId } from '../src/wiki-schema.js';
import { integrity, masterKey, sharedFixture } from './shared-wiki-fixture.js';

async function fixture(t: TestContext, secret = false) {
  const data = await sharedFixture(t, secret ? 'secret' : 'internal'), saved = process.env.SHARED_TEST_MASTER_KEY;
  process.env.SHARED_TEST_MASTER_KEY = masterKey; data.principal.permissions = ['read', 'write', 'review'];
  t.after(() => { if (saved === undefined) delete process.env.SHARED_TEST_MASTER_KEY; else process.env.SHARED_TEST_MASTER_KEY = saved; });
  const start = async (options: WebOptions = {}) => {
    const handle = await startWebServer(data.caller.root, { principal: data.principal, masterKey: '31'.repeat(32), sharedWikiConfig: data.configPath, ...options });
    data.cleanup.push(() => handle.stop()); return handle;
  };
  const importer = new SharedWikiImporter(data.caller, { configPath: data.configPath, env: data.env });
  const selection = { ...data.input, expectedCommit: data.binding.commit };
  const draft = (evidenceId: string) => ({ evidenceId, pageKey: 'concept:web-import', expectedRevision: 0, title: 'Human reviewed import',
    summary: 'Human-authored integration', body: 'WEB_AUTHORED_IMPORT 中文 🧠📚', includeSecret: secret });
  return { ...data, start, importer, selection, draft };
}
async function call(handle: WebHandle, operation: string, input: unknown = {}, signal?: AbortSignal, headers: Record<string, string> = {}) {
  const response = await fetch(handle.url + '/api/' + operation, { method: 'POST', headers: { Origin: handle.url, Authorization: 'Bearer ' + handle.token,
    'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input), ...(signal ? { signal } : {}) });
  return { status: response.status, body: await response.json() as any };
}

test('Web Wiki import: full fixed-version copy, separate integration comparison/approval and exact retries preserve source and raw evidence', async t => {
  const { source, caller, callerAdmin, start, selection, draft, calls, saveBindings } = await fixture(t), handle = await start();
  const before = await Promise.all([source, caller].map(integrity)), count = calls();
  const prepared = await call(handle, 'shared-import-prepare', selection); assert.equal(prepared.status, 200);
  assert.match(JSON.stringify(prepared.body.result), /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(JSON.stringify(prepared.body.result), /DATED_WIKI_CURRENT_CANARY/);
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before); assert.deepEqual(await callerAdmin.wikiCatalog(), []);
  const plan = prepared.body.result.plan;
  for (const confirm of [undefined, false, 'true']) assert.equal((await call(handle, 'shared-import-apply', { plan, ...(confirm === undefined ? {} : { confirm }) })).status, 400);
  const copied = await call(handle, 'shared-import-apply', { plan, confirm: true }); assert.equal(copied.status, 200); assert.ok(copied.body.result.commit);
  assert.deepEqual(await callerAdmin.wikiCatalog(), []); const bytes = await readFile(join(caller.root, copied.body.result.evidencePath));
  const retry = await call(handle, 'shared-import-apply', { plan, confirm: true }); assert.equal(retry.body.result.duplicate, true); assert.equal(retry.body.result.commit, null);
  await saveBindings([]);
  assert.notEqual((await call(handle, 'shared-import-apply', { plan, confirm: true })).status, 200);
  const head = await integrity(caller), input = draft(copied.body.result.evidenceId), integration = await call(handle, 'integration-prepare', input);
  assert.equal(integration.status, 200); const result = integration.body.result;
  assert.equal(result.comparison.current, null); assert.equal(result.plan.kind, 'integrate'); assert.match(JSON.stringify(result.comparison.artifact), /DATED_WIKI_OLD_CANARY/);
  assert.deepEqual(await integrity(caller), head); assert.deepEqual((await call(handle, 'preview', { plan: result.plan })).body.result, result.preview);
  assert.equal((await call(handle, 'apply', { plan: result.plan })).status, 400);
  const applied = await call(handle, 'apply', { plan: result.plan, confirm: true }); assert.equal(applied.status, 200); assert.ok(applied.body.result.commit);
  assert.match((await callerAdmin.get(wikiPageId(input.pageKey))).body, /WEB_AUTHORED_IMPORT/);
  assert.deepEqual((await call(handle, 'apply', { plan: result.plan, confirm: true })).body.result, { pageIds: [], commit: null });
  assert.deepEqual(await readFile(join(caller.root, copied.body.result.evidencePath)), bytes); assert.deepEqual(await integrity(source), before[0]); assert.equal(calls(), count);
});

test('Web Wiki import: strict request fields, current host grants, forged plans and authority tiers refuse without content leakage', async t => {
  const { caller, source, start, selection, importer, draft, principal, binding, saveBindings } = await fixture(t), handle = await start();
  const before = await integrity(caller);
  for (const patch of [{ root: source.root }, { configPath: caller.root }, { principal }, { signal: {} }, { apply: true }, { expectedCommit: 'HEAD' }, { includeSecret: 'true' }]) {
    assert.notEqual((await call(handle, 'shared-import-prepare', { ...selection, ...patch })).status, 200);
  }
  const prepared = await importer.prepare(selection), forged = structuredClone(prepared.plan); forged.proof = '0'.repeat(64);
  assert.equal((await call(handle, 'shared-import-apply', { plan: forged, confirm: true })).body.error.code, 'VALIDATION_FAILED');
  for (const permissions of [['read'], ['write'], ['read', 'write']] as const) {
    principal.permissions = [...permissions];
    assert.equal((await call(handle, 'shared-import-apply', { plan: prepared.plan, confirm: true })).status, 403);
    if (permissions.length === 1) assert.equal((await call(handle, 'shared-import-prepare', selection)).status, 403);
  }
  principal.permissions = ['read', 'write', 'review']; binding.readers = []; await saveBindings();
  const removed = await call(handle, 'shared-import-apply', { plan: prepared.plan, confirm: true }); assert.notEqual(removed.status, 200);
  assert.doesNotMatch(JSON.stringify(removed.body), /DATED_WIKI_|SHARED_TEST_MASTER_KEY|\.scratch/); assert.deepEqual(await integrity(caller), before);
  const noHost = await start({ sharedWikiConfig: '' }); assert.equal((await call(noHost, 'shared-import-prepare', selection)).body.error.code, 'DEPENDENCY_UNAVAILABLE');
  const body = draft('ev-' + 'a'.repeat(12));
  for (const patch of [{ apply: true }, { root: source.root }, { signal: {} }, { principal }, { expectedRevision: 0.5 }]) assert.equal((await call(handle, 'integration-prepare', { ...body, ...patch })).status, 400);
  assert.equal((await call(handle, 'shared-import-prepare', selection, undefined, { Authorization: 'Bearer invalid' })).status, 403);
  assert.equal((await call(handle, 'shared-import-prepare', selection, undefined, { Origin: 'https://example.invalid' })).status, 403);
});

test('Web Wiki import: private input/output needs explicit selection and independent source/destination keys', async t => {
  const { caller, callerAdmin, start, selection, importer, draft } = await fixture(t, true), handle = await start();
  assert.notEqual((await call(handle, 'shared-import-prepare', { ...selection, includeSecret: false })).status, 200);
  const prepared = await importer.prepare(selection);
  process.env.SHARED_TEST_MASTER_KEY = ''; assert.equal((await call(handle, 'shared-import-apply', { plan: prepared.plan, confirm: true })).body.error.code, 'ENCRYPTION_KEY_UNAVAILABLE');
  process.env.SHARED_TEST_MASTER_KEY = masterKey;
  const copied = await importer.apply(prepared.plan, { confirm: true }), keyless = await start({ masterKey: '' });
  const input = draft(copied.evidenceId);
  assert.notEqual((await call(handle, 'integration-prepare', { ...input, includeSecret: false })).status, 200);
  assert.equal((await call(keyless, 'integration-prepare', input)).body.error.code, 'ENCRYPTION_KEY_UNAVAILABLE');
  const result = (await call(handle, 'integration-prepare', input)).body.result;
  assert.ok(result.preview.pages.every((page: any) => page.after.sensitivity === 'secret'));
  assert.equal((await call(handle, 'apply', { plan: result.plan, confirm: true })).status, 200);
  const page = await callerAdmin.get(wikiPageId(input.pageKey)); assert.match(await readFile(join(caller.root, page.path), 'utf8'), /encrypted/);
});

for (const operation of ['shared-import-prepare', 'shared-import-apply', 'integration-prepare'] as const) test(`Web Wiki import: disconnect cancels real ${operation} source/destination wait without partial writes`, async t => {
  const { source, caller, importer, selection, draft, start } = await fixture(t), handle = await start(), prepared = await importer.prepare(selection);
  const copied = operation === 'integration-prepare' ? await importer.apply(prepared.plan, { confirm: true }) : undefined;
  const input = operation === 'shared-import-prepare' ? selection : operation === 'shared-import-apply' ? { plan: prepared.plan, confirm: true } : draft(copied!.evidenceId);
  const lock = join((operation === 'integration-prepare' ? caller : source).root, '.amem/write.lock'), before = await Promise.all([source, caller].map(integrity));
  const acquired = deferred(), release = deferred(), controller = new AbortController(), owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const request = call(handle, operation, input, controller.signal).then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); controller.abort(); assert.ok(await request);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 1); assert.equal(existsSync(lock), true);
  } finally { controller.abort(); release.resolve(); await owner; }
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
});

test('Web Wiki import: bounded complete reviews, resubmittable envelopes and safe completed-copy identifiers', async t => {
  const { caller, start, selection, draft, importer } = await fixture(t), handle = await start(), before = await integrity(caller);
  const huge = 'x'.repeat(17 * 1_048_576), complete = { plan: { body: huge } };
  const prepare = t.mock.method(SharedWikiImporter.prototype, 'prepare', async () => complete as any);
  assert.equal((await call(handle, 'shared-import-prepare', selection)).body.error.code, 'CONTENT_TOO_LARGE'); prepare.mock.restore();
  const integration = t.mock.method(MemoryVault.prototype, 'wikiIntegrationPrepare', async () => ({ plan: {}, comparison: { body: huge } } as any));
  assert.equal((await call(handle, 'integration-prepare', draft('ev-' + 'a'.repeat(12)))).body.error.code, 'CONTENT_TOO_LARGE'); integration.mock.restore();
  // Use a structurally valid fixture plan to reach the core error adapter.
  const prepared = await importer.prepare(selection);
  const apply = t.mock.method(SharedWikiImporter.prototype, 'apply', async () => { throw new AgentMemoryError('AUTHORIZATION_DENIED', 'PRIVATE_BODY', {
    completedImport: { evidenceId: 'ev-' + 'a'.repeat(12), commit: 'b'.repeat(40), duplicate: false }, artifact: 'PRIVATE_BODY',
  }); });
  const failure = await call(handle, 'shared-import-apply', { plan: prepared.plan, confirm: true });
  assert.equal(failure.status, 403); assert.deepEqual(failure.body.error.completedImport, { evidenceId: 'ev-' + 'a'.repeat(12), commit: 'b'.repeat(40), duplicate: false });
  assert.doesNotMatch(JSON.stringify(failure.body), /PRIVATE_BODY|artifact/); apply.mock.restore();
  assert.deepEqual(await integrity(caller), before);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }
async function waitFor(check: () => Promise<boolean>) {
  const until = performance.now() + 5000;
  while (performance.now() < until) { try { if (await check()) return; } catch {} await delay(15); }
  assert.fail('Real Web import waiter did not reach expected state');
}
