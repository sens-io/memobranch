import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { MemoryVault } from '../src/vault.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(process.cwd(), '.scratch/server-fields-')); t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(join(root, 'vault')); await vault.initialize('Strict server fields');
  const saved = await vault.capture({ content: 'SYNTHETIC original record', scope: 'project' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined && !entry[0].startsWith('AMEM_') && entry[0] !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_PERMISSIONS: 'admin', AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: 'secret', AMEM_TENANT_ID: (await vault.config()).tenantId });
  const cases = [ ['memory_get', { id: saved.evidenceId }], ['memory_version', {}],
    ['memory_capture', { content: 'SYNTHETIC unsupported call must not be captured', scope: 'project', sensitivity: 'internal', extract: false }] ] as const;
  const extra = { path: '/nonexistent/local-source.pdf', processor: { renderer: '/nonexistent/renderer' }, output: '/nonexistent/output.png',
    root: '/nonexistent/vault', credentials: 'SYNTHETIC_VALUE', modelUrl: 'https://invalid.example', args: ['untrusted'],
    grant: 'untrusted', pdfOriginal: {}, processing: { pages: [1] } };
  return { root, vault, saved, env, cases, extra, head: await vault.git.run(['rev-parse','HEAD']) };
}

test('MCP: all tool roots are closed and valid get/version/capture payloads with unknown host fields refuse before effects', async t => {
  const f = await fixture(t), client = new Client({ name: 'strict-fields-test', version: '1' });
  const marker = join(f.root, 'callbacks'), guard = join(f.root, 'callback-guard.mjs');
  await writeFile(guard, `import {MemoryVault} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'dist/vault.js')).href)};import{appendFileSync}from'node:fs';for(const key of ['get','capture','config']){const original=MemoryVault.prototype[key];MemoryVault.prototype[key]=function(...args){appendFileSync(${JSON.stringify(marker)},key+'\\n');return original.apply(this,args);};}`);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import',guard,join(process.cwd(),'dist/mcp.js'),f.vault.root], env: f.env, stderr: 'pipe' }));
  try {
    const valid = await client.callTool({ name: 'memory_get', arguments: { id: f.saved.evidenceId } }); assert.notEqual(valid.isError, true);
    assert.match(await readFile(marker, 'utf8'), /get/); await writeFile(marker, '');
    for (const [name, args] of f.cases) for (const [field, value] of Object.entries(f.extra)) {
      const rejected = await client.callTool({ name, arguments: { ...args, [field]: value } });
      assert.equal(rejected.isError, true, `${name} must reject unsupported ${field}`);
    }
    assert.equal(await readFile(marker, 'utf8'), '', 'Unsupported arguments must refuse before a vault callback');
    for (const tool of (await client.listTools()).tools) {
      // Unions advertise each closed alternative rather than a single object root.
      const variants = (tool.inputSchema as any).anyOf ?? (tool.inputSchema as any).oneOf ?? [tool.inputSchema];
      for (const schema of variants) assert.equal(schema.additionalProperties, false, `${tool.name} must advertise strict arguments`);
    }
    assert.equal(await f.vault.git.run(['rev-parse','HEAD']), f.head); assert.equal((await f.vault.listRecords({ collection: 'evidence' })).total, 1);
    assert.deepEqual(await readdir(join(f.vault.root,'.amem/transactions')), []);
  } finally { await client.close(); }
});

test('Harness: unknown host fields refuse without a canonical mutation', async t => {
  const f = await fixture(t), keys = Object.keys(f.env).filter(key => key.startsWith('AMEM_')), previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = f.env[key];
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); await ctx.plugin(plugin, { vaultRoot: f.vault.root,
      defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000 });
    const valid = await ctx.tools.execute({ name: 'memory_get', callId: 'strict-valid' as Parameters<typeof ctx.tools.execute>[0]['callId'], arguments: { id: f.saved.evidenceId }, signal: new AbortController().signal }); assert.equal(valid.isError, false);
    const callbacks = [t.mock.method(MemoryVault.prototype, 'get'), t.mock.method(MemoryVault.prototype, 'capture'), t.mock.method(MemoryVault.prototype, 'config')];
    for (const [name, args] of f.cases) for (const [field, value] of Object.entries(f.extra)) {
      const rejected = await ctx.tools.execute({ name, callId: `strict-${name}-${field}` as Parameters<typeof ctx.tools.execute>[0]['callId'], arguments: { ...args, [field]: value }, signal: new AbortController().signal });
      assert.equal(rejected.isError, true, `${name} must reject unsupported ${field}`);
    }
    for (const callback of callbacks) { assert.equal(callback.mock.callCount(), 0, 'Unsupported arguments must refuse before a vault callback'); callback.mock.restore(); }
    for (const tool of ctx.tools.schemas().filter(tool => tool.name.startsWith('memory_'))) {
      assert.equal(tool.parameters.additionalProperties, false, `${tool.name} must advertise strict arguments`);
    }
    assert.equal(await f.vault.git.run(['rev-parse','HEAD']), f.head); assert.equal((await f.vault.listRecords({ collection: 'evidence' })).total, 1);
    assert.deepEqual(await readdir(join(f.vault.root,'.amem/transactions')), []);
  } finally {
    await ctx.fiber.dispose(); for (const [key,value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
