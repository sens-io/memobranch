import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { MemoryVault, LlmClient } from 'memobranch';

const exec = promisify(execFile), cli = join(dirname(createRequire(import.meta.url).resolve('memobranch')), 'cli.js');
await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-cloud-host-'));
let command, finished;
try {
  let calls = 0; const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
  llm.wiki = async (operation, input) => {
    calls++; if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    return { pages: input.sources.map(source => ({ key: 'source:' + source.id, pageType: 'source', title: 'Installed host source',
      summary: 'Synthetic operator fixture', body: source.body, evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] })) };
  };
  const source = new MemoryVault(join(temporary, 'source'), { llm }), broker = new MemoryVault(join(temporary, 'broker'));
  await source.initialize('Installed host source'); await broker.initialize('Installed host broker');
  const raw = await source.capture({ content: 'INSTALLED_HOST_RAW_CANARY', scope: 'project', sensitivity: 'internal', extract: false });
  await source.wikiIngest({ evidenceIds: [raw.evidenceId], apply: true });
  const sourceConfig = await source.config(), brokerConfig = await broker.config(), pin = await source.git.run(['rev-parse', 'HEAD']);
  const sourceFile = join(broker.root, '.amem/shared-wiki.json'), accountFile = join(broker.root, '.amem/cloud-accounts.json');
  const accountId = 'installed-host-reader';
  const binding = { id: 'installed-source', title: 'Installed source', root: source.root, commit: pin,
    vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId, readers: [{ id: accountId, tenantId: brokerConfig.tenantId }],
    scopes: ['project'], maxSensitivity: 'internal' };
  await writeFile(sourceFile, JSON.stringify({ version: 1, sources: [binding] }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_ACTOR_ID: 'installed-operator', AMEM_PERMISSIONS: 'admin', AMEM_ALLOWED_SCOPES: 'project',
    AMEM_MAX_SENSITIVITY: 'internal', AMEM_TENANT_ID: brokerConfig.tenantId });
  const run = args => exec(process.execPath, [cli, 'cloud', ...args], { env, timeout: 30000, killSignal: 'SIGKILL' });
  const state = async () => ({ heads: await Promise.all([source, broker].map(vault => vault.git.run(['rev-parse', 'HEAD']))),
    refs: await Promise.all([source, broker].map(vault => vault.git.run(['show-ref']))),
    indexes: await Promise.all([source, broker].map(vault => readFile(join(vault.git.gitDir, 'index')))), raw: await readFile(join(source.root, raw.evidencePath)), calls });
  const before = await state(), credentials = JSON.parse((await run(['credentials'])).stdout);
  assert.match(credentials.token, /^[A-Za-z0-9_-]{43}$/);
  const template = JSON.parse((await run(['account-template', '--id', accountId, '--broker-root', broker.root,
    '--sources-config', sourceFile, '--token-sha256', credentials.tokenSha256])).stdout);
  assert.equal(template.accounts[0].vaultId, brokerConfig.vaultId); assert.equal(template.accounts[0].tenantId, brokerConfig.tenantId);
  assert.equal(JSON.stringify(template).includes(credentials.token), false); assert.deepEqual(await state(), before);
  // The fixture explicitly persists this synthetic account; the CLI did not create a grant/file.
  await writeFile(accountFile, JSON.stringify(template), { mode: 0o600 }); const accountBytes = await readFile(accountFile);
  const check = JSON.parse((await run(['check', '--accounts', accountFile])).stdout);
  assert.deepEqual(check.accounts, [{ id: accountId, configuredSources: 1 }]);
  for (const hidden of [credentials.token, credentials.tokenSha256, source.root, broker.root]) assert.equal(JSON.stringify(check).includes(hidden), false);
  await assert.rejects(exec(process.execPath, [cli, 'cloud', 'credentials'], { env: { ...env, AMEM_PERMISSIONS: 'read' } }));
  command = run(['serve', '--accounts', accountFile]); finished = command.then(result => result, error => { throw error; });
  let failure, output = ''; void finished.catch(error => { failure = error; }); command.child.stdout.on('data', chunk => { output += String(chunk); });
  const deadline = performance.now() + 15000;
  for (;;) {
    if (failure) throw failure;
    let ready = false; try { ready = JSON.parse(output).status === 'cloud-serving'; } catch {}
    if (ready) break; if (performance.now() >= deadline) throw new Error('Installed cloud CLI did not become ready'); await delay(10);
  }
  const service = JSON.parse(output); assert.deepEqual(Object.keys(service).sort(), ['status', 'url']);
  assert.equal((await fetch(service.url + '/healthz')).status, 200);
  const read = () => fetch(service.url + '/v1/shared-wiki/snapshot', { method: 'POST', headers: {
    Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: binding.id,
    expectedCommit: pin, pageKeys: ['source:' + raw.evidenceId], attenuation: { scopes: ['project'], maxSensitivity: 'internal' } }) });
  const response = await read(); assert.equal(response.status, 200); assert.match(JSON.stringify(await response.json()), /INSTALLED_HOST_RAW_CANARY/);
  await writeFile(accountFile, JSON.stringify({ version: 1, accounts: [{ ...template.accounts[0], maxSensitivity: 'secret', root: '/UNOPENED_INSTALLED_BROKER' }] }));
  const wider = await read(); assert.equal(wider.status, 403); assert.doesNotMatch(await wider.text(), /UNOPENED_INSTALLED_BROKER|INSTALLED_HOST_RAW_CANARY/);
  await writeFile(accountFile, accountBytes); command.child.kill('SIGTERM'); await finished;
  await assert.rejects(fetch(service.url + '/healthz')); assert.deepEqual(await state(), before); assert.deepEqual(await readFile(accountFile), accountBytes);
  console.log('Installed cloud host CLI: admin-only inactive credentials/template/check, derived broker IDs, explicit fixture account, foreground HTTP read, fixed operator ceiling, graceful shutdown and unchanged two-vault state/raw sample/model count passed.');
} finally { command?.child.kill('SIGTERM'); await finished?.catch(() => {}); await rm(temporary, { recursive: true, force: true }); }
