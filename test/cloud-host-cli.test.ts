import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { createCloudWikiCredential, cloudWikiAccountTemplate, inspectCloudWikiAccounts } from '../src/shared-wiki-cloud-host.js';
import { startCloudWikiServer } from '../src/shared-wiki-cloud-server.js';
import { localAdminPrincipal, type Principal } from '../src/policy.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import { sha256, withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { integrity, pageKey, sharedFixture } from './shared-wiki-fixture.js';
import type { Sensitivity } from '../src/types.js';

const exec = promisify(execFile), credential = 'synthetic_host_cli_credential_000000000000000000000';
function environment(extra: Record<string, string> = {}): Record<string, string> {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string>, ...extra };
}
const run = (args: string[], env: Record<string, string> = {}) => exec(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'cloud', ...args], { env: environment(env), timeout: 30000, killSignal: 'SIGKILL' });
async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  const data = await sharedFixture(t, sensitivity), accountPath = join(data.caller.root, '.amem/cloud-accounts.json');
  const account = { id: data.principal.id, tokenSha256: sha256(credential), root: data.caller.root,
    vaultId: data.callerConfig.vaultId, tenantId: data.callerConfig.tenantId, sharedWikiConfig: data.configPath,
    scopes: ['project'] as ['project'], maxSensitivity: sensitivity };
  const saveAccounts = (accounts: unknown[] = [account]) => writeFile(accountPath, JSON.stringify({ version: 1, accounts }), { mode: 0o600 }); await saveAccounts();
  const operator: Principal = { ...localAdminPrincipal({ id: 'operator', name: 'Synthetic operator' }),
    tenantId: data.callerConfig.tenantId, scopes: ['project'], maxSensitivity: sensitivity };
  const env = environment({ ...data.env, AMEM_PERMISSIONS: 'admin', AMEM_TENANT_ID: data.callerConfig.tenantId,
    AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: sensitivity });
  const templateArgs = ['account-template', '--id', account.id, '--broker-root', account.root, '--sources-config', account.sharedWikiConfig,
    '--token-sha256', account.tokenSha256, '--scopes', 'project', '--max-sensitivity', sensitivity];
  return { ...data, accountPath, account, saveAccounts, operator, env, templateArgs,
    selection: { ...data.input, expectedCommit: data.binding.commit, attenuation: { scopes: ['project'], maxSensitivity: sensitivity } } };
}

test('cloud host CLI: credentials and valid account templates only print data and leave canonical state/configuration unchanged', async t => {
  const data = await fixture(t), { source, caller, accountPath, account, templateArgs, env, calls } = data;
  const before = await Promise.all([source, caller].map(integrity)), bytes = await readFile(accountPath), count = calls();
  const first = JSON.parse((await run(['credentials'], env)).stdout), second = JSON.parse((await run(['credentials'], env)).stdout);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/); assert.equal(first.tokenSha256, sha256(first.token)); assert.notEqual(first.token, second.token);
  assert.deepEqual(JSON.parse((await run(templateArgs, env)).stdout), { version: 1, accounts: [account] });
  const checked = JSON.parse((await run(['check', '--accounts', accountPath], env)).stdout);
  assert.deepEqual(checked.accounts, [{ id: account.id, configuredSources: 1 }]);
  for (const secret of [credential, account.tokenSha256, account.root, account.sharedWikiConfig]) assert.equal(JSON.stringify(checked).includes(secret), false);
  assert.deepEqual(await readFile(accountPath), bytes); assert.deepEqual(await Promise.all([source, caller].map(integrity)), before); assert.equal(calls(), count);
});

