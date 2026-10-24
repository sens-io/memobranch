import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { LlmClient, MemoryVault, SharedWikiReader } from 'memobranch';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from 'memobranch/deepseek-harness';

const exec = promisify(execFile);
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
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_SHARED_WIKI_CONFIG: configPath, AMEM_TENANT_ID: callerConfig.tenantId, AMEM_ACTOR_ID: caller.principal.id,
    AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'user', AMEM_MAX_SENSITIVITY: 'internal' });
  const cli = async args => JSON.parse((await exec(process.execPath,
    [resolve('node_modules/memobranch/dist/cli.js'), 'wiki', ...args, '--root', caller.root], { env })).stdout);
  const catalog = await cli(['shared-list']); assert.equal(catalog.sources[0].id, binding.id);
  assert.equal((await cli(['shared-snapshot', binding.id, key])).snapshot.commit, pin);
  await assert.rejects(cli(['shared-snapshot', binding.id, key, '--commit', sourceHead]));
  await assert.rejects(cli(['shared-snapshot', binding.id, key, '--include-secret=true=garbage']));
  const exercise = async (adapter, call) => {
    assert.equal((await call('memory_shared_wiki_catalog', {})).sources[0].id, binding.id);
    const view = await call('memory_shared_wiki_snapshot', input); assert.equal(view.snapshot.commit, pin);
    assert.match(view.snapshot.pages.find(page => page.meta.key === key).body, /version 1/);
    await assert.rejects(call('memory_shared_wiki_snapshot', { ...input, root: source.root }));
    await assert.rejects(call('memory_shared_wiki_snapshot', { ...input, permissions: ['admin'] }));
    assert.equal((await call('memory_shared_wiki_snapshot', input)).snapshot.commit, pin);
    console.log(`Installed ${adapter} shared Wiki: host-configured source, exact old pin, strict authority refusal and unchanged read state passed.`);
  };
  const client = new Client({ name: 'installed-shared-wiki', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('node_modules/memobranch/dist/mcp.js'), caller.root], env, stderr: 'pipe' }));
    await exercise('MCP', async (name, args) => { const response = await client.callTool({ name, arguments: args }); if (response.isError) throw new Error(response.content[0].text); return JSON.parse(response.content[0].text); });
  } finally { await client.close(); }
  const originalEnv = { ...process.env }, ctx = new Context(); let sequence = 0;
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('AMEM_') || name === 'OPENAI_API_KEY') delete process.env[name];
    Object.assign(process.env, env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); await ctx.plugin(plugin, { vaultRoot: caller.root });
    await exercise('Harness', async (name, args) => {
      const response = await ctx.tools.execute({ name, arguments: args, callId: `installed-shared-${sequence++}`, signal: new AbortController().signal });
      if (response.isError) throw new Error(JSON.stringify(response.error)); return response.value;
    });
  } finally {
    await ctx.fiber.dispose(); for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name]; Object.assign(process.env, originalEnv);
  }
  assert.equal(await source.git.run(['rev-parse', 'HEAD']), sourceHead); assert.equal(await caller.git.run(['rev-parse', 'HEAD']), callerHead);
  assert.deepEqual(await readFile(join(source.root, first.evidencePath)), raw); assert.deepEqual(await readFile(join(source.git.gitDir, 'index')), sourceIndex); assert.equal(calls, count);
  console.log('Installed CLI shared Wiki: configured catalog, pinned old snapshot and strict flag refusal passed.');
  await source.wikiRevoke(key, 'Withdraw installed shared fixture'); await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
  console.log('Installed shared Wiki core: two real vaults, fixed old commit after source advance, explicit reader grants, origin, current withdrawal, cancellation, unchanged source/index/heads and no model calls passed.');
} finally { await rm(temporary, { recursive: true, force: true }); }
