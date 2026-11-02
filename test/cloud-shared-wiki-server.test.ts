import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest, ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { parseCloudJson, readCloudAccounts } from '../src/shared-wiki-cloud-config.js';
import { startCloudWikiServer, type CloudWikiServerHandle, type CloudWikiServerOptions } from '../src/shared-wiki-cloud-server.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import type { Sensitivity } from '../src/types.js';
import { sha256, withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { integrity, pageKey, sharedFixture } from './shared-wiki-fixture.js';

const token = 'synthetic_cloud_test_credential_00000000000000000000';
const attenuation = { scopes: ['project'], maxSensitivity: 'secret' };
async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  const base = await sharedFixture(t, sensitivity), accountPath = join(base.caller.root, '.amem/cloud-accounts.json');
  const account = { id: base.principal.id, tokenSha256: sha256(token), root: base.caller.root,
    vaultId: base.callerConfig.vaultId, tenantId: base.callerConfig.tenantId,
    sharedWikiConfig: base.configPath, scopes: ['project'], maxSensitivity: 'secret' };
  const saveAccounts = (accounts: unknown[] = [account]) => writeFile(accountPath, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
  await saveAccounts();
  const start = async (options: Partial<CloudWikiServerOptions> = {}) => {
    const handle = await startCloudWikiServer({ configPath: accountPath, env: base.env, ...options });
    base.cleanup.push(() => handle.stop()); return handle;
  };
  return { ...base, account, accountPath, saveAccounts, start, selection: { ...base.input, expectedCommit: base.binding.commit, attenuation } };
}
async function call(handle: CloudWikiServerHandle, name: string, body: object, options: { token?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  const response = await fetch(handle.url + '/v1/shared-wiki/' + name, { method: 'POST',
    headers: { Authorization: 'Bearer ' + (options.token ?? token), 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body), ...(options.signal ? { signal: options.signal } : {}) });
  return { status: response.status, headers: response.headers, body: await response.json() as any };
}

test('cloud service: real HTTP returns the old pin and full provenance without models or canonical changes', async t => {
  const data = await fixture(t), { source, caller, start, selection, binding, calls } = data, handle = await start();
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller), count = calls();
  assert.deepEqual(await (await fetch(handle.url + '/healthz')).json(), { status: 'ok' });
  const catalog = await call(handle, 'catalog', { attenuation }); assert.equal(catalog.status, 200);
  assert.equal(catalog.body.sources[0].commit, binding.commit);
  const result = await call(handle, 'snapshot', selection); assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store'); assert.equal(result.body.kind, 'cloud-shared-wiki-snapshot');
  assert.equal(result.body.view.source.commit, binding.commit); assert.equal(result.body.view.source.vaultId, binding.vaultId);
  assert.equal(result.body.view.source.tenantId, binding.tenantId); assert.equal(result.body.view.snapshot.sources.length, 1);
  assert.equal(result.body.view.snapshot.rules.length, 1); assert.equal(result.body.support.sensitivity, 'internal');
  assert.ok(result.body.validForMs > 0 && result.body.validForMs <= 30_000);
  assert.match(JSON.stringify(result.body), /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(JSON.stringify(result.body), /DATED_WIKI_CURRENT_CANARY/);
  for (const secret of [token, data.account.tokenSha256, caller.root, source.root, 'SHARED_TEST_MASTER_KEY']) assert.equal(JSON.stringify(result.body).includes(secret), false);
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller); assert.equal(calls(), count);
});

test('cloud service: account authentication precedes resource access and never accepts request-selected authority', async t => {
  const { start, account, saveAccounts, selection, source } = await fixture(t), handle = await start();
  account.root = join(source.root, 'PRIVATE_ROOT_MUST_NOT_BE_OPENED'); await saveAccounts();
  let opens = 0; const original = MemoryVault.prototype.config;
  t.mock.method(MemoryVault.prototype, 'config', async function(this: MemoryVault) { opens++; return original.call(this); });
  for (const headers of [{ Authorization: 'Bearer wrong' }, { Authorization: 'Bearer ' + 'x'.repeat(48) }, { Origin: 'null' }]) {
    const result = await call(handle, 'snapshot', selection, { headers }); assert.ok([401, 403].includes(result.status));
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_ROOT|\.scratch|DATED_WIKI_/);
  }
  // Send Host through native HTTP: fetch may replace a caller-supplied Host header.
  assert.equal((await rawCall(handle, Buffer.from(JSON.stringify(selection)), undefined, undefined, 'foreign.invalid')).status, 403);
  assert.equal(opens, 0);
  for (const extra of [{ root: source.root }, { principal: { permissions: ['admin'] } }, { tenantId: 'foreign' }, { signal: {} }, { expectedCommit: 'HEAD' }, { command: 'never' }, { commit: selection.expectedCommit }]) {
    assert.equal((await call(handle, 'snapshot', { ...selection, ...extra })).status, 400);
  }
  const { expectedCommit: _pin, ...withoutPin } = selection;
  assert.equal((await call(handle, 'snapshot', withoutPin)).status, 400); assert.equal(opens, 0);
  assert.equal((await fetch(handle.url + '/.amem/cloud-accounts.json')).status, 405);
});

