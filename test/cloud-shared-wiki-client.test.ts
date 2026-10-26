import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import { MemoryVault } from '../src/vault.js';
import { sha256, withFileLock } from '../src/utils.js';
import { stableWikiJson } from '../src/wiki-proof.js';
import { wikiImportArtifact } from '../src/wiki-import-artifact.js';
import { readWikiImportArtifact } from '../src/wiki-import-artifact.js';
import type { EvidenceMeta, WikiPageDraft } from '../src/index.js';
import { integrity, pageKey } from './shared-wiki-fixture.js';
import { cloudClientFixture, cloudCredential } from './cloud-shared-wiki-client-fixture.js';

test('cloud client: real service preserves the old graph, local alias and source identity without source/broker/caller/model changes', async t => {
  const { source, broker, caller, reader, selection, binding, calls } = await cloudClientFixture(t);
  const before = await Promise.all([source, broker, caller].map(integrity)), count = calls();
  const catalog = await reader.catalog(); assert.equal(catalog.sources[0]!.id, binding.id);
  const view = await reader.snapshot(selection); assert.deepEqual(view.source, { id: binding.id, title: binding.title, vaultId: binding.vaultId, tenantId: binding.tenantId, commit: binding.commit });
  assert.match(view.snapshot.pages.find(page => page.meta.key === pageKey)!.body, /DATED_WIKI_OLD_CANARY/);
  assert.doesNotMatch(JSON.stringify(view), /DATED_WIKI_CURRENT_CANARY|CLOUD_TEST_CREDENTIAL|SHARED_TEST_MASTER_KEY|\.scratch/);
  assert.equal(JSON.stringify(view).includes(cloudCredential), false); assert.equal(view.snapshot.sources.length, 1);
  assert.equal(view.snapshot.rules.length, 1); assert.match(view.warnings.join(' '), /cloud|Cloud/);
  assert.deepEqual(await Promise.all([source, broker, caller].map(integrity)), before); assert.equal(calls(), count);
});

test('cloud client: catalog and invalid/ungranted requests never probe the configured remote endpoint', async t => {
  const { reader, selection, binding, saveBindings, principal } = await cloudClientFixture(t);
  let requests = 0; const endpoint = await fakeServer(t, (_body, res) => { requests++; res.writeHead(500); res.end(); });
  binding.origin = endpoint; await saveBindings(); assert.equal((await reader.catalog()).sources.length, 1); assert.equal(requests, 0);
  const { expectedCommit: _pin, ...withoutPin } = selection;
  for (const input of [withoutPin, { ...selection, expectedCommit: '0'.repeat(40) }, { ...selection, principal }, { ...selection, origin: endpoint },
    { ...selection, credentialEnv: binding.credentialEnv }, { ...selection, signal: {} }]) {
    await assert.rejects(reader.snapshot(input as never), { code: 'VALIDATION_FAILED' });
  }
  binding.readers = [{ id: 'other', tenantId: binding.readers[0]!.tenantId }]; await saveBindings();
  assert.deepEqual((await reader.catalog()).sources, []); await assert.rejects(reader.snapshot(selection), { code: 'NOT_FOUND' }); assert.equal(requests, 0);
});

test('cloud client: token, grants and current source withdrawal are checked on each read without a cached fallback', async t => {
  const { reader, selection, env, service, source, saveAccounts, account } = await cloudClientFixture(t);
  await reader.snapshot(selection); env.CLOUD_TEST_CREDENTIAL = 'x'.repeat(48);
  await assert.rejects(reader.snapshot(selection), { code: 'AUTHORIZATION_DENIED' }); env.CLOUD_TEST_CREDENTIAL = cloudCredential;
  await saveAccounts([]); await assert.rejects(reader.snapshot(selection), { code: 'AUTHORIZATION_DENIED' }); await saveAccounts([account]);
  await source.wikiRevoke(pageKey, 'Synthetic cloud client withdrawal'); await assert.rejects(reader.snapshot(selection), { code: 'NOT_FOUND' });
  await service.stop(); await assert.rejects(reader.snapshot(selection), { code: 'REMOTE_TRANSPORT' });
});

