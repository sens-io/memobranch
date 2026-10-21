import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { applyPdfImport, previewPdfImport, readPdfOriginal } from '../src/pdf-import.js';
import { MemoryVault } from '../src/vault.js';
import { syntheticPdf } from './pdf-fixture.js';

async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/pdf-adapters-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(join(root, 'vault')); await vault.initialize('PDF model reads');
  const bytes = syntheticPdf(['Visible text; original metadata stays local.']);
  const path = join(root, 'source.pdf'); await writeFile(path, bytes);
  const result = await applyPdfImport(vault, await previewPdfImport(path), { scope: 'public', sensitivity: 'public' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('AMEM_') && entry[0] !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'public', AMEM_MAX_SENSITIVITY: 'public' });
  return { vault, bytes, result, env };
}

test('PDF: real MCP memory_get omits encoded originals while preserving body, identity and read permission', async t => {
  const { vault, bytes, result, env } = await fixture(t);
  const client = new Client({ name: 'pdf-source-consumer', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), vault.root], env, stderr: 'pipe' }));
  try {
    const response = await client.callTool({ name: 'memory_get', arguments: { id: result.evidenceId } });
    assert.notEqual(response.isError, true);
    const serialized = JSON.stringify(response); assert.equal(serialized.includes(bytes.toString('base64')), false); assert.doesNotMatch(serialized, /pdfOriginal/);
    const item = response.content[0]!; assert.equal(item.type, 'text');
    if (item.type === 'text') { const record = JSON.parse(item.text); assert.equal(record.meta.id, result.evidenceId); assert.match(record.body, /## Page 1/); }
    assert.deepEqual(await readPdfOriginal(vault, result.evidenceId), bytes);
  } finally { await client.close(); }
});

test('PDF: real Harness memory_get omits original bytes without changing the canonical stored record', async t => {
  const { vault, bytes, result, env } = await fixture(t);
  const previous = new Map(Object.keys(env).filter(key => key.startsWith('AMEM_')).map(key => [key, process.env[key]]));
  for (const key of previous.keys()) process.env[key] = env[key];
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: vault.root, defaultScope: 'public', defaultSensitivity: 'public', defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000 });
    const response = await ctx.tools.execute({ name: 'memory_get', callId: 'pdf-read' as Parameters<typeof ctx.tools.execute>[0]['callId'], arguments: { id: result.evidenceId }, signal: new AbortController().signal });
    assert.equal(response.isError, false);
    const serialized = JSON.stringify(response); assert.equal(serialized.includes(bytes.toString('base64')), false); assert.doesNotMatch(serialized, /pdfOriginal/);
    assert.match(serialized, /Visible text/);
    assert.deepEqual(await readPdfOriginal(vault, result.evidenceId), bytes);
    const stored = await readFile(join(vault.root, result.evidencePath), 'utf8'); assert.ok(stored.includes(bytes.toString('base64')));
  } finally {
    await ctx.fiber.dispose();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
