import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { LlmClient, MemoryVault, startWebServer } from 'memobranch';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from 'memobranch/deepseek-harness';

const exec = promisify(execFile);
await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-availability-'));
try {
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let version = 1, calls = 0;
  llm.wiki = async (operation, input) => {
    calls++; if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const pages = input.sources.map(source => ({ key: 'source:' + source.id, pageType: 'source', title: 'Source', summary: 'Fixture',
      body: source.body, evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] }));
    return { pages: [...pages, { ...pages[0], key: 'concept:installed-availability', pageType: 'concept', title: 'Installed knowledge',
      body: 'Observed version ' + version, links: pages.map(page => page.key), evidenceIds: input.sources.map(source => source.id) }] };
  };
  const vault = new MemoryVault(join(temporary, 'vault'), { llm }); await vault.initialize('Installed observed knowledge');
  const key = 'concept:installed-availability', first = await vault.capture({ content: 'Installed original source', extract: false });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const raw = await readFile(join(vault.root, first.evidencePath), 'utf8');
  const unknown = await vault.wikiAsKnownAt({ pageKeys: [key], at: new Date().toISOString() }); assert.equal(unknown.items[0].status, 'unknown');
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key], confirm: false }));
  const observed = await vault.wikiObserveAvailability({ pageKeys: [key], confirm: true }); assert.ok(observed.commit);
  const second = await vault.capture({ content: 'Installed second source', extract: false }); version = 2;
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const current = await vault.wikiSnapshot({ commit: await vault.git.run(['rev-parse', 'HEAD']), pageKeys: [key] });
  assert.match(current.pages.find(page => page.meta.key === key).body, /version 2/);
  const head = await vault.git.run(['rev-parse', 'HEAD']), count = calls;
  const read = await vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt }); assert.equal(read.items[0].status, 'observed');
  assert.equal(read.items[0].snapshot.commit, observed.observedCommit);
  assert.match(read.items[0].snapshot.pages.find(page => page.meta.key === key).body, /version 1/);
  const subset = await vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt, observationIds: [observed.evidenceId] });
  assert.equal(subset.coverage.mode, 'explicit-observation-ids'); assert.match(subset.warnings.join(' '), /outside that set/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key], confirm: true, signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt, signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key], confirm: true, observedAt: '2001-01-01T00:00:00Z' }), { code: 'VALIDATION_FAILED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.equal(calls, count);
  assert.equal(await readFile(join(vault.root, first.evidencePath), 'utf8'), raw);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_PERMISSIONS: 'read,write', AMEM_ALLOWED_SCOPES: 'user', AMEM_MAX_SENSITIVITY: 'internal',
    AMEM_TENANT_ID: (await vault.config()).tenantId });
  const cli = async args => JSON.parse((await exec(process.execPath,
    [resolve('node_modules/memobranch/dist/cli.js'), 'wiki', ...args, '--root', vault.root], { env })).stdout);
  await assert.rejects(cli(['observe', key]));
  const cliObserved = await cli(['observe', key, '--confirm']); assert.ok(cliObserved.evidenceId);
  const afterCli = await vault.git.run(['rev-parse', 'HEAD']);
  const cliOld = await cli(['as-known-at', key, '--at', observed.observedAt, '--observations', observed.evidenceId]);
  assert.equal(cliOld.items[0].snapshot.commit, observed.observedCommit); assert.match(cliOld.items[0].snapshot.pages.find(page => page.meta.key === key).body, /version 1/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), afterCli);
  const exercise = async (adapter, call) => {
    const before = await vault.git.run(['rev-parse', 'HEAD']);
    await assert.rejects(call('memory_wiki_observe', { pageKeys: [key], confirm: false }));
    await assert.rejects(call('memory_wiki_observe', { pageKeys: [key], confirm: true, observedAt: '2001-01-01T00:00:00Z' }));
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
    const saved = await call('memory_wiki_observe', { pageKeys: [key], confirm: true }); assert.ok(saved.evidenceId);
    const savedHead = await vault.git.run(['rev-parse', 'HEAD']);
    const old = await call('memory_wiki_as_known_at', { pageKeys: [key], at: observed.observedAt, observationIds: [observed.evidenceId] });
    assert.equal(old.items[0].snapshot.commit, observed.observedCommit); assert.equal(old.coverage.mode, 'explicit-observation-ids');
    assert.match(old.items[0].snapshot.pages.find(page => page.meta.key === key).body, /version 1/);
    await assert.rejects(call('memory_wiki_as_known_at', { pageKeys: [key], at: observed.observedAt, permissions: ['admin'] }));
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), savedHead);
    console.log(`Installed ${adapter} availability: strict explicit observation and exact read-only historical content passed.`);
  };
  const client = new Client({ name: 'installed-availability', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('node_modules/memobranch/dist/mcp.js'), vault.root], env, stderr: 'pipe' }));
    await exercise('MCP', async (name, input) => {
      const response = await client.callTool({ name, arguments: input });
      if (response.isError) throw new Error(response.content[0].text);
      return JSON.parse(response.content[0].text);
    });
  } finally { await client.close(); }
  const originalEnv = { ...process.env }, ctx = new Context(); let sequence = 0;
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('AMEM_') || name === 'OPENAI_API_KEY') delete process.env[name];
    Object.assign(process.env, env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: vault.root });
    await exercise('Harness', async (name, input) => {
      const response = await ctx.tools.execute({ name, arguments: input, callId: `installed-availability-${sequence++}`, signal: new AbortController().signal });
      if (response.isError) throw new Error(JSON.stringify(response.error));
      return response.value;
    });
  } finally {
    await ctx.fiber.dispose();
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
  }
  assert.equal(calls, count); assert.equal(await readFile(join(vault.root, first.evidencePath), 'utf8'), raw);
  console.log('Installed CLI availability: confirmation, exact observed history and unchanged read state passed.');
  const web = await startWebServer(vault.root);
  try {
    const script = await (await fetch(web.url + '/app.js')).text(); assert.match(script, /async function availability\(/); assert.match(script, /知识可用时间/);
    const http = async (name, input) => {
      const response = await fetch(web.url + '/api/' + name, { method: 'POST', headers: {
        Origin: web.url, Authorization: 'Bearer ' + web.token, 'Content-Type': 'application/json',
      }, body: JSON.stringify(input) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error.code); return value.result;
    };
    const before = await vault.git.run(['rev-parse', 'HEAD']);
    await assert.rejects(http('wiki-observe', { pageKeys: [key] }), /VALIDATION_FAILED/);
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
    const saved = await http('wiki-observe', { pageKeys: [key], confirm: true }); assert.ok(saved.evidenceId);
    const savedHead = await vault.git.run(['rev-parse', 'HEAD']);
    const read = await http('wiki-as-known-at', { pageKeys: [key], at: observed.observedAt, observationIds: [observed.evidenceId] });
    assert.equal(read.items[0].snapshot.commit, observed.observedCommit); assert.match(read.items[0].snapshot.pages.find(page => page.meta.key === key).body, /version 1/);
    await assert.rejects(http('wiki-as-known-at', { pageKeys: [key], at: observed.observedAt, root: '/foreign' }), /VALIDATION_FAILED/);
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), savedHead); assert.equal(calls, count);
    console.log('Installed Web availability: bundled page, strict confirmed observation and exact read-only history passed.');
  } finally { await web.stop(); }
  await vault.wikiRevoke(key, 'Withdraw installed fixture');
  await assert.rejects(vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt }), { code: 'NOT_FOUND' });
  console.log('Installed availability core: explicit immutable observations, real version change, exact old reconstruction, unknown legacy, subset limits, cancellation and current revocation passed; no model-quality or first-learning claim.');
} finally { await rm(temporary, { recursive: true, force: true }); }