test('cloud host: non-admin functions and every CLI action refuse before host resources are opened', async t => {
  const data = await fixture(t), readOnly: Principal = { ...data.operator, permissions: ['read'] };
  const original = MemoryVault.prototype.config; let opened = 0;
  t.mock.method(MemoryVault.prototype, 'config', async function(this: MemoryVault) { opened++; return original.call(this); });
  assert.throws(() => createCloudWikiCredential(readOnly), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(cloudWikiAccountTemplate(readOnly, data.account), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(inspectCloudWikiAccounts(readOnly, data.accountPath), { code: 'AUTHORIZATION_DENIED' }); assert.equal(opened, 0);
  for (const args of [['credentials'], ['check', '--accounts', '/nonexistent/host-file'], data.templateArgs,
    ['serve', '--accounts', '/nonexistent/host-file']]) {
    await assert.rejects(run(args, { ...data.env, AMEM_PERMISSIONS: 'read' }), (error: any) => {
      assert.match(error.stderr, /AUTHORIZATION_DENIED/); assert.equal(error.stdout, ''); return true;
    });
  }
});

test('cloud host: template respects existing grants and operator tenant/scope/sensitivity ceilings', async t => {
  const { operator, account, source, caller, binding, saveBindings, env, templateArgs } = await fixture(t);
  const { vaultId: _vault, tenantId: _tenant, ...input } = account, before = await Promise.all([source, caller].map(integrity));
  for (const principal of [{ ...operator, tenantId: 'foreign' }, { ...operator, scopes: ['public'] as ['public'] }, { ...operator, maxSensitivity: 'public' as const }]) {
    await assert.rejects(cloudWikiAccountTemplate(principal, input), { code: 'AUTHORIZATION_DENIED' });
  }
  await assert.rejects(run([...templateArgs.slice(0, -1), 'secret'], env), (error: any) => /AUTHORIZATION_DENIED/.test(error.stderr));
  binding.readers[0]!.id = 'another-reader'; await saveBindings();
  await assert.rejects(cloudWikiAccountTemplate(operator, input), { code: 'AUTHORIZATION_DENIED' });
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
});

test('cloud host: a derived broker identity must satisfy the complete service account schema', async t => {
  const { operator, account, env } = await fixture(t), original = MemoryVault.prototype.config;
  const { vaultId: _vault, tenantId: _tenant, ...input } = account;
  t.mock.method(MemoryVault.prototype, 'config', async function(this: MemoryVault) {
    const config = await original.call(this);
    return this.root === account.root ? { ...config, vaultId: 'x'.repeat(201) } : config;
  });
  await assert.rejects(cloudWikiAccountTemplate(operator, input, env), { code: 'CONFIG_INVALID' });
});

test('cloud host: check rejects wrong broker IDs and remote broker bindings; zero current source grants is reported honestly', async t => {
  const { operator, account, accountPath, saveAccounts, binding, saveBindings } = await fixture(t);
  account.vaultId = 'wrong-broker'; await saveAccounts();
  await assert.rejects(inspectCloudWikiAccounts(operator, accountPath), { code: 'CONFIG_INVALID' });
  account.vaultId = (await new MemoryVault(account.root).config()).vaultId; await saveAccounts();
  binding.readers[0]!.id = 'withdrawn'; await saveBindings();
  assert.deepEqual((await inspectCloudWikiAccounts(operator, accountPath)).accounts, [{ id: account.id, configuredSources: 0 }]);
  const { root: _root, masterKeyEnv: _key, ...base } = binding;
  await writeFile(account.sharedWikiConfig, JSON.stringify({ version: 2, sources: [{ ...base, transport: 'cloud', origin: 'https://must-not-be-probed.invalid',
    remoteSourceId: base.id, credentialEnv: 'UNSET_HOST_CREDENTIAL' }] }));
  await assert.rejects(inspectCloudWikiAccounts(operator, accountPath), { code: 'CONFIG_INVALID' });
});

test('cloud host: changed account file during an actual broker wait and changed operator authority invalidate complete checks', async t => {
  const { operator, account, accountPath, saveAccounts, caller } = await fixture(t), lock = join(caller.root, '.amem/write.lock');
  const acquired = deferred(), release = deferred(), owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const outcome = inspectCloudWikiAccounts(operator, accountPath).then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); await saveAccounts([]); release.resolve();
    assert.equal((await outcome)?.code, 'VALIDATION_FAILED');
  } finally { release.resolve(); await owner; }
  await saveAccounts([account]); const original = SharedWikiReader.prototype.catalog;
  t.mock.method(SharedWikiReader.prototype, 'catalog', async function(this: SharedWikiReader, options: Parameters<typeof original>[0]) {
    const result = await original.call(this, options); operator.permissions = ['read']; return result;
  });
  await assert.rejects(inspectCloudWikiAccounts(operator, accountPath), { code: 'AUTHORIZATION_DENIED' });
});