test('cloud service: attenuation, account ceilings and explicit private selection apply before decryption', async t => {
  const { start, selection, account, saveAccounts, source, versions } = await fixture(t, 'secret'), handle = await start();
  const decrypt = EncryptionManager.prototype.decrypt; let decryptions = 0;
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) {
    decryptions++; return decrypt.call(this, meta, body);
  });
  assert.equal((await call(handle, 'catalog', { attenuation })).status, 200); assert.equal(decryptions, 0);
  assert.equal((await call(handle, 'snapshot', { ...selection, includeSecret: false })).status, 404); assert.equal(decryptions, 0);
  assert.equal((await call(handle, 'snapshot', { ...selection, attenuation: { ...attenuation, maxSensitivity: 'internal' } })).status, 404); assert.equal(decryptions, 0);
  assert.equal((await call(handle, 'snapshot', { ...selection, attenuation: { ...attenuation, scopes: ['public'] } })).status, 403); assert.equal(decryptions, 0);
  account.maxSensitivity = 'internal'; await saveAccounts();
  assert.equal((await call(handle, 'snapshot', selection)).status, 404); assert.equal(decryptions, 0);
  account.maxSensitivity = 'secret'; await saveAccounts();
  assert.equal((await call(handle, 'snapshot', selection)).status, 200); assert.ok(decryptions > 0);
  await source.encryption.erase(versions[0]!.evidenceId);
  const missing = await call(handle, 'snapshot', selection); assert.equal(missing.body.error.code, 'ENCRYPTION_KEY_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(missing.body), /DATED_WIKI_|MASTER_KEY|\.scratch/);
});

test('cloud service: changed broker identity, stale pin and current withdrawal refuse without a fallback', async t => {
  const { start, selection, account, saveAccounts, source, binding, saveBindings } = await fixture(t), handle = await start();
  const originalVaultId = account.vaultId; account.vaultId = 'foreign'; await saveAccounts();
  assert.equal((await call(handle, 'snapshot', selection)).status, 403);
  account.vaultId = originalVaultId; await saveAccounts();
  binding.commit = await source.git.run(['rev-parse', 'HEAD']); await saveBindings();
  assert.equal((await call(handle, 'snapshot', selection)).body.error.code, 'VALIDATION_FAILED');
  binding.commit = selection.expectedCommit; await saveBindings();
  await source.wikiRevoke(pageKey, 'Synthetic cloud withdrawal');
  const result = await call(handle, 'snapshot', selection); assert.equal(result.status, 404); assert.doesNotMatch(JSON.stringify(result.body), /DATED_WIKI_/);
});

