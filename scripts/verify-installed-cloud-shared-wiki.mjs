import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LlmClient, MemoryVault, startCloudWikiServer } from 'memobranch';

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
  await source.initialize('Installed cloud source'); await broker.initialize('Installed cloud broker');
  const first = await source.capture({ content: 'Installed cloud immutable first source', extract: false });
  const brokerEvidence = await broker.capture({ content: 'Installed broker immutable fixture', extract: false });
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
    heads: await Promise.all([source, broker].map(vault => vault.git.run(['rev-parse', 'HEAD']))),
    refs: await Promise.all([source, broker].map(vault => vault.git.run(['show-ref']))),
    indexes: await Promise.all([source, broker].map(vault => readFile(join(vault.git.gitDir, 'index')))),
    raw: await Promise.all([readFile(join(source.root, first.evidencePath)), readFile(join(broker.root, brokerEvidence.evidencePath))]),
    calls,
  });
  const before = await state();
  service = await startCloudWikiServer({ configPath });
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
  await saveAccounts([]); assert.equal((await call('snapshot', selection)).status, 401); await saveAccounts([account]);
  assert.deepEqual(await state(), before);
  await source.wikiRevoke('concept:installed-cloud', 'Installed cloud withdrawal');
  const withdrawn = await call('snapshot', selection); assert.equal(withdrawn.status, 404); assert.doesNotMatch(JSON.stringify(withdrawn.body), /version 1/);
  const url = service.url; const stopping = service.stop(); assert.equal(service.stop(), stopping); await stopping;
  await assert.rejects(fetch(url + '/healthz'));
  console.log('Installed self-hosted Wiki service: public library export, real HTTP, old pin/origin, attenuation, revoked account/source, safe errors, both heads/refs/indexes/raw fixtures unchanged and shutdown passed.');
} finally { await service?.stop(); await rm(temporary, { recursive: true, force: true }); }
