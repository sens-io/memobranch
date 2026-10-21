// Every product import resolves from the installed consumer, never src/ or tsx.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LlmClient, MemoryVault } from 'memobranch';

const exec = promisify(execFile), cli = join(process.cwd(), 'node_modules/memobranch/dist/cli.js'), key = '82'.repeat(32);
async function fixture(name, sensitivity = 'internal') {
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let calls = 0;
  llm.wiki = async (operation, input) => {
    calls++;
    if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const draft = (key, pageType, body) => ({ key, pageType, title: key, summary: 'Synthetic installed merge.', body,
      evidenceIds: input.sources.map(source => source.id), links: [], status: 'active', conditions: ['Synthetic condition.'], uncertainty: ['Not verified advice.'] });
    return { pages: [...input.sources.map(source => draft(`source:${source.id}`, 'source', source.body)),
      draft('entity:installed-merge', 'entity', input.sources.map(source => source.body).join('\n'))] };
  };
  const vault = new MemoryVault(join(process.cwd(), name), { llm, masterKey: key }); await vault.initialize(name);
  const first = await vault.capture({ content: 'Installed historical merge source.', scope: 'project', sensitivity, extract: false });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const fromCommit = await vault.git.run(['rev-parse', 'HEAD']);
  const second = await vault.capture({ content: 'Installed current merge source.', scope: 'project', sensitivity, extract: false });
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  return { vault, first, second, calls: () => calls, input: { fromCommit, pageKey: 'entity:installed-merge', expectedRevision: 2,
    body: 'Installed human combination of historical and current knowledge. 中文 🧠📚', summary: 'Explicit manual review.' } };
}

const { vault, input, first, second, calls } = await fixture('manual-merge-vault');
const originalSource = await readFile(join(vault.root, first.evidencePath)), head = await vault.git.run(['rev-parse', 'HEAD']), count = calls();
const prepared = await vault.wikiMergePrepare(input);
assert.equal(prepared.plan.kind, 'merge'); assert.equal(prepared.plan.merge.fromCommit, input.fromCommit);
assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.equal(calls(), count);
const target = prepared.preview.pages.find(page => page.key === input.pageKey);
assert.match(target.before.body, /Installed current merge source/); assert.match(target.after.body, /Installed human combination/);
assert.ok(target.after.conditions.includes('Synthetic condition.')); assert.ok(target.after.uncertainty.includes('Not verified advice.'));
assert.deepEqual(new Set(target.after.evidence), new Set([first.evidencePath, second.evidencePath]));
const forged = structuredClone(prepared.plan); forged.pages[0].body = 'Modified after signing.';
await assert.rejects(vault.wikiApply(forged), { code: 'VALIDATION_FAILED' });
await assert.rejects(vault.wikiMergePrepare({ ...input, body: 'Malformed \uD800 body.' }), { code: 'VALIDATION_FAILED' });
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(vault.wikiMergePrepare({ ...input, signal: cancelled.signal }), { code: 'OPERATION_CANCELLED' });
await assert.rejects(vault.wikiApply(prepared.plan, { signal: cancelled.signal }), { code: 'OPERATION_CANCELLED' });
assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
await writeFile('manual-input.json', JSON.stringify(input), { mode: 0o600 });
const cliPrepared = await exec(process.execPath, [cli, 'wiki', 'merge-prepare', '--file', 'manual-input.json', '--root', vault.root]);
await writeFile('manual-proposal.json', cliPrepared.stdout, { mode: 0o600 });
const plan = JSON.parse(cliPrepared.stdout).plan;
assert.equal(plan.kind, 'merge');
await exec(process.execPath, [cli, 'wiki', 'preview', '--file', 'manual-proposal.json', '--root', vault.root]);
const approved = await exec(process.execPath, [cli, 'wiki', 'apply', '--file', 'manual-proposal.json', '--root', vault.root]);
assert.ok(JSON.parse(approved.stdout).commit);
const currentPage = (await vault.wikiCatalog()).find(page => page.key === input.pageKey);
assert.equal((await vault.get(currentPage.id)).body, target.after.body);
assert.deepEqual(await vault.wikiApply(plan), { pageIds: [], commit: null });
assert.deepEqual(await readFile(join(vault.root, first.evidencePath)), originalSource);
assert.equal(calls(), count);

const privateCase = await fixture('manual-private-merge-vault', 'secret');
await assert.rejects(privateCase.vault.wikiMergePrepare(privateCase.input));
const privatePlan = await privateCase.vault.wikiMergePrepare({ ...privateCase.input, includeSecret: true });
await privateCase.vault.wikiApply(privatePlan.plan);
const privateTarget = privatePlan.preview.pages.find(page => page.key === privateCase.input.pageKey);
assert.equal(privateTarget.after.sensitivity, 'secret');
const page = (await privateCase.vault.wikiCatalog()).find(page => page.key === privateCase.input.pageKey);
assert.doesNotMatch(await readFile(join(privateCase.vault.root, page.path), 'utf8'), /Installed human combination/);
await privateCase.vault.encryption.erase(privateCase.first.evidenceId);
await assert.rejects(privateCase.vault.wikiApply(privatePlan.plan));
console.log('Installed package: signed historical/current manual merge, full preview, provenance, no model calls, private opt-in/encryption/key loss, cancellation, forged-plan refusal, real CLI approval and exact retry passed (same vault, no branch/shared-vault merge or semantic-quality claim).');
