// Consumer-only smoke: all product imports resolve from the installed package.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MemoryVault, packContext, previewDirectoryImport, applyDirectoryImport, startWebServer } from 'memobranch';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as harnessPlugin from 'memobranch/deepseek-harness';

const vault = new MemoryVault(join(process.cwd(), 'knowledge-vault'));
await vault.initialize('installed knowledge workflows');
const directory = join(process.cwd(), 'knowledge-docs');
await mkdir(directory);
await writeFile(join(directory, 'atlas.md'), 'Atlas seven day retention.');
const plan = await previewDirectoryImport(directory);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(applyDirectoryImport(vault, plan, { signal: cancelled.signal }), { code: 'OPERATION_CANCELLED' });
const imported = await applyDirectoryImport(vault, plan, { scope: 'public', sensitivity: 'public' });
assert.equal(imported.status, 'completed');
const source = imported.entries[0];
assert.equal((await applyDirectoryImport(vault, plan, { scope: 'public', sensitivity: 'public' })).entries[0].result.duplicate, true);
const candidate = await vault.propose({ key: 'Atlas preference', kind: 'preference', statement: 'Atlas prefers seven days.',
  scope: 'public', sensitivity: 'public', confidence: 1, explicit: true, conditions: ['Only production.'], tags: [] }, [source.result.evidencePath]);
const approved = await vault.approve(candidate.id);
const context = await vault.contextDetailed('Atlas', { maxTokens: 10_000 });
assert.equal(context.records.length, 1);
assert.equal(context.budget.estimated, true);
assert.ok(context.text.includes('Only production.'));
assert.equal((await vault.contextDetailed('Atlas', { maxTokens: 1 })).text, '');
assert.equal(packContext([{ id: 'x', section: 'retrieved', text: 'one' }], { maxCharacters: 3 }).text, 'one');
const timeline = await vault.sourceTimeline(source.sourceUri);
assert.equal(timeline.total, 1); assert.equal(timeline.items[0].references.length, 1);
const exec = promisify(execFile);
const cli = join(process.cwd(), 'node_modules/memobranch/dist/cli.js');
const invoke = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args, '--root', vault.root], { timeout: 20_000 })).stdout);
assert.equal((await invoke('context', 'Atlas', '--max-tokens', '1', '--json')).text, '');
assert.deepEqual(await invoke('import', 'preview', directory), plan);
assert.equal((await invoke('source', 'timeline', source.sourceUri)).timeBasis, 'recorded-time-only');
const planPath = join(process.cwd(), 'knowledge-plan.json');
await writeFile(planPath, JSON.stringify(plan));
assert.equal((await invoke('import', 'apply', '--plan', planPath, '--scope', 'public', '--sensitivity', 'public')).entries[0].result.duplicate, true);
const at = '2026-09-01T00:00:00.000Z';
assert.equal((await vault.memoriesAt(at)).total, 0);
assert.equal((await vault.memoriesAt(at, { includeUnknown: true })).total, 1);
assert.equal((await vault.setMemoryValidity(approved.memoryId, { validFrom: '2000-01-01T00:00:00Z',
  validUntil: '2999-01-01T00:00:00Z', expectedRevision: 1 })).revision, 2);
assert.equal((await invoke('memory', 'at', at)).items[0].validFrom, '2000-01-01T00:00:00.000Z');
assert.equal((await invoke('memory', 'validity', approved.memoryId, '--from', '2001-01-01T00:00:00Z',
  '--until', '2999-01-01T00:00:00Z', '--expected-revision', '2', '--confirm')).revision, 3);