test('cloud client: local attenuation and private opt-out reach the server before source decryption', async t => {
  const { reader, selection, principal, binding, saveBindings } = await cloudClientFixture(t, 'secret');
  const decrypt = EncryptionManager.prototype.decrypt; let count = 0;
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) { count++; return decrypt.call(this, meta, body); });
  await assert.rejects(reader.snapshot({ ...selection, includeSecret: false }), { code: 'NOT_FOUND' }); assert.equal(count, 0);
  principal.maxSensitivity = 'internal'; await assert.rejects(reader.snapshot(selection), { code: 'NOT_FOUND' }); assert.equal(count, 0);
  principal.maxSensitivity = 'secret'; binding.maxSensitivity = 'internal'; await saveBindings();
  await assert.rejects(reader.snapshot(selection), { code: 'NOT_FOUND' }); assert.equal(count, 0);
  binding.maxSensitivity = 'secret'; await saveBindings(); await reader.snapshot(selection); assert.ok(count > 0);
});

test('cloud client: actual remote source-wait cancellation releases all waiters and never holds the local caller lock', async t => {
  const { reader, selection, source, caller } = await cloudClientFixture(t), before = await integrity(caller);
  const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred(), controller = new AbortController();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const pending = reader.snapshot({ ...selection, signal: controller.signal }).then(() => null, error => error);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); assert.equal(existsSync(join(caller.root, '.amem/write.lock')), false);
    controller.abort(); assert.equal((await pending)?.code, 'OPERATION_CANCELLED');
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
  } finally { controller.abort(); release.resolve(); await owner; }
  assert.deepEqual(await integrity(caller), before);
});

test('cloud client: configured request deadline cancels an actual server source wait', async t => {
  const { reader, selection, source, binding, saveBindings } = await cloudClientFixture(t);
  binding.timeoutMs = 300; await saveBindings();
  const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; await assert.rejects(reader.snapshot(selection), { code: 'REMOTE_TRANSPORT' });
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
  } finally { release.resolve(); await owner; }
});

test('cloud client: changed local bindings or selected credential during a remote wait refuse assembled content', async t => {
  const { reader, selection, source, binding, saveBindings, env } = await cloudClientFixture(t);
  for (const change of [async () => { binding.title += ' changed'; await saveBindings(); }, async () => { env.CLOUD_TEST_CREDENTIAL = 'x'.repeat(48); }]) {
    const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
    const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
    try {
      await acquired.promise; const pending = reader.snapshot(selection).then(() => null, error => error);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); await change(); release.resolve();
      assert.equal((await pending)?.code, 'AUTHORIZATION_DENIED');
    } finally { release.resolve(); await owner; env.CLOUD_TEST_CREDENTIAL = cloudCredential; }
  }
});

test('cloud client: strict transport config rejects unsafe origins, credentials, duplicate keys and unsupported modes', async t => {
  const { reader, binding, saveBindings, configPath } = await cloudClientFixture(t);
  for (const extra of [{ origin: 'http://example.invalid', allowLoopbackHttp: true }, { origin: 'http://localhost:1234', allowLoopbackHttp: true },
    { origin: 'https://user:password@example.invalid' }, { origin: 'https://example.invalid/path' }, { origin: 'https://example.invalid?token=secret' },
    { origin: 'https://example.invalid#hash' }, { origin: 'https://example.invalid/' }, { allowLoopbackHttp: false },
    { caFile: configPath }, { timeoutMs: 0 }, { token: cloudCredential }, { root: '/never/open' }, { transport: 'git' }]) {
    await saveBindings([{ ...binding, ...extra }]); await assert.rejects(reader.catalog(), { code: 'CONFIG_INVALID' });
  }
  await saveBindings(); const original = await readFile(configPath, 'utf8');
  await writeFile(configPath, original.replace('"version":2', '"version":2,"version":2')); await assert.rejects(reader.catalog(), { code: 'CONFIG_INVALID' });
});

test('cloud client: v2 local sources preserve v1 reads and a cloud service refuses recursive remote bindings', async t => {
  const data = await cloudClientFixture(t), { reader, selection, binding, saveBindings, brokerConfigPath, brokerBinding } = data;
  await saveBindings([{ ...brokerBinding, transport: 'local', id: binding.id, readers: binding.readers }]);
  const { expectedCommit: _pin, ...withoutPin } = selection; assert.equal((await reader.snapshot(withoutPin)).source.commit, binding.commit);
  await saveBindings();
  let requests = 0;
  const endpoint = await fakeServer(t, (_body, res) => { requests++; res.writeHead(500); res.end(); });
  const recursive = { ...binding, origin: endpoint, id: brokerBinding.id, readers: brokerBinding.readers, remoteSourceId: brokerBinding.id };
  await writeFile(brokerConfigPath, JSON.stringify({ version: 2, sources: [recursive] }));
  await assert.rejects(reader.snapshot(selection), { code: 'CONFIG_INVALID' });
  assert.equal(requests, 0); // A valid server-side credential must still never reach another service.
});

