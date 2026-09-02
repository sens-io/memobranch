import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
  const client = new Client({ name: 'agent-memory-wiki-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(process.cwd(), 'src', 'mcp.ts'), root],
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes('memory_context'));
    assert.ok(names.includes('memory_capture'));
    assert.ok(names.includes('memory_review'));
    const result = await client.callTool({ name: 'memory_doctor', arguments: {} });
    assert.equal(result.isError, undefined);
    const first = result.content?.[0];
    assert.equal(first?.type, 'text');
    if (first?.type === 'text') assert.match(first.text, /"healthy": true/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
