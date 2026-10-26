import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { LlmClient, MemoryVault, SharedWikiReader, SharedWikiImporter } from 'memobranch';

const exec = promisify(execFile);
await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-git-shared-wiki-'));
try {
  let version = 1, calls = 0;
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
  llm.wiki = async (operation, input) => {
    calls++;
    if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const sources = input.sources.map(source => ({ key: 'source:' + source.id, pageType: 'source', title: 'Installed Git source',
      summary: 'Synthetic Git source', body: source.body, evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] }));
    return { pages: [...sources, { ...sources[0], key: 'concept:installed-git', pageType: 'concept', title: 'Installed Git page',
      body: 'Installed Git version ' + version, evidenceIds: input.sources.map(source => source.id), links: sources.map(page => page.key) }] };
  };
  const source = new MemoryVault(join(temporary, 'source'), { llm }), client = new MemoryVault(join(temporary, 'client'));
  await source.initialize('Installed Git source'); await client.initialize('Installed Git client');
  const sourceConfig = await source.config(), clientConfig = await client.config();
  const first = await source.capture({ content: 'Installed Git immutable first source', extract: false });
  const local = await client.capture({ content: 'Installed Git immutable client fixture', extract: false });
  await source.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const pin = await source.git.run(['rev-parse', 'HEAD']); version = 2;
  const second = await source.capture({ content: 'Installed Git current source', extract: false });
  await source.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const current = await source.git.run(['rev-parse', 'HEAD']);
  const remote = join(temporary, 'synthetic-remote.git');
  await exec('git', ['init', '--bare', '--template=', remote], { env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } });
  // Publication is only to this disposable local fixture, never a real remote.
  const publish = () => source.git.run(['push', '--force', remote, 'HEAD:refs/heads/published']); await publish();
  const configPath = join(client.root, '.amem/shared-wiki.json');
  const binding = { transport: 'git', id: 'installed-git', title: 'Installed Git Wiki', remote, branch: 'published', allowLocalFile: true,
    commit: pin, vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId,
    readers: [{ id: client.principal.id, tenantId: clientConfig.tenantId }], scopes: ['user'], maxSensitivity: 'internal' };
  await writeFile(configPath, JSON.stringify({ version: 2, sources: [binding] }));
  const options = { configPath, env: {} }, reader = new SharedWikiReader(client, options), importer = new SharedWikiImporter(client, options);
  const selection = { sourceId: binding.id, expectedCommit: pin, pageKeys: ['concept:installed-git'] };
  const state = async () => ({ heads: await Promise.all([source, client].map(vault => vault.git.run(['rev-parse', 'HEAD']))),
    refs: await Promise.all([source, client].map(vault => vault.git.run(['show-ref']))),
    indexes: await Promise.all([source, client].map(vault => readFile(join(vault.git.gitDir, 'index')))),
    raw: await Promise.all([readFile(join(source.root, first.evidencePath)), readFile(join(client.root, local.evidencePath))]), calls });
  const before = await state(); assert.equal((await reader.catalog()).sources[0].commit, pin);
  assert.equal(existsSync(join(client.root, '.amem/shared-cache/installed-git')), false);
  await assert.rejects(reader.snapshot({ sourceId: binding.id, pageKeys: selection.pageKeys }), { code: 'VALIDATION_FAILED' });
  const view = await reader.snapshot(selection); assert.equal(view.snapshot.authorityHead, current); assert.equal(view.source.commit, pin);
  assert.equal(view.source.vaultId, sourceConfig.vaultId); assert.equal(view.source.tenantId, sourceConfig.tenantId);
  assert.match(JSON.stringify(view), /Installed Git version 1/); assert.doesNotMatch(JSON.stringify(view), /Installed Git version 2|\.scratch|remoteHash/);
  assert.deepEqual(await readFile(join(client.root, '.amem/shared-cache/installed-git/vault', first.evidencePath)), before.raw[0]);
  await rename(remote, remote + '.offline'); await assert.rejects(reader.snapshot(selection), { code: 'REMOTE_TRANSPORT' }); await rename(remote + '.offline', remote);
  const { plan } = await importer.prepare(selection); assert.deepEqual(await state(), before);
  await assert.rejects(importer.apply(plan, { confirm: false }), { code: 'VALIDATION_FAILED' });
  const copied = await importer.apply(plan, { confirm: true }); assert.ok(copied.commit); assert.deepEqual(await client.wikiCatalog(), []);
  const copiedState = await state(); assert.equal(copiedState.heads[0], before.heads[0]); assert.equal(copiedState.refs[0], before.refs[0]);
  assert.deepEqual(copiedState.indexes[0], before.indexes[0]); assert.deepEqual(copiedState.raw, before.raw); assert.equal(copiedState.calls, before.calls);
  const retry = await importer.apply(plan, { confirm: true }); assert.equal(retry.duplicate, true); assert.equal(retry.commit, null); assert.deepEqual(await state(), copiedState);
  await source.wikiRevoke('concept:installed-git', 'Installed Git withdrawal'); await publish();
  await assert.rejects(reader.snapshot(selection), { code: 'NOT_FOUND' });
  const clientHead = await client.git.run(['rev-parse', 'HEAD']); await assert.rejects(importer.apply(plan, { confirm: true }), { code: 'NOT_FOUND' });
  assert.equal(await client.git.run(['rev-parse', 'HEAD']), clientHead);
  console.log('Installed Git sharing: public exports, real local bare remote, fixed old pin/current authority, exact bytes, unchanged two-vault reads/prepare, offline refusal, separate copy/no Wiki write/exact retry and current withdrawal passed (two named raw fixtures).');
} finally { await rm(temporary, { recursive: true, force: true }); }
