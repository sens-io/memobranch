import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MemoryVault } from '../src/vault.js';

test('MCP server negotiates, lists tools, and calls the vault', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amem-mcp-test-'));
  const vault = new MemoryVault(root);
  await vault.initialize('mcp-test');
  const client = new Client({ name: 'memobranch-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(process.cwd(), 'src', 'mcp.ts'), root],
    env: { ...process.env, AMEM_PERMISSIONS: 'read,write,maintain', AMEM_MAX_SENSITIVITY: 'internal', AMEM_ACTOR_ID: 'server-test', AMEM_ACTOR_NAME: 'Server Test' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes('memory_context'));
    assert.ok(names.includes('memory_capture'));
    assert.ok(names.includes('memory_review'));
    const captureTool = listed.tools.find((tool) => tool.name === 'memory_capture');
    assert.doesNotMatch(JSON.stringify(captureTool?.inputSchema), /actorId|actorName|permissions/);
    const searchTool = listed.tools.find((tool) => tool.name === 'memory_search');
    const contextTool = listed.tools.find((tool) => tool.name === 'memory_context');
    const recoverTool = listed.tools.find((tool) => tool.name === 'memory_recover');
    const maintenanceTool = listed.tools.find((tool) => tool.name === 'memory_maintenance');
    const forgetTool = listed.tools.find((tool) => tool.name === 'memory_forget');
    const remoteStatusTool = listed.tools.find((tool) => tool.name === 'memory_remote_status');
    assert.equal(captureTool?.annotations?.idempotentHint, false);
    assert.equal(searchTool?.annotations?.readOnlyHint, false);
    assert.equal(contextTool?.annotations?.readOnlyHint, false);
    assert.equal(forgetTool?.annotations?.destructiveHint, true);
    assert.equal(forgetTool?.annotations?.idempotentHint, false);
    assert.equal(remoteStatusTool?.annotations?.readOnlyHint, false);
    assert.equal(recoverTool?.annotations?.destructiveHint, true);
    assert.equal(maintenanceTool?.annotations?.destructiveHint, true);
    const denied = await client.callTool({ name: 'memory_review', arguments: { action: 'approve', candidateId: 'not-present' } });
    assert.equal(denied.isError, true);
    const deniedText = denied.content?.[0];
    if (deniedText?.type === 'text') assert.match(deniedText.text, /AUTHORIZATION_DENIED/);
    const result = await client.callTool({ name: 'memory_doctor', arguments: {} });
    assert.equal(result.isError, undefined);
    const first = result.content?.[0];
    assert.equal(first?.type, 'text');
    if (first?.type === 'text') assert.match(first.text, /"healthy": true/);
    const captured = await client.callTool({ name: 'memory_capture', arguments: { content: 'server-owned identity evidence' } });
    assert.equal(captured.isError, undefined);
    const history = await vault.history();
    assert.equal(history[0]?.author, 'Server Test');
    assert.match(await readFile(join(root, '.amem', 'audit.jsonl'), 'utf8'), /"principalId":"server-test"/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