test('cloud service: account removal during a real source-lock wait refuses assembled plaintext and token rotation takes effect', async t => {
  const { start, selection, account, saveAccounts, source, caller } = await fixture(t), handle = await start();
  const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller);
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const pending = call(handle, 'snapshot', selection);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
    assert.equal(existsSync(join(caller.root, '.amem/write.lock')), false);
    await saveAccounts([]); release.resolve();
    const result = await pending; assert.equal(result.status, 403); assert.doesNotMatch(JSON.stringify(result.body), /DATED_WIKI_/);
  } finally { release.resolve(); await owner; }
  const replacement = 'synthetic_replacement_credential_000000000000000000'; account.tokenSha256 = sha256(replacement); await saveAccounts();
  assert.equal((await call(handle, 'snapshot', selection)).status, 401);
  assert.equal((await call(handle, 'snapshot', selection, { token: replacement })).status, 200);
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
});

test('cloud service: changed source bindings and keys after a read refuse buffered plaintext', async t => {
  const { start, selection, binding, saveBindings, source, env } = await fixture(t, 'secret'), handle = await start();
  const original = MemoryVault.prototype.wikiSnapshotWithValidation; let change: () => Promise<void>;
  t.mock.method(MemoryVault.prototype, 'wikiSnapshotWithValidation', async function(this: MemoryVault, input: Parameters<typeof original>[0]) {
    const retained = await original.call(this, input); if (this.root === source.root) await change(); return retained;
  });
  change = async () => { binding.readers[0]!.id = 'removed'; await saveBindings(); };
  const removed = await call(handle, 'snapshot', selection); assert.equal(removed.status, 403); assert.doesNotMatch(JSON.stringify(removed), /DATED_WIKI_/);
  binding.readers[0]!.id = 'shared-reader'; await saveBindings();
  change = async () => { delete env.SHARED_TEST_MASTER_KEY; };
  const erased = await call(handle, 'snapshot', selection); assert.equal(erased.status, 403); assert.doesNotMatch(JSON.stringify(erased), /DATED_WIKI_/);
});

test('cloud service: real source-wait deadline and client disconnect cancel work without canonical writes', async t => {
  const { start, selection, source, caller } = await fixture(t), handle = await start({ limits: { requestTimeoutMs: 600 } });
  const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller), controller = new AbortController();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise;
    const deadline = await call(handle, 'snapshot', selection); assert.equal(deadline.status, 408); assert.equal(deadline.body.error.code, 'OPERATION_CANCELLED');
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
    const cancelled = call(handle, 'snapshot', selection, { signal: controller.signal }).then(() => null, error => error);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); controller.abort(); assert.ok(await cancelled);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
  } finally { controller.abort(); release.resolve(); await owner; }
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
});

test('cloud service: per-account concurrency is bounded while actual source work waits', async t => {
  const { start, selection, source } = await fixture(t), handle = await start({ limits: { perAccountConcurrent: 1 } });
  const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const first = call(handle, 'snapshot', selection);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
    const second = await call(handle, 'snapshot', selection); assert.equal(second.status, 429);
    release.resolve(); assert.equal((await first).status, 200);
    assert.equal((await call(handle, 'snapshot', selection)).status, 200);
  } finally { release.resolve(); await owner; }
});

test('cloud service: account and global request budgets apply independently', async t => {
  const { start } = await fixture(t), accountLimited = await start({ limits: { perAccountRequestsPerMinute: 1 } });
  assert.equal((await call(accountLimited, 'catalog', { attenuation })).status, 200);
  assert.equal((await call(accountLimited, 'catalog', { attenuation })).status, 429);
  const globallyLimited = await start({ limits: { requestsPerMinute: 1 } });
  assert.equal((await fetch(globallyLimited.url + '/healthz')).status, 200);
  assert.equal((await fetch(globallyLimited.url + '/healthz')).status, 429);
});

test('cloud service: concurrency and request deadline cover a real slow response until finish or close', async t => {
  const { start, selection } = await fixture(t), handle = await start({ limits: { maxConcurrent: 1, perAccountConcurrent: 1, requestTimeoutMs: 500 } });
  t.mock.method(SharedWikiReader.prototype, 'snapshotWithValidation', async () => ({
    view: { body: 'x'.repeat(10_000_000) }, support: {}, validate() {}, async validateConfiguration() {},
  }));
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = httpRequest(handle.url + '/v1/shared-wiki/snapshot', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    }, res => { res.pause(); res.on('error', () => {}); resolve(res); });
    req.once('error', reject); req.end(JSON.stringify(selection));
  });
  try {
    assert.equal(response.statusCode, 200);
    assert.equal((await call(handle, 'catalog', { attenuation })).status, 429);
    await delay(650);
    assert.equal((await call(handle, 'catalog', { attenuation })).status, 200);
    let received = 0;
    await new Promise<void>(resolve => {
      response.on('data', chunk => { received += chunk.length; });
      response.once('close', resolve); response.resume();
    });
    assert.equal(response.complete, false); assert.ok(received < 10_000_000, 'Deadline must close the unfinished response');
  } finally { response.destroy(); }
});

