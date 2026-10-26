import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LlmClient, MemoryVault, SharedWikiReader, SharedWikiImporter, startCloudWikiServer } from 'memobranch';

await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-cloud-shared-wiki-'));
let service;
try {
  let version = 1, calls = 0;
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
  llm.wiki = async (operation, input) => {
    calls++;
    if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const sources = input.sources.map(source => ({ key: 'source:' + source.id, pageType: 'source', title: 'Installed source',
      summary: 'Synthetic source', body: source.body, evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] }));
    return { pages: [...sources, { ...sources[0], key: 'concept:installed-cloud', pageType: 'concept', title: 'Installed cloud page',
      body: 'Installed cloud version ' + version, evidenceIds: input.sources.map(source => source.id), links: sources.map(page => page.key) }] };
  };
  const source = new MemoryVault(join(temporary, 'source'), { llm }), broker = new MemoryVault(join(temporary, 'broker'));
  const client = new MemoryVault(join(temporary, 'client'));
  await source.initialize('Installed cloud source'); await broker.initialize('Installed cloud broker');
  await client.initialize('Installed cloud client'); const clientConfig = await client.config();
  const first = await source.capture({ content: 'Installed cloud immutable first source', extract: false });
  const brokerEvidence = await broker.capture({ content: 'Installed broker immutable fixture', extract: false });
  const clientEvidence = await client.capture({ content: 'Installed client immutable fixture', extract: false });
  await source.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const pin = await source.git.run(['rev-parse', 'HEAD']), sourceConfig = await source.config(), brokerConfig = await broker.config();
  version = 2;
  const second = await source.capture({ content: 'Installed cloud current source', extract: false });
  await source.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const currentHead = await source.git.run(['rev-parse', 'HEAD']);
  const current = await source.wikiSnapshot({ commit: currentHead, pageKeys: ['concept:installed-cloud'] });
  assert.match(current.pages.find(page => page.meta.key === 'concept:installed-cloud').body, /version 2/);
  const sourceBindings = join(broker.root, '.amem/shared-wiki.json'), configPath = join(broker.root, '.amem/cloud-accounts.json');
  const credential = randomBytes(32).toString('base64url');
  const account = { id: broker.principal.id, tokenSha256: createHash('sha256').update(credential).digest('hex'), root: broker.root,
    vaultId: brokerConfig.vaultId, tenantId: brokerConfig.tenantId, sharedWikiConfig: sourceBindings, scopes: ['user'], maxSensitivity: 'internal' };
  const binding = { id: 'installed-cloud-source', title: 'Installed cloud source', root: source.root, commit: pin,
    vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId, readers: [{ id: account.id, tenantId: brokerConfig.tenantId }],
    scopes: ['user'], maxSensitivity: 'internal' };
  await writeFile(sourceBindings, JSON.stringify({ version: 1, sources: [binding] }));
  const saveAccounts = accounts => writeFile(configPath, JSON.stringify({ version: 1, accounts }));
  await saveAccounts([account]);
  const state = async () => ({
    heads: await Promise.all([source, broker, client].map(vault => vault.git.run(['rev-parse', 'HEAD']))),
    refs: await Promise.all([source, broker, client].map(vault => vault.git.run(['show-ref']))),
    indexes: await Promise.all([source, broker, client].map(vault => readFile(join(vault.git.gitDir, 'index')))),
    raw: await Promise.all([readFile(join(source.root, first.evidencePath)), readFile(join(broker.root, brokerEvidence.evidencePath)), readFile(join(client.root, clientEvidence.evidencePath))]),
    calls,
  });
  const before = await state();
  service = await startCloudWikiServer({ configPath });
  const clientConfigPath = join(client.root, '.amem/shared-wiki.json');
  const clientBinding = { transport: 'cloud', id: 'installed-cloud-client', title: 'Installed remote Wiki', origin: service.url, allowLoopbackHttp: true,
    remoteSourceId: binding.id, commit: pin, vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId,
    readers: [{ id: client.principal.id, tenantId: clientConfig.tenantId }], scopes: ['user'], maxSensitivity: 'internal', credentialEnv: 'INSTALLED_CLOUD_TOKEN' };
  await writeFile(clientConfigPath, JSON.stringify({ version: 2, sources: [clientBinding] }));
  const clientOptions = { configPath: clientConfigPath, env: { INSTALLED_CLOUD_TOKEN: credential } };
  const reader = new SharedWikiReader(client, clientOptions), importer = new SharedWikiImporter(client, clientOptions);
  const clientSelection = { sourceId: clientBinding.id, expectedCommit: pin, pageKeys: ['concept:installed-cloud'] };
  assert.equal((await reader.catalog()).sources[0].id, clientBinding.id);
  const clientView = await reader.snapshot(clientSelection);
  assert.equal(clientView.source.vaultId, sourceConfig.vaultId); assert.equal(clientView.source.commit, pin);
  assert.match(JSON.stringify(clientView), /version 1/); assert.doesNotMatch(JSON.stringify(clientView), /version 2|INSTALLED_CLOUD_TOKEN/);
  assert.equal(JSON.stringify(clientView).includes(credential), false);
  const attenuation = { scopes: ['user'], maxSensitivity: 'internal' }, selection = {
    sourceId: binding.id, pageKeys: ['concept:installed-cloud'], expectedCommit: pin, attenuation,
  };
  const call = async (route, body, credentialValue = credential) => {
    const response = await fetch(service.url + '/v1/shared-wiki/' + route, { method: 'POST',
      headers: { Authorization: 'Bearer ' + credentialValue, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('snapshot', selection, 'invalid')).status, 401);
  assert.equal((await call('catalog', { attenuation })).body.sources[0].commit, pin);
  const result = await call('snapshot', selection); assert.equal(result.status, 200);
  assert.equal(result.body.view.source.vaultId, sourceConfig.vaultId); assert.equal(result.body.view.source.tenantId, sourceConfig.tenantId);
  assert.equal(result.body.view.snapshot.commit, pin); assert.ok(result.body.validForMs > 0 && result.body.validForMs <= 30000);
  assert.match(JSON.stringify(result.body), /version 1/); assert.doesNotMatch(JSON.stringify(result.body), /version 2/);
  assert.equal(result.body.support.sensitivity, 'internal'); assert.equal(result.body.view.snapshot.sources[0].id, first.evidenceId);
  for (const secret of [credential, account.tokenSha256, broker.root, source.root]) assert.equal(JSON.stringify(result.body).includes(secret), false);
  assert.equal((await call('snapshot', { ...selection, root: source.root })).status, 400);
  assert.equal((await call('snapshot', { ...selection, expectedCommit: currentHead })).status, 400);
  assert.equal((await call('snapshot', { ...selection, attenuation: { scopes: ['public'], maxSensitivity: 'internal' } })).status, 403);
  await saveAccounts([]); assert.equal((await call('snapshot', selection)).status, 401);
  await assert.rejects(reader.snapshot(clientSelection), { code: 'AUTHORIZATION_DENIED' }); await saveAccounts([account]);
  assert.deepEqual(await state(), before);
  const { plan } = await importer.prepare(clientSelection); assert.deepEqual(await state(), before);
  const copied = await importer.apply(plan, { confirm: true }); assert.ok(copied.commit);
  assert.match((await client.get(copied.evidenceId)).body, /compiled-wiki-source-artifact/); assert.deepEqual(await client.wikiCatalog(), []);
  const copiedState = await state(); assert.deepEqual(copiedState.heads.slice(0, 2), before.heads.slice(0, 2));
  assert.deepEqual(copiedState.refs.slice(0, 2), before.refs.slice(0, 2)); assert.deepEqual(copiedState.indexes.slice(0, 2), before.indexes.slice(0, 2));
  assert.deepEqual(copiedState.raw, before.raw); assert.equal(copiedState.calls, before.calls);
  const duplicate = await importer.apply(plan, { confirm: true }); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.commit, null);
  assert.deepEqual(await state(), copiedState);
  await source.wikiRevoke('concept:installed-cloud', 'Installed cloud withdrawal');
  const withdrawn = await call('snapshot', selection); assert.equal(withdrawn.status, 404); assert.doesNotMatch(JSON.stringify(withdrawn.body), /version 1/);
  const clientHead = await client.git.run(['rev-parse', 'HEAD']); await assert.rejects(importer.apply(plan, { confirm: true }), { code: 'NOT_FOUND' });
  assert.equal(await client.git.run(['rev-parse', 'HEAD']), clientHead);
  const url = service.url; const stopping = service.stop(); assert.equal(service.stop(), stopping); await stopping;
  await assert.rejects(fetch(url + '/healthz'));
  console.log('Installed self-hosted service and cloud client: public exports, real HTTP, v2 binding/old pin/origin, attenuation, current account/source revocation, unchanged three-vault reads, separate derived copy/no Wiki write/exact retry and shutdown passed (three named raw fixtures).');
} finally { await service?.stop(); await rm(temporary, { recursive: true, force: true }); }
