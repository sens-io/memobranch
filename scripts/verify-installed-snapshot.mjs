// Product code resolves only from the installed consumer, never src/ or tsx.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LlmClient, MemoryVault } from 'memobranch';

const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
let calls = 0;
llm.wiki = async (operation, input) => {
  calls++;
  if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
  const draft = (key, pageType, body) => ({ key, pageType, title: 'Installed revision page', summary: 'Synthetic source summary.',
    body, evidenceIds: input.sources.map(source => source.id), links: [], status: 'active', conditions: ['Synthetic source only.'], uncertainty: ['No quality claim.'] });
  return { pages: [...input.sources.map(source => draft(`source:${source.id}`, 'source', source.body)),
    draft('entity:installed-snapshot', 'entity', input.sources.map(source => source.body).join('\n'))] };
};
const key = '72'.repeat(32), vault = new MemoryVault(join(process.cwd(), 'snapshot-vault'), { llm, masterKey: key });
await vault.initialize('Installed revision views');
const first = await vault.capture({ content: 'Installed original snapshot words.', extract: false });
await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
const commit = await vault.git.run(['rev-parse', 'HEAD']), pageKey = 'entity:installed-snapshot';
const pageId = (await vault.wikiCatalog()).find(page => page.key === pageKey).id;
const original = await vault.get(pageId);
const second = await vault.capture({ content: 'Installed additional knowledge.', extract: false });
await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
const current = await vault.get(pageId);
assert.match(current.body, /Installed additional knowledge/);
assert.notEqual(current.body, original.body);
const head = await vault.git.run(['rev-parse', 'HEAD']), index = await readFile(join(vault.git.gitDir, 'index')), count = calls;
const result = await vault.wikiSnapshot({ commit, pageKeys: [pageKey] });
assert.equal(result.commit, commit); assert.equal(result.authorityHead, head); assert.equal(result.pages.length, 1);
assert.match(result.pages[0].body, /Installed original snapshot words/); assert.equal(result.pages[0].meta.revision, 1);
assert.equal(result.pages[0].currentRevision, 2);
assert.equal(result.pages[0].body, original.body);
assert.doesNotMatch(result.pages[0].body, /Installed additional knowledge/);
assert.deepEqual(result.rules, [{ id: 'builtin-wiki-rules-v1', revision: 1 }]);
assert.equal(result.sources[0].id, first.evidenceId); assert.doesNotMatch(JSON.stringify(result.sources), /Installed original|pdfOriginal/);
assert.equal(calls, count); assert.deepEqual(await readFile(join(vault.git.gitDir, 'index')), index);
assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
await assert.rejects(vault.wikiSnapshot({ commit: 'HEAD', pageKeys: [pageKey] }), { code: 'VALIDATION_FAILED' });
const controller = new AbortController(); controller.abort();
await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: [pageKey], signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
const exec = promisify(execFile), cli = join(process.cwd(), 'node_modules/memobranch/dist/cli.js');
const response = await exec(process.execPath, [cli, 'wiki', 'snapshot', pageKey, '--commit', commit, '--root', vault.root]);
const cliResult = JSON.parse(response.stdout);
assert.equal(cliResult.commit, commit); assert.equal(cliResult.pages[0].body, original.body);
assert.equal(cliResult.pages[0].currentRevision, 2); assert.doesNotMatch(cliResult.pages[0].body, /Installed additional knowledge/);
await vault.wikiRevoke(pageKey, 'Synthetic withdrawal');
await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: [pageKey] }), { code: 'NOT_FOUND' });

const privateVault = new MemoryVault(join(process.cwd(), 'snapshot-secret-vault'), { llm, masterKey: key });
await privateVault.initialize('Installed private revision');
const secret = await privateVault.capture({ content: 'Installed secret source.', sensitivity: 'secret', extract: false });
await privateVault.wikiIngest({ evidenceIds: [secret.evidenceId], apply: true });
const privateCommit = await privateVault.git.run(['rev-parse', 'HEAD']), privateKey = `source:${secret.evidenceId}`;
await assert.rejects(privateVault.wikiSnapshot({ commit: privateCommit, pageKeys: [privateKey] }), { code: 'NOT_FOUND' });
assert.equal((await privateVault.wikiSnapshot({ commit: privateCommit, pageKeys: [privateKey], includeSecret: true })).pages.length, 1);
await privateVault.encryption.erase(secret.evidenceId);
await assert.rejects(privateVault.wikiSnapshot({ commit: privateCommit, pageKeys: [privateKey], includeSecret: true }));
console.log('Installed package: pinned Wiki object reads, provenance, unchanged index/ref, current revocation, secret opt-in/key loss, cancellation, types and real CLI passed (local view, not shared access or historical truth).');