test('cloud service: strict bytes, duplicate keys and duplicate credentials refuse before source access', async t => {
  const { start, selection } = await fixture(t), handle = await start(); let reads = 0;
  t.mock.method(SharedWikiReader.prototype, 'snapshotWithValidation', async () => { reads++; throw new Error('PRIVATE_SOURCE_ERROR'); });
  for (const bytes of [Buffer.from('{bad'), Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    Buffer.from('{"attenuation":{},"attenu\\u0061tion":{}}'), Buffer.from(JSON.stringify({ ...selection, pageKeys: [pageKey, pageKey] }))]) {
    const response = await rawCall(handle, bytes); assert.equal(response.status, 400); assert.doesNotMatch(JSON.stringify(response), /PRIVATE_SOURCE_ERROR/);
  }
  const duplicate = await rawCall(handle, Buffer.from(JSON.stringify(selection)), ['Authorization', 'Bearer ' + token, 'Authorization', 'Bearer ' + token]);
  assert.equal(duplicate.status, 401); assert.equal(reads, 0);
  const huge = await rawCall(handle, Buffer.from(' '.repeat(65_537))); assert.equal(huge.status, 413); assert.equal(reads, 0);
  const internal = await call(handle, 'snapshot', selection); assert.equal(internal.status, 400);
  assert.doesNotMatch(JSON.stringify(internal.body), /PRIVATE_SOURCE_ERROR/);
});

test('cloud service: complete output budget refuses instead of returning partial content', async t => {
  const { start, selection } = await fixture(t), handle = await start();
  t.mock.method(SharedWikiReader.prototype, 'snapshotWithValidation', async () => ({
    view: { body: '界'.repeat(7_000_001) }, support: {}, validate() {}, async validateConfiguration() {},
  }));
  const response = await call(handle, 'snapshot', selection); assert.equal(response.status, 413); assert.ok(JSON.stringify(response.body).length < 200);
});

test('cloud service: failed error-response delivery is handled and the service remains usable', async t => {
  const { start } = await fixture(t), handle = await start();
  const end = ServerResponse.prototype.end; let failed = false;
  t.mock.method(ServerResponse.prototype, 'end', function(this: ServerResponse, ...args: Parameters<typeof end>) {
    if (this.statusCode === 401 && !failed) {
      failed = true;
      this.emit('error', new Error('SYNTHETIC_PRIVATE_SOCKET_ERROR')); this.destroy(); return this;
    }
    return end.apply(this, args);
  });
  // Native HTTP does not retry a failed connection and exposes this single injected send failure.
  await assert.rejects(rawCall(handle, Buffer.from('{}'), ['Authorization', 'Bearer wrong']));
  assert.equal(failed, true);
  assert.equal((await call(handle, 'catalog', { attenuation })).status, 200);
});