test('cloud client: real HTTPS verifies certificates and a changed host CA invalidates retained work', async t => {
  const directory = await mkdtemp(join(process.cwd(), '.scratch/cloud-client-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certificatePath = join(directory, 'certificate.pem'), keyPath = join(directory, 'key.pem'), config = join(directory, 'openssl.cnf');
  await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\n');
  await promisify(execFile)('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-keyout', keyPath, '-out', certificatePath], { timeout: 10_000 });
  const { reader, selection, binding, saveBindings } = await cloudClientFixture(t, 'internal', { tls: { certificatePath, keyPath } });
  binding.allowLoopbackHttp = false; await saveBindings();
  await assert.rejects(reader.snapshot(selection), { code: 'REMOTE_TRANSPORT' });
  binding.caFile = certificatePath; await saveBindings();
  const retained = await reader.snapshotWithValidation(selection); assert.equal(retained.view.source.commit, selection.expectedCommit);
  await writeFile(certificatePath, 'changed trust file');
  await assert.rejects(retained.validateConfiguration(), { code: 'AUTHORIZATION_DENIED' });
});

test('cloud client: committed metadata is preserved byte-for-byte and long ordinary-memory support remains readable', async t => {
  const data = await cloudClientFixture(t), { source, reader, binding, saveBindings, brokerBinding, saveBrokerBindings } = data;
  const directory = join(source.root, 'wiki/pages'); let expected: { path: string; meta: Record<string, unknown>; body: string } | undefined;
  for (const filename of await readdir(directory)) {
    const path = join(directory, filename), page = parseMarkdown<Record<string, unknown>>(await readFile(path, 'utf8'));
    if (page.meta.key === pageKey) { page.meta.title = '  exact title spacing  '; await writeFile(path, serializeMarkdown(page.meta, page.body)); expected = { path: 'wiki/pages/' + filename, ...page }; }
  }
  await source.git.commit('Synthetic exact metadata', source.principal, ['wiki']);
  binding.commit = brokerBinding.commit = await source.git.run(['rev-parse', 'HEAD']); await saveBindings(); await saveBrokerBindings();
  const view = await reader.snapshot({ ...data.selection, expectedCommit: binding.commit });
  const page = view.snapshot.pages.find(page => page.meta.key === pageKey)!; assert.equal('title' in page.meta && page.meta.title, '  exact title spacing  ');
  const artifact = wikiImportArtifact(view); assert.equal(artifact.pages.find(page => page.key === pageKey)!.recordHash, sha256(stableWikiJson(expected)));
  const raw = await source.capture({ content: 'Synthetic long legacy source', extract: false, scope: 'project' });
  const proposed = await source.propose({ key: 'k'.repeat(400), statement: 'b'.repeat(120_000), kind: 'fact', scope: 'project', sensitivity: 'internal',
    confidence: 1, explicit: true, conditions: ['Legacy multiline\ncondition'], tags: [] }, [raw.evidencePath]);
  const approved = await source.approve(proposed.id);
  binding.commit = brokerBinding.commit = await source.git.run(['rev-parse', 'HEAD']); await saveBindings(); await saveBrokerBindings();
  const legacy = await reader.snapshot({ ...data.selection, pageKeys: ['legacy:' + approved.memoryId], expectedCommit: binding.commit });
  assert.equal(legacy.snapshot.pages[0]!.meta.key.length, 400); assert.ok(legacy.snapshot.pages[0]!.body.includes('b'.repeat(120_000)));
});

test('cloud client: redirects never receive a forwarded credential, malformed and over-budget responses return safe failures', async t => {
  const { reader, selection, binding, saveBindings } = await cloudClientFixture(t); let forwarded = 0;
  const target = await fakeServer(t, (_body, res) => { forwarded++; res.end(); });
  const redirect = await fakeServer(t, (_body, res) => { res.writeHead(302, { Location: target }); res.end(); });
  binding.origin = redirect; await saveBindings(); await assert.rejects(reader.snapshot(selection), { code: 'REMOTE_TRANSPORT' }); assert.equal(forwarded, 0);
  for (const respond of [
    (res: ServerResponse) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('PRIVATE_RESPONSE_BODY'); },
    (res: ServerResponse) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '21000001' }); res.end(); },
    (res: ServerResponse) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"x":"PRIVATE_RESPONSE_BODY"}'); },
    (res: ServerResponse) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'REMOTE_TRANSPORT', message: 'PRIVATE_RESPONSE_BODY ' + cloudCredential } })); },
    (res: ServerResponse) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(Buffer.from([0xff])); },
  ]) {
    binding.origin = await fakeServer(t, (_body, res) => respond(res)); await saveBindings();
    await assert.rejects(reader.snapshot(selection), (error: any) => {
      assert.ok(['VALIDATION_FAILED', 'CONTENT_TOO_LARGE', 'REMOTE_TRANSPORT'].includes(error.code));
      assert.doesNotMatch(JSON.stringify(error.toJSON()), /PRIVATE_RESPONSE_BODY/); assert.equal(JSON.stringify(error.toJSON()).includes(cloudCredential), false); return true;
    });
  }
});