test('cloud host CLI: unknown/duplicate/bare flags, extra positions and unsafe listener options fail without file changes', async t => {
  const { env, accountPath, source, caller } = await fixture(t), before = await Promise.all([source, caller].map(integrity)), bytes = await readFile(accountPath);
  for (const args of [['credentials', 'extra'], ['credentials', '--unknown'], ['credentials', '--actor'], ['credentials', '--actor=a', '--actor=b'],
    ['check', '--accounts', accountPath, '--accounts', accountPath], ['serve', '--accounts'],
    ['serve', '--accounts', accountPath, '--host', '0.0.0.0'], ['serve', '--accounts', accountPath, '--port', 'NaN'],
    ['serve', '--accounts', accountPath, '--port', '65536'], ['serve', '--accounts', accountPath, '--max-concurrent', '0'],
    ['serve', '--accounts', accountPath, '--tls-certificate', '/missing/cert'], ['serve', '--accounts', accountPath, '--insecure']]) {
    await assert.rejects(run(args, env), (error: any) => { assert.equal(error.stdout, ''); return true; });
  }
  assert.deepEqual(await readFile(accountPath), bytes); assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) test(`cloud host CLI: actual foreground read and ${signal} drain the source waiter and close the listener`, async t => {
  const data = await fixture(t), { source, caller, accountPath, env, selection, calls, versions } = data;
  const before = await Promise.all([source, caller].map(integrity)), raw = await readFile(join(source.root, versions[0]!.evidencePath)), count = calls();
  const service = await startCli(accountPath, env), call = () => fetch(service.url + '/v1/shared-wiki/snapshot', {
    method: 'POST', headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
  const acquired = deferred(), release = deferred(); let owner: Promise<unknown> | undefined;
  try {
    const result = await call(); assert.equal(result.status, 200); const body = await result.json();
    assert.match(JSON.stringify(body), /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(JSON.stringify(body), /DATED_WIKI_CURRENT_CANARY|\.scratch/);
    const lock = join(source.root, '.amem/write.lock'); owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; }); await acquired.promise;
    const pending = call().then(async response => ({ status: response.status, body: await response.text() })).catch(error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); service.command.child.kill(signal);
    const stoppedResult = await pending;
    if (!(stoppedResult instanceof Error)) { assert.notEqual(stoppedResult.status, 200); assert.doesNotMatch(stoppedResult.body, /DATED_WIKI_/); }
    await service.done; await waitFor(async () => (await readdir(lock + '.queue')).length === 1);
    await assert.rejects(fetch(service.url + '/healthz'));
  } finally { service.command.child.kill('SIGTERM'); await service.done.catch(() => {}); release.resolve(); await owner; }
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before); assert.deepEqual(await readFile(join(source.root, versions[0]!.evidencePath)), raw); assert.equal(calls(), count);
});

test('cloud host CLI: an account file widened after startup cannot exceed the operator ceiling or open a different broker', async t => {
  const { accountPath, env, account, saveAccounts, selection } = await fixture(t), service = await startCli(accountPath, env);
  const call = () => fetch(service.url + '/v1/shared-wiki/snapshot', { method: 'POST', headers: {
    Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
  const saved = { ...account };
  try {
    for (const extra of [{ maxSensitivity: 'secret' }, { scopes: ['team'] }, { tenantId: 'foreign' }]) {
      await saveAccounts([{ ...account, ...extra, root: '/PRIVATE_BROKER_MUST_NOT_BE_OPENED' }]);
      const response = await call(); assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /PRIVATE_BROKER|DATED_WIKI_|\.scratch/);
    }
    await saveAccounts([saved]); assert.equal((await call()).status, 200);
  } finally { service.command.child.kill('SIGTERM'); await service.done.catch(() => {}); }
});

test('cloud host CLI: cancellation during actual startup inspection leaves no advertised service or broker waiter', async t => {
  const { caller, accountPath, env } = await fixture(t), lock = join(caller.root, '.amem/write.lock'), before = await integrity(caller);
  const acquired = deferred(), release = deferred(), owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  let command: ReturnType<typeof run> | undefined, outcome: Promise<any> | undefined;
  try {
    await acquired.promise; command = run(['serve', '--accounts', accountPath], env); outcome = command.then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); command.child.kill('SIGTERM');
    const failure = await outcome; assert.ok(failure); assert.equal(failure.stdout, ''); assert.match(failure.stderr, /OPERATION_CANCELLED/);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 1);
  } finally { command?.child.kill('SIGTERM'); release.resolve(); await owner; await outcome; }
  assert.deepEqual(await integrity(caller), before);
});

test('cloud host CLI: native loopback TLS is verifiable and host rate limits are forwarded', async t => {
  const { accountPath, env, caller } = await fixture(t), certificate = join(caller.root, '.amem/host-cert.pem'), key = join(caller.root, '.amem/host-key.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { timeout: 10000 });
  const service = await startCli(accountPath, env, ['--tls-certificate', certificate, '--tls-key', key, '--requests-per-minute', '1']);
  try {
    assert.match(service.url, /^https:/);
    const get = () => new Promise<number>((resolve, reject) => {
      const request = httpsRequest(service.url + '/healthz', { ca: '' }, response => { response.resume(); response.once('end', () => resolve(response.statusCode!)); });
      request.on('error', reject); request.end();
    });
    // Default trust refuses our synthetic certificate; trust is explicit for this fixture only.
    await assert.rejects(get());
    const ca = await readFile(certificate), trusted = () => new Promise<number>((resolve, reject) => {
      const request = httpsRequest(service.url + '/healthz', { ca }, response => { response.resume(); response.once('end', () => resolve(response.statusCode!)); }); request.on('error', reject); request.end();
    });
    assert.equal(await trusted(), 200); assert.equal(await trusted(), 429);
  } finally { service.command.child.kill('SIGTERM'); await service.done.catch(() => {}); }
});

test('cloud service: provided operator policy is validated before files and cloned as a fixed lifetime ceiling', async t => {
  const { operator, account, accountPath, saveAccounts, env, selection } = await fixture(t);
  await assert.rejects(startCloudWikiServer({ configPath: '/missing-account-file', operator: { ...operator, permissions: ['read'] } }), { code: 'AUTHORIZATION_DENIED' });
  const service = await startCloudWikiServer({ configPath: accountPath, operator, env });
  try {
    operator.maxSensitivity = 'secret'; operator.scopes.push('team');
    await saveAccounts([{ ...account, maxSensitivity: 'secret' }]);
    const response = await fetch(service.url + '/v1/shared-wiki/snapshot', { method: 'POST', headers: {
      Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
    assert.equal(response.status, 403);
    await saveAccounts([account]);
    const injected = await fetch(service.url + '/v1/shared-wiki/snapshot', { method: 'POST', headers: {
      Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...selection, operator }) });
    assert.equal(injected.status, 400);
  } finally { await service.stop(); }
});

async function startCli(accountPath: string, env: Record<string, string>, extra: string[] = []) {
  const command = run(['serve', '--accounts', accountPath, ...extra], env), done = command.then(result => result, error => { throw error; });
  // Attach a handler immediately while waiting for the startup JSON.
  let failure: unknown, exited = false; void done.then(() => { exited = true; }, error => { failure = error; exited = true; }); let output = '';
  command.child.stdout?.on('data', value => { output += String(value); });
  try {
    const deadline = performance.now() + 15000;
    for (;;) {
      if (failure) throw failure;
      let ready = false; try { ready = JSON.parse(output).status === 'cloud-serving'; } catch {}
      if (ready) break;
      if (exited || performance.now() >= deadline) throw new Error('Cloud CLI did not advertise a ready service');
      await delay(10);
    }
    const startup = JSON.parse(output); assert.deepEqual(Object.keys(startup).sort(), ['status', 'url']);
    return { url: startup.url as string, command, done };
  } catch (error) { command.child.kill('SIGTERM'); await done.catch(() => {}); throw error; }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(check: () => Promise<boolean>) { const end = performance.now() + 15000; while (performance.now() < end) { if (await check().catch(() => false)) return; await delay(10); } throw new Error('Expected actual cloud host state'); }