test('cloud service: stop cancels an actual source wait and closes unfinished request bodies', async t => {
  const { start, selection, source } = await fixture(t), handle = await start();
  const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  let socket: ReturnType<typeof connect> | undefined;
  try {
    await acquired.promise; const pending = call(handle, 'snapshot', selection).then(() => null, error => error);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
    const endpoint = new URL(handle.url);
    socket = connect(Number(endpoint.port), endpoint.hostname); socket.on('error', () => {});
    await new Promise<void>(resolve => socket!.once('connect', resolve));
    socket.write(`POST /v1/shared-wiki/catalog HTTP/1.1\r\nHost: ${endpoint.host}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
    const stopping = handle.stop(); assert.equal(handle.stop(), stopping); await stopping; assert.ok(await pending);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
    await assert.rejects(fetch(handle.url + '/healthz'));
  } finally { socket?.destroy(); release.resolve(); await owner; }
});

test('cloud service: host configuration is bounded, strict, reloadable and rejects symlinks', async t => {
  const { start, account, accountPath, saveAccounts } = await fixture(t);
  for (const value of [{ version: 2, accounts: [account] }, { version: 1, accounts: [account, account] },
    { version: 1, accounts: [{ ...account, permissions: ['admin'] }] }, { version: 1, accounts: [{ ...account, root: 'relative' }] },
    { version: 1, accounts: [{ ...account, token: 'never' }] }, { version: 1, accounts: [{ ...account, tokenSha256: 'short' }] }]) {
    await writeFile(accountPath, JSON.stringify(value)); await assert.rejects(start(), { code: 'CONFIG_INVALID' });
  }
  await writeFile(accountPath, ' '.repeat(100_001)); await assert.rejects(start(), { code: 'CONTENT_TOO_LARGE' });
  await saveAccounts(); const original = accountPath + '.original'; await rename(accountPath, original); await symlink(original, accountPath);
  await assert.rejects(start(), { code: 'CONFIG_INVALID' });
});

test('cloud service: public HTTP is refused and real TLS requires client certificate trust', async t => {
  const { start, caller, selection } = await fixture(t);
  await assert.rejects(start({ host: '0.0.0.0' }), { code: 'CONFIG_INVALID' });
  await assert.rejects(start({ publicOrigin: 'https://wrong.invalid' }), { code: 'CONFIG_INVALID' });
  const certificatePath = join(caller.root, '.amem/test-cert.pem'), keyPath = join(caller.root, '.amem/test-key.pem'), config = join(caller.root, '.amem/test-cert.cnf');
  await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\n');
  await promisify(execFile)('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-keyout', keyPath, '-out', certificatePath], { timeout: 10_000 });
  const handle = await start({ tls: { certificatePath, keyPath } });
  assert.ok(handle.url.startsWith('https://')); await assert.rejects(fetch(handle.url + '/healthz'));
  const ca = await readFile(certificatePath), response = await rawCall(handle, Buffer.from(JSON.stringify(selection)), undefined, ca);
  assert.equal(response.status, 200); assert.match(JSON.stringify(response.body), /DATED_WIKI_OLD_CANARY/);
  await writeFile(certificatePath, 'not a certificate'); await assert.rejects(start({ tls: { certificatePath, keyPath } }), { code: 'CONFIG_INVALID' });
});

test('cloud service: JSON byte parser preserves string content but refuses escaped duplicate keys and excessive depth', () => {
  assert.deepEqual(parseCloudJson(Buffer.from('{"body":"{[\\\"x\\\"]} 中文 🧠", "array":[{"x":1},{"x":2}]}')), { body: '{["x"]} 中文 🧠', array: [{ x: 1 }, { x: 2 }] });
  for (const source of ['{"x":1,"\\u0078":2}', '{"outer":{"x":1,"x":2}}', '['.repeat(65) + '0' + ']'.repeat(65)]) {
    assert.throws(() => parseCloudJson(Buffer.from(source)), { code: 'VALIDATION_FAILED' });
  }
});

function rawCall(handle: CloudWikiServerHandle, bytes: Buffer, headers?: string[], ca?: Buffer, host?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const url = new URL(handle.url + '/v1/shared-wiki/snapshot');
    const req = (ca ? httpsRequest : httpRequest)(url, { method: 'POST', ...(ca ? { ca } : {}),
      headers: ['Host', host ?? url.host, 'Content-Type', 'application/json', 'Content-Length', String(bytes.length),
        ...(headers ?? ['Authorization', 'Bearer ' + token])],
    }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.once('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } });
      res.once('error', reject);
    });
    req.once('error', reject); req.end(bytes);
  });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(predicate: () => Promise<boolean>) { const end = performance.now() + 5000; while (!await predicate()) { assert.ok(performance.now() < end, 'Expected actual cloud source wait'); await delay(10); } }
