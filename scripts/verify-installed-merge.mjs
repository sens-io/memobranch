// Every product import resolves from the installed consumer, never src/ or tsx.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LlmClient, MemoryVault, startWebServer } from 'memobranch';
import * as plugin from 'memobranch/deepseek-harness';

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
  const targetId = (await vault.wikiCatalog()).find(page => page.key === 'entity:installed-merge').id;
  const historicalBody = (await vault.get(targetId)).body;
  const second = await vault.capture({ content: 'Installed current merge source.', scope: 'project', sensitivity, extract: false });
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const currentBody = (await vault.get(targetId)).body;
  return { vault, llm, first, second, historicalBody, currentBody, calls: () => calls, input: { fromCommit, pageKey: 'entity:installed-merge', expectedRevision: 2,
    body: 'Installed human combination of historical and current knowledge. 中文 🧠📚', summary: 'Explicit manual review.' } };
}

const { vault, input, first, second, historicalBody, currentBody, calls } = await fixture('manual-merge-vault');
const originalSource = await readFile(join(vault.root, first.evidencePath)), head = await vault.git.run(['rev-parse', 'HEAD']), count = calls();
const prepared = await vault.wikiMergePrepare(input);
assert.equal(prepared.plan.kind, 'merge'); assert.equal(prepared.plan.merge.fromCommit, input.fromCommit);
assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.equal(calls(), count);
const target = prepared.preview.pages.find(page => page.key === input.pageKey);
assert.match(target.before.body, /Installed current merge source/); assert.match(target.after.body, /Installed human combination/);
assert.notEqual(historicalBody, currentBody);
assert.equal(prepared.comparison.base.pages.find(page => page.meta.key === input.pageKey).body, historicalBody);
assert.equal(prepared.comparison.current.body, currentBody); assert.equal(target.before.body, currentBody);
assert.equal(prepared.plan.pages.find(page => page.key === input.pageKey).body, input.body);
assert.ok(target.after.body.includes(input.body)); assert.ok(target.after.body.includes('中文 🧠📚'));
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
const cliComparison = JSON.parse(cliPrepared.stdout).comparison;
assert.equal(cliComparison.base.pages.find(page => page.meta.key === input.pageKey).body, historicalBody);
assert.equal(cliComparison.current.body, currentBody);
const cliPreview = JSON.parse((await exec(process.execPath, [cli, 'wiki', 'preview', '--file', 'manual-proposal.json', '--root', vault.root])).stdout);
const cliTarget = cliPreview.pages.find(page => page.key === input.pageKey);
assert.equal(cliTarget.before.body, currentBody); assert.equal(cliTarget.after.body, target.after.body);
assert.ok(cliTarget.after.body.includes('中文 🧠📚'));
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

