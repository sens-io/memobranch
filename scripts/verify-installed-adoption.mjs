// Copied into a consumer directory by verify-package; all imports are installed exports.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LlmClient, MemoryVault } from 'memobranch';

class Fixture extends LlmClient {
  constructor() { super({ apiKey: '', model: 'installed-adoption-fixture', embeddingModel: '' }); }
  async wiki(operation, input) {
    if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const ids = input.sources.map(source => source.id);
    const draft = (key, pageType, body) => ({ key, pageType, title: key, summary: 'Installed approved context', body,
      evidenceIds: ids, links: [], status: 'active', conditions: ['Only installed smoke tests.'], uncertainty: ['No production claim.'] });
    return { pages: [...input.sources.map(source => draft(`source:${source.id}`, 'source', source.body)),
      draft('entity:installed', 'entity', input.correction ? 'Installed Atlas retention is 14 days.' : 'Installed Atlas retention is 7 days.')] };
  }
}
const vaultRoot = join(process.cwd(), 'adoption-vault');
const vault = new MemoryVault(vaultRoot, { llm: new Fixture() });
await vault.initialize('installed-adoption');
const source = await vault.capture({ content: 'Installed Atlas retention is 7 days.', scope: 'public', sensitivity: 'public' });
const pending = await vault.wikiIngest({ evidenceIds: [source.evidenceId] });
const preview = await vault.wikiPreview(pending.plan);
assert.equal(preview.pages.length, 2);
await vault.wikiApply(pending.plan);
const recalled = await vault.recall('Atlas', { maxCharacters: 12_000 });
assert.equal(recalled.wikiPages.length, 2);
assert.ok(recalled.text.includes('Only installed smoke tests.'));
const correction = await vault.wikiCorrect('entity:installed', 'Retention is now 14 days.');
assert.equal(correction.plan.kind, 'repair');
assert.equal(correction.commit, null);
assert.ok(correction.evidenceCommit);
await vault.wikiApply(correction.plan);
assert.ok((await vault.recall('Atlas')).wikiPages.some(page => page.revision === 2 && page.body.includes('14 days')));
assert.equal((await vault.explain('Atlas')).explanation.strategy, 'lexical');

const exec = promisify(execFile);
const cli = join(process.cwd(), 'node_modules/memobranch/dist/cli.js');
const configPath = join(process.cwd(), 'client/.mcp.json');
const invoke = async (...args) => JSON.parse((await exec(process.execPath, [cli, 'setup', ...args,
  '--root', vaultRoot, '--config', configPath], { timeout: 20_000 })).stdout);
const plan = await invoke('preview');
assert.equal(plan.change, 'add');
assert.equal(plan.entry.env.AMEM_PERMISSIONS, 'read');
assert.ok(plan.entry.env.AMEM_TENANT_ID);
assert.equal(plan.entry.env.AMEM_MASTER_KEY, undefined);
assert.equal((await invoke('apply', '--expected-revision', plan.expectedRevision)).applied, true);
assert.equal((await invoke('verify')).connected, true);
const installed = await invoke('preview');
assert.equal((await invoke('remove', '--expected-revision', installed.expectedRevision)).removed, true);
assert.equal(JSON.parse(await readFile(configPath, 'utf8')).mcpServers.memobranch, undefined);
console.log('Installed package: approved recall, signed previews, correction and real client setup/verification passed.');
