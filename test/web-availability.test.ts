import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { MemoryVault } from '../src/vault.js';
import { startWebServer, type WebHandle } from '../src/web.js';
import { withFileLock } from '../src/utils.js';
import { fixture, masterKey, pageKey } from './dated-wiki-fixture.js';

async function call(handle: WebHandle, name: string, input: object, signal?: AbortSignal, headers: Record<string, string> = {}) {
  const response = await fetch(handle.url + '/api/' + name, { method: 'POST', headers: {
    Origin: handle.url, Authorization: 'Bearer ' + handle.token, 'Content-Type': 'application/json', ...headers,
  }, body: JSON.stringify(input), ...(signal ? { signal } : {}) });
  return { status: response.status, body: await response.json() as any };
}

test('Web availability: explicit observation and exact old read after an actual page change, without query writes/model calls', async t => {
  const { vault, root, llm, cleanup, calls, versions } = await fixture(t);
  const handle = await startWebServer(root, { llm, masterKey }); cleanup.push(() => handle.stop());
  const input = { pageKeys: [pageKey] }, at = new Date().toISOString(), raw = await readFile(join(root, versions[1]!.evidencePath), 'utf8');
  assert.equal((await call(handle, 'wiki-as-known-at', { ...input, at })).body.result.items[0].status, 'unknown');
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await call(handle, 'wiki-observe', input)).status, 400);
  assert.equal((await call(handle, 'wiki-observe', { ...input, confirm: false })).status, 400);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const saved = await call(handle, 'wiki-observe', { ...input, confirm: true }); assert.equal(saved.status, 200);
  const observed = saved.body.result;
  const newer = await vault.capture({ content: 'WEB_AVAILABILITY_NEW_CANARY', scope: 'project', extract: false });
  await vault.wikiIngest({ evidenceIds: [newer.evidenceId], apply: true });
  const current = await vault.wikiSnapshot({ commit: await vault.git.run(['rev-parse', 'HEAD']), pageKeys: [pageKey] });
  assert.match(current.pages.find(page => page.meta.key === pageKey)!.body, /WEB_AVAILABILITY_NEW_CANARY/);
  const before = await vault.git.run(['rev-parse', 'HEAD']), count = calls();
  const result = await call(handle, 'wiki-as-known-at', { ...input, at: observed.observedAt, observationIds: [observed.evidenceId] });
  assert.equal(result.status, 200); assert.equal(result.body.result.coverage.mode, 'explicit-observation-ids');
  const item = result.body.result.items[0]; assert.equal(item.status, 'observed'); assert.equal(item.snapshot.commit, observed.observedCommit);
  assert.match(item.snapshot.pages.find((page: any) => page.meta.key === pageKey).body, /DATED_WIKI_CURRENT_CANARY/);
  assert.doesNotMatch(JSON.stringify(result.body), /WEB_AVAILABILITY_NEW_CANARY/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before); assert.equal(calls(), count);
  assert.equal(await readFile(join(root, versions[1]!.evidencePath), 'utf8'), raw);
  await vault.wikiRevoke(pageKey, 'Withdraw Web observation fixture');
  assert.equal((await call(handle, 'wiki-as-known-at', { ...input, at: observed.observedAt })).status, 404);
});