test('cloud client: identity, graph closure, unknown metadata, private labels and weakened restrictions are rejected', async t => {
  const { reader, selection, binding, saveBindings, service } = await cloudClientFixture(t);
  const actual = await fetch(service.url + '/v1/shared-wiki/snapshot', { method: 'POST', headers: { Authorization: 'Bearer ' + cloudCredential, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, sourceId: binding.remoteSourceId, attenuation: { scopes: ['project'], maxSensitivity: 'secret' } }) });
  const baseline = await actual.json() as any; assert.equal(actual.status, 200);
  const edits = [
    (data: any) => { data.view.source.vaultId = 'foreign'; }, (data: any) => { data.view.source.commit = '0'.repeat(40); },
    (data: any) => { data.view.snapshot.commit = '0'.repeat(40); }, (data: any) => { data.view.snapshot.requestedKeys = ['other']; },
    (data: any) => { data.view.snapshot.pages[0].meta.hostKey = 'never'; }, (data: any) => { data.view.snapshot.pages.push(data.view.snapshot.pages[0]); },
    (data: any) => { data.view.snapshot.sources = []; }, (data: any) => { data.view.snapshot.rules = []; },
    (data: any) => { data.support.conditions = []; }, (data: any) => { data.support.sensitivity = 'public'; },
    (data: any) => { data.view.snapshot.pages[0].meta.sensitivity = 'secret'; }, (data: any) => { data.view.snapshot.pages[0].path = '/private/unknown.md'; },
  ];
  for (const edit of edits) {
    const value = structuredClone(baseline); edit(value);
    binding.origin = await fakeServer(t, (_body, res) => json(res, value)); await saveBindings();
    await assert.rejects(reader.snapshot(selection), (error: any) => { assert.ok(['VALIDATION_FAILED', 'AUTHORIZATION_DENIED'].includes(error.code)); return true; });
  }
});

test('cloud client: elapsed server lease includes transit time and stays live during a real caller lock wait', async t => {
  const { reader, selection, binding, saveBindings, service, caller } = await cloudClientFixture(t);
  const actual = await fetch(service.url + '/v1/shared-wiki/snapshot', { method: 'POST', headers: { Authorization: 'Bearer ' + cloudCredential, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, sourceId: binding.remoteSourceId, attenuation: { scopes: ['project'], maxSensitivity: 'secret' } }) });
  const value = await actual.json() as any;
  value.validForMs = 100;
  binding.origin = await fakeServer(t, async (_body, res) => { await delay(150); json(res, value); }); await saveBindings();
  await assert.rejects(reader.snapshot(selection), { code: 'VALIDATION_FAILED' });
  value.validForMs = 500; let wait = false;
  const acquired = deferred(), release = deferred(), lock = join(caller.root, '.amem/write.lock'); let owner: Promise<void> | undefined;
  binding.origin = await fakeServer(t, async (_body, res) => {
    if (wait) { owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; }); await acquired.promise; }
    json(res, value);
  }); await saveBindings(); wait = true;
  try {
    const pending = reader.snapshot(selection).then(() => null, error => error);
    await acquired.promise; await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); await delay(600); release.resolve();
    assert.equal((await pending)?.code, 'VALIDATION_FAILED');
  } finally { release.resolve(); await owner; }
});

