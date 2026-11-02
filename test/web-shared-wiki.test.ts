import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import type { Sensitivity } from '../src/types.js';
import { withFileLock } from '../src/utils.js';
import { startWebServer, type WebHandle, type WebOptions } from '../src/web.js';
import { integrity, masterKey, pageKey, sharedFixture } from './shared-wiki-fixture.js';

async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  const data = await sharedFixture(t, sensitivity), previous = process.env.SHARED_TEST_MASTER_KEY;
  process.env.SHARED_TEST_MASTER_KEY = masterKey;
  t.after(() => { if (previous === undefined) delete process.env.SHARED_TEST_MASTER_KEY; else process.env.SHARED_TEST_MASTER_KEY = previous; });
  const start = async (options: WebOptions = {}) => {
    const handle = await startWebServer(data.caller.root, { principal: data.principal, masterKey: '31'.repeat(32), sharedWikiConfig: data.configPath, ...options });
    data.cleanup.push(() => handle.stop()); return handle;
  };
  return { ...data, start };
}
async function call(handle: WebHandle, name: string, input: object = {}, signal?: AbortSignal, headers: Record<string, string> = {}) {
  const response = await fetch(handle.url + '/api/' + name, { method: 'POST', headers: {
    Origin: handle.url, Authorization: 'Bearer ' + handle.token, 'Content-Type': 'application/json', ...headers,
  }, body: JSON.stringify(input), ...(signal ? { signal } : {}) });
  return { status: response.status, body: await response.json() as any };
}

test('Web shared Wiki: exact configured old pin and origin, no automatic import/model or source/caller writes', async t => {
  const { source, caller, start, input, binding, calls } = await fixture(t), handle = await start();
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller), count = calls();
  const catalog = await call(handle, 'shared-catalog'); assert.equal(catalog.status, 200); assert.equal(catalog.body.result.configured, true);
  assert.equal(catalog.body.result.sources[0].commit, binding.commit); assert.doesNotMatch(JSON.stringify(catalog.body), /root|readers|MASTER_KEY|\.scratch/);
  const result = await call(handle, 'shared-snapshot', { ...input, expectedCommit: binding.commit }); assert.equal(result.status, 200);
  assert.equal(result.body.result.source.vaultId, binding.vaultId); assert.equal(result.body.result.source.tenantId, binding.tenantId);
  assert.equal(result.body.result.snapshot.commit, binding.commit); assert.match(result.body.result.snapshot.pages.find((page: any) => page.meta.key === pageKey).body, /DATED_WIKI_OLD_CANARY/);
  assert.doesNotMatch(JSON.stringify(result.body), /DATED_WIKI_CURRENT_CANARY/);
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller); assert.equal(calls(), count);
  assert.equal((await fetch(handle.url + '/.amem/shared-wiki.json')).status, 404);
});

test('Web shared Wiki: missing host setup is explicit and foreign fields/browser authority cannot configure it', async t => {
  const { start, input, configPath, source, binding } = await fixture(t), off = await start({ sharedWikiConfig: '' }), on = await start();
  const empty = await call(off, 'shared-catalog'); assert.equal(empty.status, 200); assert.equal(empty.body.result.configured, false); assert.deepEqual(empty.body.result.sources, []);
  assert.equal((await call(off, 'shared-snapshot', input)).body.error.code, 'DEPENDENCY_UNAVAILABLE');
  for (const extra of [{ root: source.root }, { commit: binding.commit }, { configPath }, { sharedWikiConfig: configPath }, { tenantId: binding.tenantId },
    { principal: { permissions: ['admin'] } }, { signal: {} }, { apply: true }, { expectedCommit: 'HEAD' }, { pageKeys: [pageKey, pageKey] }]) {
    assert.equal((await call(on, 'shared-snapshot', { ...input, ...extra })).status, 400);
  }
  assert.equal((await call(on, 'shared-catalog', { sourceId: binding.id })).status, 400);
  for (const headers of [{ Origin: 'https://foreign.invalid' }, { Authorization: 'Bearer wrong' }]) {
    assert.equal((await call(on, 'shared-catalog', {}, undefined, headers)).status, 403);
    assert.equal((await call(on, 'shared-snapshot', input, undefined, headers)).status, 403);
  }
  await assert.rejects(start({ sharedWikiConfig: 'relative' }), { code: 'CONFIG_INVALID' });
});