test('Web availability: strict fields, current grants, tenant and browser authority cannot be overridden', async t => {
  const { root, vault, llm, cleanup } = await fixture(t);
  const handle = await startWebServer(root, { llm }); cleanup.push(() => handle.stop());
  const reader = await startWebServer(root, { principal: { ...vault.principal, permissions: ['read'], tenantId: (await vault.config()).tenantId } }); cleanup.push(() => reader.stop());
  const head = await vault.git.run(['rev-parse', 'HEAD']), input = { pageKeys: [pageKey] }, at = new Date().toISOString();
  for (const extra of [{ root: '/foreign' }, { principal: vault.principal }, { tenantId: 'foreign' }, { permissions: ['admin'] }, { signal: {} }, { commit: head }, { executable: 'never' }, { pageKeys: [pageKey, pageKey] }]) {
    assert.equal((await call(handle, 'wiki-observe', { ...input, confirm: true, ...extra })).status, 400);
    assert.equal((await call(handle, 'wiki-as-known-at', { ...input, at, ...extra })).status, 400);
  }
  assert.equal((await call(handle, 'wiki-observe', { ...input, confirm: true, observedAt: at })).status, 400);
  assert.equal((await call(reader, 'wiki-observe', { ...input, confirm: true })).status, 403);
  assert.equal((await call(reader, 'wiki-as-known-at', { ...input, at })).status, 200);
  for (const headers of [{ Authorization: 'Bearer wrong' }, { Origin: 'https://foreign.invalid' }]) {
    assert.equal((await call(handle, 'wiki-observe', { ...input, confirm: true }, undefined, headers)).status, 403);
    assert.equal((await call(handle, 'wiki-as-known-at', { ...input, at }, undefined, headers)).status, 403);
  }
  await assert.rejects(startWebServer(root, { principal: { ...vault.principal, tenantId: 'foreign' } }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('Web availability: private opt-out precedes decryption and erased selected source keys do not reveal old content', async t => {
  const { root, vault, llm, cleanup, versions } = await fixture(t, 'secret');
  const handle = await startWebServer(root, { llm, masterKey }); cleanup.push(() => handle.stop());
  const original = EncryptionManager.prototype.decrypt, seen: string[] = [];
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) {
    seen.push(meta.id); return original.call(this, meta, body);
  });
  const input = { pageKeys: [pageKey] }, at = new Date().toISOString();
  assert.equal((await call(handle, 'wiki-as-known-at', { ...input, at })).body.result.items[0].status, 'unknown');
  assert.equal((await call(handle, 'wiki-observe', { ...input, confirm: true })).status, 404); assert.equal(seen.length, 0);
  const saved = await call(handle, 'wiki-observe', { ...input, confirm: true, includeSecret: true }); assert.equal(saved.status, 200);
  const query = { ...input, at: saved.body.result.observedAt };
  assert.equal((await call(handle, 'wiki-as-known-at', query)).body.result.items[0].status, 'unknown');
  assert.equal((await call(handle, 'wiki-as-known-at', { ...query, includeSecret: true })).body.result.items[0].status, 'observed');
  await vault.encryption.erase(versions[1]!.evidenceId);
  const denied = await call(handle, 'wiki-as-known-at', { ...query, includeSecret: true });
  assert.equal(denied.body.error.code, 'ENCRYPTION_KEY_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(denied), /DATED_WIKI_/);
});

test('Web availability: cancelling actual read and write lock waits clears only this request and writes nothing', async t => {
  const { root, vault, cleanup } = await fixture(t), handle = await startWebServer(root); cleanup.push(() => handle.stop());
  for (const [name, input] of [['wiki-observe', { pageKeys: [pageKey], confirm: true }], ['wiki-as-known-at', { pageKeys: [pageKey], at: new Date().toISOString() }]] as const) {
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const lock = join(root, '.amem/write.lock'), head = await vault.git.run(['rev-parse', 'HEAD']);
    const owner = withFileLock(lock, async () => { entered(); await gate; }), controller = new AbortController();
    try {
      await acquired; const pending = call(handle, name, input, controller.signal).then(() => null, error => error);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
      controller.abort(); assert.ok(await pending);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
    } finally { controller.abort(); release(); await owner; }
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  }
  assert.equal((await call(handle, 'wiki-as-known-at', { pageKeys: [pageKey], at: new Date().toISOString() })).status, 200);
});

test('Web availability: error adapter exposes only validated completed IDs, never attached manifests', async t => {
  const { root, cleanup } = await fixture(t), handle = await startWebServer(root); cleanup.push(() => handle.stop());
  let completed: unknown;
  t.mock.method(MemoryVault.prototype, 'wikiObserveAvailability', async () => { throw new AgentMemoryError('AUTHORIZATION_DENIED', 'PRIVATE_CANARY', { completedAvailability: completed, content: 'PRIVATE_CANARY' }); });
  const valid = { evidenceId: 'ev-0123456789ab', commit: 'a'.repeat(40) };
  for (const value of [valid, { ...valid, commit: null }, { ...valid, content: 'PRIVATE_CANARY' }, { ...valid, evidenceId: 'PRIVATE_CANARY' }, { ...valid, commit: 'wrong' }]) {
    completed = value;
    const result = await call(handle, 'wiki-observe', { pageKeys: [pageKey], confirm: true }); assert.equal(result.status, 403);
    if (value === valid || value.commit === null) assert.deepEqual(result.body.error.completedAvailability, value);
    else assert.equal('completedAvailability' in result.body.error, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY/);
  }
});

test('Web availability: complete escaped output exceeding the Web budget fails rather than truncating', async t => {
  const { root, cleanup } = await fixture(t), handle = await startWebServer(root); cleanup.push(() => handle.stop());
  t.mock.method(MemoryVault.prototype, 'wikiAsKnownAt', async () => ({ content: '界'.repeat(6_000_000) }));
  const result = await call(handle, 'wiki-as-known-at', { pageKeys: [pageKey], at: new Date().toISOString() });
  assert.equal(result.status, 400); assert.equal(result.body.error.code, 'CONTENT_TOO_LARGE'); assert.ok(JSON.stringify(result).length < 1000);
});

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!await predicate()) { assert.ok(Date.now() < deadline, 'Expected actual lock state'); await delay(10); }
}