const webCase = await fixture('manual-web-merge-vault'), webCount = webCase.calls(), webHead = await webCase.vault.git.run(['rev-parse', 'HEAD']);
const sourceBytes = await Promise.all([webCase.first, webCase.second].map(source => readFile(join(webCase.vault.root, source.evidencePath))));
const web = await startWebServer(webCase.vault.root, { llm: webCase.llm, masterKey: key });
try {
  const post = async (operation, data) => {
    const response = await fetch(web.url + '/api/' + operation, { method: 'POST', headers: {
      Origin: web.url, Authorization: 'Bearer ' + web.token, 'Content-Type': 'application/json',
    }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const base = await post('wiki-snapshot', { commit: webCase.input.fromCommit, pageKeys: [webCase.input.pageKey] }); assert.equal(base.status, 200);
  assert.equal(base.body.result.pages.find(page => page.meta.key === webCase.input.pageKey).body, webCase.historicalBody);
  const current = await post('wiki-snapshot', { commit: base.body.result.authorityHead, pageKeys: [webCase.input.pageKey] }); assert.equal(current.status, 200);
  assert.equal(current.body.result.pages.find(page => page.meta.key === webCase.input.pageKey).body, webCase.currentBody);
  const prepared = await post('merge-prepare', webCase.input); assert.equal(prepared.status, 200);
  assert.equal(prepared.body.result.comparison.current.body, webCase.currentBody);
  const view = await post('preview', { plan: prepared.body.result.plan }); assert.equal(view.status, 200); assert.deepEqual(view.body.result, prepared.body.result.preview);
  assert.equal(webCase.calls(), webCount); assert.equal(await webCase.vault.git.run(['rev-parse', 'HEAD']), webHead);
  assert.equal((await post('apply', { plan: prepared.body.result.plan })).status, 400);
  assert.ok((await post('apply', { plan: prepared.body.result.plan, confirm: true })).body.result.commit);
  assert.deepEqual((await post('apply', { plan: prepared.body.result.plan, confirm: true })).body.result, { pageIds: [], commit: null });
  const target = view.body.result.pages.find(page => page.key === webCase.input.pageKey), id = (await webCase.vault.wikiCatalog()).find(page => page.key === webCase.input.pageKey).id;
  assert.equal((await webCase.vault.get(id)).body, target.after.body); assert.ok(target.after.body.includes(webCase.input.body));
  for (const [index, source] of [webCase.first, webCase.second].entries()) assert.deepEqual(await readFile(join(webCase.vault.root, source.evidencePath)), sourceBytes[index]);
  assert.match(await (await fetch(web.url + '/app.js')).text(), /async function merges\(/);
  assert.equal(webCase.calls(), webCount);
  console.log('Installed package: authenticated historical/current Web reads, complete signed merge preview, separate confirmed approval, both source bytes and exact retry passed (HTTP and assets, not browser interaction).');
} finally { await web.stop(); }

for (const adapter of ['MCP', 'Harness']) {
  const example = await fixture(`manual-${adapter.toLowerCase()}-merge-vault`);
  const baseline = await example.vault.git.run(['rev-parse', 'HEAD']);
  const originals = await Promise.all([example.first, example.second].map(source => readFile(join(example.vault.root, source.evidencePath))));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_PERMISSIONS: 'read,write,review', AMEM_ALLOWED_SCOPES: 'user,project', AMEM_MAX_SENSITIVITY: 'secret',
    AMEM_TENANT_ID: (await example.vault.config()).tenantId, AMEM_MASTER_KEY: key });
  await agent(adapter, example.vault.root, env, async invoke => {
    const historical = await invoke('snapshot', { commit: example.input.fromCommit, pageKeys: [example.input.pageKey] });
    assert.equal(historical.pages.find(page => page.meta.key === example.input.pageKey).body, example.historicalBody);
    assert.equal(historical.authorityHead, baseline);
    const prepared = await invoke('merge_prepare', example.input);
    assert.equal(prepared.comparison.current.body, example.currentBody);
    assert.equal(prepared.comparison.base.pages.find(page => page.meta.key === example.input.pageKey).body, example.historicalBody);
    assert.deepEqual(await invoke('preview', { plan: prepared.plan }), prepared.preview);
    await assert.rejects(invoke('merge_prepare', { ...example.input, apply: true }));
    await assert.rejects(invoke('snapshot', { commit: 'HEAD', pageKeys: [example.input.pageKey] }));
    assert.equal(await example.vault.git.run(['rev-parse', 'HEAD']), baseline);
    const forged = structuredClone(prepared.plan); forged.pages[0].body = 'Unsigned installed edit';
    await assert.rejects(invoke('apply', { plan: forged }));
    const approved = await invoke('apply', { plan: prepared.plan }); assert.ok(approved.commit);
    const target = prepared.preview.pages.find(page => page.key === example.input.pageKey);
    const id = (await example.vault.wikiCatalog()).find(page => page.key === example.input.pageKey).id;
    assert.equal((await example.vault.get(id)).body, target.after.body); assert.ok(target.after.body.includes('中文 🧠📚'));
    assert.deepEqual(await invoke('apply', { plan: prepared.plan }), { pageIds: [], commit: null });
    for (const [i, source] of [example.first, example.second].entries()) assert.deepEqual(await readFile(join(example.vault.root, source.evidencePath)), originals[i]);
  });
  await agent(adapter, example.vault.root, { ...env, AMEM_PERMISSIONS: 'read' }, async (invoke, names) => {
    assert.ok(names.includes('memory_wiki_snapshot'));
    if (adapter === 'Harness') assert.ok(!names.includes('memory_wiki_merge_prepare'));
    await assert.rejects(invoke('merge_prepare', { ...example.input, expectedRevision: 3 }));
  });
  console.log(`Installed ${adapter}: complete pinned Wiki read, manual signed merge, separate approval, authority refusal, both source bytes and exact retry passed (same vault; no external model or full host-conversation quality claim).`);
}

// Exercise the installed adapter and both default stdio buffers, not only a helper.
const budgetClient = new Client({ name: 'installed-review-budget', version: '1' });
const budgetController = new AbortController(), protocolErrors = [];
budgetClient.onerror = error => { protocolErrors.push(error); budgetController.abort(error); };
const budgetTimer = setTimeout(() => budgetController.abort(new Error('Installed stdio budget timed out')), 15000);
try {
  const child = `
    import { MemoryVault } from 'memobranch';
    MemoryVault.prototype.wikiSnapshot = async input => ({ body: 'x'.repeat(input.pageKeys[0] === 'small' ? 9 * 1048576 - 4096 : 11 * 1048576) });
    MemoryVault.prototype.wikiMergePrepare = async () => ({ plan: {}, comparison: { body: 'x'.repeat(11 * 1048576) } });
    await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'node_modules/memobranch/dist/mcp.js')).href)});
  `;
  await budgetClient.connect(new StdioClientTransport({ command: process.execPath, args: ['--input-type=module', '-e', child], stderr: 'pipe',
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY')) }));
  for (const [operation, input] of [
    ['snapshot', { commit: 'a'.repeat(40), pageKeys: ['large'] }],
    ['merge_prepare', { fromCommit: 'a'.repeat(40), pageKey: 'entity:large', expectedRevision: 1, body: 'Human draft', summary: 'Review' }],
  ]) {
    const result = await budgetClient.callTool({ name: `memory_wiki_${operation}`, arguments: input }, { signal: budgetController.signal });
    assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /CONTENT_TOO_LARGE/);
  }
  const result = await budgetClient.callTool({ name: 'memory_wiki_snapshot', arguments: { commit: 'a'.repeat(40), pageKeys: ['small'] } }, { signal: budgetController.signal });
  assert.equal(result.isError, undefined); assert.equal(result.content[0].type, 'text');
  assert.equal(JSON.parse(result.content[0].text).body.length, 9 * 1048576 - 4096); assert.deepEqual(protocolErrors, []);
  console.log('Installed MCP: default stdio carries complete below-limit review and bounded oversized errors (in-memory oversized data injection; actual installed adapter/SDK, not historical-graph quality).');
} finally { clearTimeout(budgetTimer); budgetController.abort(); await budgetClient.close(); }

async function agent(adapter, root, env, action) {
  if (adapter === 'MCP') {
    const client = new Client({ name: 'installed-merge', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [join(process.cwd(), 'node_modules/memobranch/dist/mcp.js'), root], env, stderr: 'pipe' }));
      await action(async (operation, input) => {
        const result = await client.callTool({ name: `memory_wiki_${operation}`, arguments: input });
        const content = result.content[0]; assert.equal(content.type, 'text');
        if (result.isError) throw new Error(content.text);
        return JSON.parse(content.text);
      }, (await client.listTools()).tools.map(tool => tool.name));
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, ctx = new Context();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('AMEM_') || name === 'OPENAI_API_KEY') delete process.env[name];
    Object.assign(process.env, env);
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root });
    let callId = 0;
    await action(async (operation, input) => {
      const result = await ctx.tools.execute({ name: `memory_wiki_${operation}`, arguments: input,
        callId: `installed-merge-${callId++}`, signal: new AbortController().signal });
      if (result.isError) throw new Error(JSON.stringify(result.error));
      return result.value;
    }, ctx.tools.schemas().map(tool => tool.name));
  } finally {
    await ctx.fiber.dispose();
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}