test('cloud client import: separate fresh confirmation, exact retry, current revocation and no automatic Wiki write', async t => {
  const { importer, selection, caller, localAdmin, source, broker, saveAccounts, account, calls } = await cloudClientFixture(t);
  const beforeSource = await integrity(source), beforeBroker = await integrity(broker), beforeCaller = await integrity(caller), count = calls();
  const { plan } = await importer.prepare(selection); assert.deepEqual(await integrity(caller), beforeCaller);
  assert.doesNotMatch(JSON.stringify(plan), /CLOUD_TEST_CREDENTIAL|attestationContext|\.scratch/); assert.equal(JSON.stringify(plan).includes(cloudCredential), false);
  await saveAccounts([]); await assert.rejects(importer.apply(plan, { confirm: true }), { code: 'AUTHORIZATION_DENIED' });
  assert.deepEqual(await integrity(caller), beforeCaller); await saveAccounts([account]);
  const result = await importer.apply(plan, { confirm: true }); assert.ok(result.commit);
  const artifact = readWikiImportArtifact(await localAdmin.get(result.evidenceId) as unknown as { path: string; meta: EvidenceMeta; body: string });
  assert.ok(artifact); assert.equal(artifact.source.commit, selection.expectedCommit); assert.equal(artifact.source.vaultId, plan.artifact.source.vaultId);
  assert.deepEqual(await localAdmin.wikiCatalog(), []); const head = await caller.git.run(['rev-parse', 'HEAD']);
  const duplicate = await importer.apply(plan, { confirm: true }); assert.equal(duplicate.commit, null); assert.equal(duplicate.duplicate, true);
  assert.equal(await caller.git.run(['rev-parse', 'HEAD']), head); assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(broker), beforeBroker); assert.equal(calls(), count);
});

test('cloud client import: a remote lease expiring during the actual destination writer wait rolls the copy back', async t => {
  const { importer, selection, caller, binding, saveBindings, service } = await cloudClientFixture(t), before = await integrity(caller);
  const response = await fetch(service.url + '/v1/shared-wiki/snapshot', { method: 'POST', headers: { Authorization: 'Bearer ' + cloudCredential, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, sourceId: binding.remoteSourceId, attenuation: { scopes: ['project'], maxSensitivity: 'secret' } }) });
  const envelope = await response.json() as any;
  binding.origin = await fakeServer(t, (_body, res) => json(res, envelope)); await saveBindings();
  const { plan } = await importer.prepare(selection); envelope.validForMs = 500;
  const lock = join(caller.root, '.amem/write.lock'), acquired = deferred(), release = deferred(); let owner: Promise<void> | undefined;
  const capture = MemoryVault.prototype.captureWikiImport;
  t.mock.method(MemoryVault.prototype, 'captureWikiImport', async function(this: MemoryVault, ...args: Parameters<typeof capture>) {
    owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; }); await acquired.promise;
    return capture.apply(this, args);
  });
  try {
    const pending = importer.apply(plan, { confirm: true }).then(() => null, error => error);
    await acquired.promise; await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); await delay(650); release.resolve();
    assert.equal((await pending)?.code, 'VALIDATION_FAILED');
  } finally { release.resolve(); await owner; }
  assert.deepEqual(await integrity(caller), before);
});

test('cloud client import: secret remote text becomes encrypted derived evidence and losing the server source key refuses new copies', async t => {
  const { importer, selection, caller, localAdmin, source, versions } = await cloudClientFixture(t, 'secret');
  const { plan } = await importer.prepare(selection); assert.equal(plan.sensitivity, 'secret');
  const result = await importer.apply(plan, { confirm: true }), bytes = await readFile(join(caller.root, result.evidencePath), 'utf8');
  assert.doesNotMatch(bytes, /DATED_WIKI_OLD_CANARY|compiled-wiki-source-artifact/);
  assert.match((await localAdmin.get(result.evidenceId)).body, /DATED_WIKI_OLD_CANARY/);
  const before = await integrity(caller); await source.encryption.erase(versions[0]!.evidenceId);
  await assert.rejects(importer.apply(plan, { confirm: true }), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
  assert.deepEqual(await integrity(caller), before);
});

function json(res: ServerResponse, value: unknown) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
async function fakeServer(t: TestContext, handler: (body: unknown, res: ServerResponse) => void | Promise<void>) {
  const server = createServer(async (req, res) => {
    try { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); await handler(JSON.parse(Buffer.concat(chunks).toString('utf8')), res); }
    catch { res.destroy(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { const stopped = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await stopped; });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(predicate: () => Promise<boolean>) { const end = performance.now() + 5000; while (!await predicate()) { assert.ok(performance.now() < end, 'Expected actual remote or caller lock wait'); await delay(10); } }
