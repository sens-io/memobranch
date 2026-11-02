import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LlmClient, MemoryVault, SharedWikiImporter, startWebServer } from 'memobranch';
import * as plugin from 'memobranch/deepseek-harness';

// The copied consumer program imports only installed public package exports.
const exec = promisify(execFile);
await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-wiki-import-'));
const modelMethods = ['embed', 'extractMemories', 'answer', 'wiki'];
const originalModelMethods = new Map();
try {
  let version = 1, calls = 0;
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
  llm.wiki = async (operation, input) => {
    calls++;
    if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const pages = input.sources.map(source => ({ key: 'source:' + source.id, pageType: 'source', title: 'Installed source', summary: 'Synthetic source',
      body: source.body, evidenceIds: [source.id], links: [], status: 'active', conditions: ['Only a synthetic source'], uncertainty: ['Original not independently verified'] }));
    return { pages: [...pages, { ...pages[0], key: 'concept:installed-import', pageType: 'concept', title: 'Installed Wiki source',
      body: 'INSTALLED_SOURCE_VERSION_' + version, evidenceIds: input.sources.map(source => source.id), links: pages.map(page => page.key) }] };
  };
  const source = new MemoryVault(join(temporary, 'source'), { llm }), caller = new MemoryVault(join(temporary, 'caller'));
  await source.initialize('Installed import source'); await caller.initialize('Installed import caller');
  const first = await source.capture({ content: 'Installed immutable original one', extract: false });
  await source.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const pin = await source.git.run(['rev-parse', 'HEAD']), sourceConfig = await source.config(), callerConfig = await caller.config();
  version = 2; const second = await source.capture({ content: 'Installed immutable original two', extract: false });
  await source.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const configPath = join(caller.root, '.amem/shared-wiki.json');
  const binding = { id: 'installed-import', title: 'Installed fixed source', root: source.root, commit: pin,
    vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId, readers: [{ id: caller.principal.id, tenantId: callerConfig.tenantId }], scopes: ['user'], maxSensitivity: 'internal' };
  const saveBindings = sources => writeFile(configPath, JSON.stringify({ version: 1, sources }));
  await saveBindings([binding]);
  const selection = { sourceId: binding.id, expectedCommit: pin, pageKeys: ['concept:installed-import'] };
  const env = Object.assign(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')), {
    AMEM_SHARED_WIKI_CONFIG: configPath, AMEM_ACTOR_ID: caller.principal.id, AMEM_TENANT_ID: callerConfig.tenantId,
    AMEM_PERMISSIONS: 'read,write,review', AMEM_ALLOWED_SCOPES: 'user', AMEM_MAX_SENSITIVITY: 'internal',
  });
  const state = async vault => ({ head: await vault.git.run(['rev-parse', 'HEAD']), refs: await vault.git.run(['show-ref']),
    index: await readFile(join(vault.git.gitDir, 'index')), status: await vault.git.run(['status', '--porcelain']) });
  const sourceBefore = await state(source), raw = await readFile(join(source.root, first.evidencePath)), count = calls;
  // Trap every public model entry point in this consumer and in actual CLI/MCP
  // children. A caught model error still leaves a marker and fails the assertion.
  const modelLog = join(temporary, 'unexpected-model-calls.txt'), modelGuard = join(temporary, 'reject-model-calls.mjs');
  await writeFile(modelLog, '', { mode: 0o600 });
  const trap = method => function () { appendFileSync(modelLog, method + '\n'); throw new Error('Import/integration must not invoke a model'); };
  for (const method of modelMethods) { originalModelMethods.set(method, LlmClient.prototype[method]); LlmClient.prototype[method] = trap(method); }
  await writeFile(modelGuard, `import { appendFileSync } from 'node:fs';
import { LlmClient } from 'memobranch';
for (const method of ${JSON.stringify(modelMethods)}) LlmClient.prototype[method] = function () {
  appendFileSync(${JSON.stringify(modelLog)}, method + '\\n');
  throw new Error('Import/integration must not invoke a model');
};`, { mode: 0o600 });
  const importer = new SharedWikiImporter(caller, { configPath }); let retained;
  const retainedIds = new Set();
  const exercise = async (adapter, invoke) => {
    // Distinct explicit fixture bindings produce distinct artifacts, so each
    // real adapter must exercise a first capture as well as its duplicate path.
    binding.id = 'installed-import-' + adapter.toLowerCase(); selection.sourceId = binding.id; await saveBindings([binding]);
    const before = await state(caller), prepared = await invoke('copy-prepare', selection);
    assert.equal(prepared.plan.selection.expectedCommit, pin); assert.match(JSON.stringify(prepared), /INSTALLED_SOURCE_VERSION_1/);
    assert.doesNotMatch(JSON.stringify(prepared), /INSTALLED_SOURCE_VERSION_2/); assert.deepEqual(await state(caller), before);
    await assert.rejects(invoke('copy-apply', { plan: prepared.plan, confirm: false }));
    const catalogBefore = await caller.wikiCatalog(), copied = await invoke('copy-apply', { plan: prepared.plan, confirm: true });
    assert.equal(copied.duplicate, false); assert.ok(copied.commit); assert.equal(retainedIds.has(copied.evidenceId), false);
    retainedIds.add(copied.evidenceId); retained = copied; assert.deepEqual(await caller.wikiCatalog(), catalogBefore);
    const evidence = await readFile(join(caller.root, copied.evidencePath)), afterCopy = await state(caller);
    const duplicate = await invoke('copy-apply', { plan: prepared.plan, confirm: true });
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.commit, null); assert.deepEqual(await state(caller), afterCopy);
    const input = { evidenceId: copied.evidenceId, pageKey: 'concept:installed-' + adapter.toLowerCase(), expectedRevision: 0,
      title: 'Reviewed ' + adapter, summary: 'Installed-package human integration', body: 'INSTALLED_AUTHORED_' + adapter + ' 中文 🧠📚', conditions: ['Only this test project'] };
    const integrated = await invoke('integrate', input);
    assert.equal(integrated.plan.kind, 'integrate'); assert.equal(integrated.comparison.current, null);
    assert.match(JSON.stringify(integrated.comparison.artifact), /INSTALLED_SOURCE_VERSION_1/);
    const target = integrated.preview.pages.find(page => page.key === input.pageKey);
    assert.ok(target.after.body.includes(input.body)); assert.ok(target.after.conditions.includes('Only a synthetic source'));
    assert.ok(target.after.conditions.includes('Only this test project')); assert.ok(target.after.uncertainty.some(value => value.includes('Offline plaintext cannot be recalled')));
    assert.deepEqual(await invoke('preview', { plan: integrated.plan }), integrated.preview); assert.deepEqual(await state(caller), afterCopy);
    const forged = structuredClone(integrated.plan); forged.pages[0].body = 'Edited after signing';
    await assert.rejects(invoke('apply', { plan: forged, confirm: true })); assert.deepEqual(await state(caller), afterCopy);
    assert.ok((await invoke('apply', { plan: integrated.plan, confirm: true })).commit);
    assert.deepEqual(await invoke('apply', { plan: integrated.plan, confirm: true }), { pageIds: [], commit: null });
    const targetMeta = (await caller.wikiCatalog()).find(page => page.key === input.pageKey);
    const persisted = await caller.get(targetMeta.id); assert.equal(persisted.body, target.after.body);
    for (const field of ['evidence', 'conditions', 'uncertainty', 'scope', 'sensitivity', 'status', 'expiresAt']) assert.deepEqual(persisted.meta[field], target.after[field], `${adapter} persisted ${field}`);
    assert.deepEqual(await readFile(join(caller.root, copied.evidencePath)), evidence);
    assert.deepEqual(await state(source), sourceBefore); assert.equal(calls, count); assert.equal(await readFile(modelLog, 'utf8'), '');
    console.log(`Installed ${adapter} Wiki import/integration: complete fixed source, separate confirmations, authored comparison, inherited limits, forged refusal, exact retries and unchanged evidence passed.`);
  };
  await exercise('Library', async (operation, input) => {
    if (operation === 'copy-prepare') return importer.prepare(input);
    if (operation === 'copy-apply') return importer.apply(input.plan, { confirm: input.confirm });
    if (operation === 'integrate') return caller.wikiIntegrationPrepare(input);
    if (operation === 'preview') return caller.wikiPreview(input.plan);
    return caller.wikiApply(input.plan);
  });
  const cli = async args => JSON.parse((await exec(process.execPath, ['--import', modelGuard, resolve('node_modules/memobranch/dist/cli.js'), 'wiki', ...args, '--root', caller.root], { env, maxBuffer: 10 * 1_048_576 })).stdout);
  let fileNumber = 0;
  await exercise('CLI', async (operation, input) => {
    if (operation === 'copy-prepare') return cli(['import-prepare', input.sourceId, ...input.pageKeys, '--expected-commit', input.expectedCommit]);
    const file = join(temporary, `cli-proposal-${fileNumber++}.json`);
    await writeFile(file, JSON.stringify(input), { mode: 0o600 });
    if (operation === 'copy-apply') return cli(['import-apply', '--file', file, ...(input.confirm ? ['--confirm'] : [])]);
    return cli([operation === 'integrate' ? 'integration-prepare' : operation, '--file', file]);
  });
  const names = { 'copy-prepare': 'memory_shared_wiki_import_prepare', 'copy-apply': 'memory_shared_wiki_import_apply', integrate: 'memory_wiki_integration_prepare', preview: 'memory_wiki_preview', apply: 'memory_wiki_apply' };
  const client = new Client({ name: 'installed-import', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', modelGuard, resolve('node_modules/memobranch/dist/mcp.js'), caller.root], env, stderr: 'pipe' }));
    await exercise('MCP', async (operation, input) => {
      const args = operation === 'apply' ? { plan: input.plan } : input;
      const result = await client.callTool({ name: names[operation], arguments: args });
      if (result.isError) throw new Error(result.content[0].text); return JSON.parse(result.content[0].text);
    });
  } finally { await client.close(); }
  const web = await startWebServer(caller.root, { sharedWikiConfig: configPath });
  try {
    await exercise('Web', async (operation, input) => {
      const name = { 'copy-prepare': 'shared-import-prepare', 'copy-apply': 'shared-import-apply', integrate: 'integration-prepare' }[operation] ?? operation;
      const response = await fetch(web.url + '/api/' + name, { method: 'POST', headers: { Origin: web.url, Authorization: 'Bearer ' + web.token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error.code); return result.result;
    });
    assert.match(await (await fetch(web.url + '/app.js')).text(), /wikiImports/);
  } finally { await web.stop(); }
  const savedEnv = { ...process.env }, ctx = new Context(); let sequence = 0;
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('AMEM_') || name === 'OPENAI_API_KEY') delete process.env[name];
    Object.assign(process.env, env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); await ctx.plugin(plugin, { vaultRoot: caller.root });
    await exercise('Harness', async (operation, input) => {
      const result = await ctx.tools.execute({ name: names[operation], arguments: operation === 'apply' ? { plan: input.plan } : input,
        callId: `installed-wiki-import-${sequence++}`, signal: new AbortController().signal });
      if (result.isError) throw new Error(JSON.stringify(result.error)); return result.value;
    });
  } finally { await ctx.fiber.dispose(); for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name]; Object.assign(process.env, savedEnv); }
  assert.equal(retainedIds.size, 5); assert.equal((await caller.wikiCatalog()).length, 10);
  const retainedPlan = (await importer.prepare(selection)).plan;
  assert.equal((await importer.apply(retainedPlan, { confirm: true })).duplicate, true);
  await saveBindings([]); await assert.rejects(importer.apply(retainedPlan, { confirm: true }), { code: 'NOT_FOUND' });
  const offline = await caller.wikiIntegrationPrepare({ evidenceId: retained.evidenceId, pageKey: 'concept:installed-offline', expectedRevision: 0,
    title: 'Retained offline integration', summary: 'Remote sharing removed', body: 'Explicitly retained copies remain usable under current local restrictions.' });
  assert.equal(offline.plan.kind, 'integrate'); assert.equal((await caller.wikiCatalog()).length, 10);
  assert.deepEqual(await state(source), sourceBefore); assert.deepEqual(await readFile(join(source.root, first.evidencePath)), raw); assert.equal(calls, count);
  assert.equal(await readFile(modelLog, 'utf8'), '');
  console.log('Installed Wiki import/integration: retained local copy remains independently reviewable after sharing removal; no automatic Wiki approval or model calls.');
} finally {
  for (const [method, original] of originalModelMethods) LlmClient.prototype[method] = original;
  await rm(temporary, { recursive: true, force: true });
}
