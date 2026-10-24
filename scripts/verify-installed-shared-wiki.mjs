import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LlmClient, MemoryVault, SharedWikiReader } from 'memobranch';

await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-shared-wiki-'));
try {
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let version = 1, calls = 0;
  llm.wiki = async (operation, input) => {
    calls++; if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const pages = input.sources.map(source => ({ key: 'source:' + source.id, pageType: 'source', title: 'Source', summary: 'Fixture', body: source.body,
      evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] }));
    return { pages: [...pages, { ...pages[0], key: 'concept:installed-shared', pageType: 'concept', title: 'Shared knowledge', body: 'Shared version ' + version,
      links: pages.map(page => page.key), evidenceIds: input.sources.map(source => source.id) }] };
  };
  const source = new MemoryVault(join(temporary, 'source'), { llm }), caller = new MemoryVault(join(temporary, 'caller'));
  await source.initialize('Installed shared source'); await caller.initialize('Installed shared caller');
  const key = 'concept:installed-shared', first = await source.capture({ content: 'Installed shared source one', extract: false });
  await source.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const pin = await source.git.run(['rev-parse', 'HEAD']), sourceConfig = await source.config(), callerConfig = await caller.config();
  const configPath = join(caller.root, '.amem/shared-wiki.json');
  const binding = { id: 'installed-team', title: 'Installed fixture', root: source.root, commit: pin, vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId,
    readers: [{ id: caller.principal.id, tenantId: callerConfig.tenantId }], scopes: ['user'], maxSensitivity: 'internal' };
  await writeFile(configPath, JSON.stringify({ version: 1, sources: [binding] }));
  version = 2; const second = await source.capture({ content: 'Installed shared source two', extract: false });
  await source.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const current = await source.wikiSnapshot({ commit: await source.git.run(['rev-parse', 'HEAD']), pageKeys: [key] });
  assert.match(current.pages.find(page => page.meta.key === key).body, /version 2/);
  const sourceHead = await source.git.run(['rev-parse', 'HEAD']), callerHead = await caller.git.run(['rev-parse', 'HEAD']), count = calls;
  const raw = await readFile(join(source.root, first.evidencePath)), sourceIndex = await readFile(join(source.git.gitDir, 'index'));
  const reader = new SharedWikiReader(caller, { configPath }), input = { sourceId: binding.id, pageKeys: [key] };
  assert.equal((await reader.catalog()).sources[0].commit, pin);
  const view = await reader.snapshot(input); assert.equal(view.source.vaultId, sourceConfig.vaultId); assert.equal(view.snapshot.commit, pin);
  assert.match(view.snapshot.pages.find(page => page.meta.key === key).body, /version 1/); assert.doesNotMatch(JSON.stringify(view), /version 2/);
  await assert.rejects(reader.snapshot({ ...input, root: source.root }), { code: 'VALIDATION_FAILED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reader.snapshot({ ...input, signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  assert.equal(await source.git.run(['rev-parse', 'HEAD']), sourceHead); assert.equal(await caller.git.run(['rev-parse', 'HEAD']), callerHead);
  assert.deepEqual(await readFile(join(source.root, first.evidencePath)), raw); assert.deepEqual(await readFile(join(source.git.gitDir, 'index')), sourceIndex); assert.equal(calls, count);
  binding.readers = [{ id: 'other', tenantId: callerConfig.tenantId }]; await writeFile(configPath, JSON.stringify({ version: 1, sources: [binding] }));
  assert.deepEqual((await reader.catalog()).sources, []); await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
  binding.readers[0].id = caller.principal.id; await writeFile(configPath, JSON.stringify({ version: 1, sources: [binding] }));
  await source.wikiRevoke(key, 'Withdraw installed shared fixture'); await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
  console.log('Installed shared Wiki core: two real vaults, fixed old commit after source advance, explicit reader grants, origin, current withdrawal, cancellation, unchanged source/index/heads and no model calls passed.');
} finally { await rm(temporary, { recursive: true, force: true }); }