test('Web shared Wiki: current reader/grant/pin changes refuse old selections and never return a fallback', async t => {
  const { source, start, input, binding, saveBindings, principal } = await fixture(t), handle = await start();
  const old = (await call(handle, 'shared-catalog')).body.result.sources[0].commit;
  binding.commit = await source.git.run(['rev-parse', 'HEAD']); assert.notEqual(binding.commit, old); await saveBindings();
  const stale = await call(handle, 'shared-snapshot', { ...input, expectedCommit: old }); assert.equal(stale.body.error.code, 'VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(stale.body), /DATED_WIKI_/);
  const current = await call(handle, 'shared-snapshot', { ...input, expectedCommit: binding.commit }); assert.equal(current.status, 200);
  assert.match(JSON.stringify(current.body), /DATED_WIKI_CURRENT_CANARY/);
  principal.id = 'foreign'; assert.deepEqual((await call(handle, 'shared-catalog')).body.result.sources, []);
  assert.equal((await call(handle, 'shared-snapshot', input)).status, 404);
  principal.id = binding.readers[0]!.id; principal.permissions = ['write'];
  assert.equal((await call(handle, 'shared-catalog')).status, 403); assert.equal((await call(handle, 'shared-snapshot', input)).status, 403);
  principal.permissions = ['read']; await source.wikiRevoke(pageKey, 'Withdraw Web shared source');
  const withdrawn = await call(handle, 'shared-snapshot', input); assert.equal(withdrawn.status, 404); assert.doesNotMatch(JSON.stringify(withdrawn), /DATED_WIKI_/);
});

test('Web shared Wiki: private opt-out and capped clearance precede decryption; erased source keys remain unavailable', async t => {
  const { source, start, input, binding, saveBindings, versions } = await fixture(t, 'secret'), handle = await start();
  const decrypt = EncryptionManager.prototype.decrypt, seen: string[] = [];
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) { seen.push(meta.id); return decrypt.call(this, meta, body); });
  assert.equal((await call(handle, 'shared-catalog')).status, 200); assert.equal(seen.length, 0);
  assert.equal((await call(handle, 'shared-snapshot', { ...input, includeSecret: false })).status, 404); assert.equal(seen.length, 0);
  binding.maxSensitivity = 'internal'; await saveBindings(); assert.equal((await call(handle, 'shared-snapshot', input)).status, 404); assert.equal(seen.length, 0);
  binding.maxSensitivity = 'secret'; await saveBindings(); assert.equal((await call(handle, 'shared-snapshot', input)).status, 200); assert.ok(seen.length);
  await source.encryption.erase(versions[0]!.evidenceId);
  const denied = await call(handle, 'shared-snapshot', input); assert.equal(denied.body.error.code, 'ENCRYPTION_KEY_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(denied), /DATED_WIKI_|\.scratch|MASTER_KEY/);
});

test('Web shared Wiki: actual source-wait cancellation releases the caller lock and leaves both vaults unchanged', async t => {
  const { source, caller, start, input } = await fixture(t), handle = await start(), lock = join(source.root, '.amem/write.lock');
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller), acquired = deferred(), release = deferred(), controller = new AbortController();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const pending = call(handle, 'shared-snapshot', input, controller.signal).then(() => null, error => error);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); assert.equal(existsSync(join(caller.root, '.amem/write.lock')), false);
    controller.abort(); assert.ok(await pending); await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
  } finally { controller.abort(); release.resolve(); await owner; }
  assert.equal((await call(handle, 'shared-snapshot', input)).status, 200);
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
});

test('Web shared Wiki: oversized complete adapter output is refused without partial plaintext', async t => {
  const { start, input } = await fixture(t), handle = await start();
  t.mock.method(SharedWikiReader.prototype, 'snapshot', async () => ({ body: '界'.repeat(6_000_000) }));
  const result = await call(handle, 'shared-snapshot', input); assert.equal(result.body.error.code, 'CONTENT_TOO_LARGE');
  assert.ok(JSON.stringify(result).length < 1000);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(predicate: () => Promise<boolean>) { const end = performance.now() + 4000; while (!await predicate()) { assert.ok(performance.now() < end, 'Expected actual shared source wait'); await delay(10); } }