assert.equal((await vault.memoriesAt('2000-06-01T00:00:00Z')).total, 0);
assert.ok((await vault.recall('Atlas')).text.includes('validFrom'));
await assert.rejects(vault.setMemoryValidity(approved.memoryId, { validFrom: at, validUntil: null, expectedRevision: 2 }), { code: 'VALIDATION_FAILED' });
const client = new Client({ name: 'installed-knowledge', version: '1' });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'public', AMEM_MAX_SENSITIVITY: 'public' });
await client.connect(new StdioClientTransport({ command: process.execPath,
  args: [join(process.cwd(), 'node_modules/memobranch/dist/mcp.js'), vault.root], env, stderr: 'pipe' }));
try {
  const listed = await client.listTools();
  assert.ok(!listed.tools.some(tool => /directory_import/.test(tool.name)));
  const history = await client.callTool({ name: 'memory_source_timeline', arguments: { sourceUri: source.sourceUri } });
  assert.equal(history.isError, undefined);
  assert.equal(JSON.parse(history.content[0].text).total, 1);
  const dated = await client.callTool({ name: 'memory_at', arguments: { at } });
  assert.equal(dated.isError, undefined);
  assert.equal(JSON.parse(dated.content[0].text).items[0].revision, 3);
  const recalled = await client.callTool({ name: 'memory_recall', arguments: { query: 'Atlas', maxTokens: 1 } });
  assert.equal(JSON.parse(recalled.content[0].text).text, '');
} finally { await client.close(); }
Object.assign(process.env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read',
  AMEM_ALLOWED_SCOPES: 'public', AMEM_MAX_SENSITIVITY: 'public' });
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, {});
  await ctx.plugin(harnessPlugin, { vaultRoot: vault.root });
  const recall = await ctx.tools.execute({ name: 'memory_recall', callId: 'knowledge-budget',
    arguments: { query: 'Atlas', maxTokens: 1 }, signal: new AbortController().signal });
  assert.equal(recall.isError, false, JSON.stringify(recall));
  assert.equal(recall.value.text, '');
  const history = await ctx.tools.execute({ name: 'memory_source_timeline', callId: 'knowledge-history',
    arguments: { sourceUri: source.sourceUri }, signal: new AbortController().signal });
  assert.equal(history.isError, false, JSON.stringify(history));
  assert.equal(history.value.total, 1);
  const dated = await ctx.tools.execute({ name: 'memory_at', callId: 'knowledge-effective',
    arguments: { at }, signal: new AbortController().signal });
  assert.equal(dated.isError, false, JSON.stringify(dated));
  assert.equal(dated.value.items[0].id, approved.memoryId);
} finally { await ctx.fiber.dispose(); }
const web = await startWebServer(vault.root);
try {
  const call = async (operation, body) => {
    const response = await fetch(`${web.url}/api/${operation}`, { method: 'POST', headers: { Origin: web.url,
      Authorization: `Bearer ${web.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call('memories-at', { at })).data.result.total, 1);
  const listing = (await call('records', { collection: 'memories' })).data.result;
  assert.equal(listing.items[0].revision, 3);
  assert.equal(listing.items[0].validFrom, '2001-01-01T00:00:00.000Z');
  assert.equal(listing.items[0].validUntil, '2999-01-01T00:00:00.000Z');
  const script = await (await fetch(`${web.url}/app.js`)).text();
  assert.match(script, /核对并保存有效期/); assert.match(script, /查询时刻（UTC）/); assert.match(script, /datetime-local/);
  assert.equal((await call('memory-validity', { id: approved.memoryId, validFrom: null, validUntil: null, expectedRevision: 3 })).status, 400);
  const saved = await call('memory-validity', { id: approved.memoryId, validFrom: null, validUntil: null, expectedRevision: 3, confirm: true });
  assert.equal(saved.status, 200); assert.equal(saved.data.result.revision, 4);
  assert.equal((await call('memories-at', { at })).data.result.total, 0);
} finally { await web.stop(); }
console.log('Installed package: whole-record budgets, directory imports, cancellation, source timeline, CLI, MCP and Harness passed.');
console.log('Installed package: explicit effective intervals, stale revision refusal, current recall dates and API/CLI/MCP/Harness/HTTP dated views passed.');
