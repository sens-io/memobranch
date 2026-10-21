import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/deepseek-harness.js';
import { MemoryVault } from '../src/vault.js';
import { startWebServer, type WebHandle } from '../src/web.js';

const exec = promisify(execFile), at = '2026-09-01T00:00:00.000Z';
async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/effective-adapters-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root); await vault.initialize('effective adapters');
  const source = await vault.capture({ content: 'Atlas temporal adapter source', scope: 'public', sensitivity: 'public' });
  const candidate = await vault.propose({ key: 'Atlas', statement: 'Atlas temporal fact', kind: 'fact', scope: 'public', sensitivity: 'public',
    confidence: 1, explicit: true, conditions: [], tags: [] }, [source.evidencePath]);
  const memory = await vault.approve(candidate.id);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string>;
  Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'public', AMEM_MAX_SENSITIVITY: 'public' });
  return { vault, memory, env };
}

test('effective adapters: actual CLI annotation requires review, confirmation and current revision', async t => {
  const { vault, memory, env } = await fixture(t);
  const cli = async (args: string[], permissions = 'read,review') => exec(process.execPath,
    ['--import', 'tsx', join(process.cwd(), 'src/cli.ts'), 'memory', ...args, '--root', vault.root], { env: { ...env, AMEM_PERMISSIONS: permissions } });
  const args = ['validity', memory.memoryId, '--from', at, '--until', 'unknown', '--expected-revision', '1'];
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(cli(args), /--confirm/);
  await assert.rejects(cli([...args, '--confirm'], 'read'), /AUTHORIZATION_DENIED/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(JSON.parse((await cli([...args, '--confirm'])).stdout).revision, 2);
  const dated = JSON.parse((await cli(['at', at], 'read')).stdout);
  assert.equal(dated.total, 1); assert.equal(dated.items[0].id, memory.memoryId);
  await assert.rejects(cli([...args, '--confirm']), /revision changed/);
});

test('effective adapters: real MCP and Harness expose read-only dated views without caller authority', async t => {
  const { vault, memory, env } = await fixture(t);
  await vault.setMemoryValidity(memory.memoryId, { validFrom: at, validUntil: null, expectedRevision: 1 });
  const client = new Client({ name: 'effective-tests', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: ['--import', 'tsx', join(process.cwd(), 'src/mcp.ts'), vault.root], env, stderr: 'pipe' }));
    const tool = (await client.listTools()).tools.find(tool => tool.name === 'memory_at');
    assert.equal(tool?.annotations?.readOnlyHint, true);
    const result = await client.callTool({ name: 'memory_at', arguments: { at } });
    assert.equal(result.isError, undefined);
    const content = result.content?.[0]; assert.equal(content?.type, 'text');
    if (content?.type === 'text') assert.equal(JSON.parse(content.text).items[0].id, memory.memoryId);
    assert.equal((await client.callTool({ name: 'memory_at', arguments: { at, principal: { permissions: ['admin'] } } })).isError, true);
  } finally { await client.close(); }
  const keys = ['AMEM_TENANT_ID', 'AMEM_PERMISSIONS', 'AMEM_ALLOWED_SCOPES', 'AMEM_MAX_SENSITIVITY', 'AMEM_ACTOR_ID', 'AMEM_ACTOR_NAME'] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const ctx = new Context();
  try {
    for (const key of keys) delete process.env[key];
    for (const key of keys) if (env[key] !== undefined) process.env[key] = env[key];
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: vault.root, defaultScope: 'user', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000 });
    const result = await ctx.tools.execute({ name: 'memory_at', callId: ToolCallId('dated'), arguments: { at }, signal: new AbortController().signal });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal((result.value as { total: number }).total, 1);
    const denied = await ctx.tools.execute({ name: 'memory_at', callId: ToolCallId('dated-invalid'), arguments: { at, actorId: 'admin' }, signal: new AbortController().signal });
    assert.equal(denied.isError, true);
  } finally {
    await ctx.fiber.dispose();
    for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('effective adapters: authenticated HTTP enforces confirmation, strict schema and read-only authority', async t => {
  const { vault, memory } = await fixture(t);
  const handles: WebHandle[] = [];
  t.after(async () => { await Promise.all(handles.map(handle => handle.stop())); });
  const admin = await startWebServer(vault.root); handles.push(admin);
  const call = async (handle: WebHandle, operation: string, body: object, headers: Record<string, string> = {}) => {
    const response = await fetch(`${handle.url}/api/${operation}`, { method: 'POST', headers: { Origin: handle.url,
      Authorization: `Bearer ${handle.token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { result: any } };
  };
  const update = { id: memory.memoryId, validFrom: at, validUntil: null, expectedRevision: 1 };
  assert.equal((await call(admin, 'memory-validity', update)).status, 400);
  assert.equal((await call(admin, 'memory-validity', { ...update, confirm: true, tenantId: 'other' })).status, 400);
  assert.equal((await call(admin, 'memory-validity', { ...update, confirm: true }, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await call(admin, 'memory-validity', { ...update, confirm: true })).body.result.revision, 2);
  assert.equal((await call(admin, 'memory-validity', { ...update, confirm: true })).status, 400);
  const reader = await startWebServer(vault.root, { principal: { ...vault.principal,
    permissions: ['read'], scopes: ['public'], maxSensitivity: 'public', tenantId: (await vault.config()).tenantId } }); handles.push(reader);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await call(reader, 'memories-at', { at })).body.result.total, 1);
  assert.equal((await call(reader, 'memory-validity', { ...update, expectedRevision: 2, confirm: true })).status, 403);
  assert.equal((await call(reader, 'memories-at', { at, includeSecret: true })).status, 400);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});
