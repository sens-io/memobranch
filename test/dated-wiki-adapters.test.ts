import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { withFileLock } from '../src/utils.js';
import { startWebServer } from '../src/web.js';
import { fixture, masterKey, pageKey } from './dated-wiki-fixture.js';

type Invoke = (input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
const exec = promisify(execFile);

test('dated Wiki CLI: exact timestamp and hash modes coexist; both/neither and malformed dates fail without writes', async t => {
  const { vault, input, env, versions } = await fixture(t), head = await vault.git.run(['rev-parse', 'HEAD']);
  const run = (args: string[]) => exec(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'wiki', 'snapshot', pageKey, ...args, '--root', vault.root], { env });
  const selected = JSON.parse((await run(['--at', input.at])).stdout);
  assert.equal(selected.commit, versions[0]!.commit); assert.equal(selected.selection.at, '2026-01-15T00:00:00.000Z');
  assert.equal(selected.pages.find((page: any) => page.meta.key === pageKey).body, versions[0]!.body);
  const explicit = JSON.parse((await run(['--commit', versions[0]!.commit])).stdout); assert.equal('selection' in explicit, false);
  for (const args of [[], ['--at'], ['--at', input.at, '--commit', head], ['--at', '2026-01-15'], ['--at', '2026-02-30T00:00:00Z']]) await assert.rejects(run(args));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

async function agent(adapter: 'MCP' | 'Harness', root: string, env: Record<string, string>, action: (invoke: Invoke, visible: boolean) => Promise<void>) {
  if (adapter === 'MCP') {
    const client = new Client({ name: 'dated-wiki-tests', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      const tool = (await client.listTools()).tools.find(tool => tool.name === 'memory_wiki_snapshot');
      assert.equal(tool?.annotations?.readOnlyHint, true);
      await action(async (input, signal) => {
        const result = await client.callTool({ name: 'memory_wiki_snapshot', arguments: input }, signal ? { signal } : undefined);
        const content = result.content?.[0]; assert.equal(content?.type, 'text');
        if (content?.type !== 'text') throw new Error('Missing complete JSON result');
        if (result.isError) throw new Error(content.text);
        return JSON.parse(content.text);
      }, Boolean(tool));
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, ctx = new Context(); let callId = 0;
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
    Object.assign(process.env, env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root, defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12000 });
    await action(async (input, signal = new AbortController().signal) => {
      const result = await ctx.tools.execute({ name: 'memory_wiki_snapshot', arguments: input,
        callId: `dated-wiki-${callId++}` as ToolExecutionInput['callId'], signal });
      if (result.isError) throw new Error(JSON.stringify(result.error));
      return result.value;
    }, ctx.tools.schemas().some(tool => tool.name === 'memory_wiki_snapshot'));
  } finally {
    await ctx.fiber.dispose();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

for (const adapter of ['MCP', 'Harness'] as const) {
  test(`${adapter} dated Wiki: real SDK accepts exclusive date/hash selectors and preserves private selection and read authority`, async t => {
    const { vault, input, env, versions } = await fixture(t, 'secret'), head = await vault.git.run(['rev-parse', 'HEAD']);
    await agent(adapter, vault.root, env, async (invoke, visible) => {
      assert.equal(visible, true);
      await assert.rejects(invoke(input), error => !String(error).includes('DATED_WIKI_'));
      const selected = await invoke({ ...input, includeSecret: true });
      assert.equal(selected.commit, versions[0]!.commit); assert.equal(selected.selection.at, '2026-01-15T00:00:00.000Z');
      assert.equal(selected.pages.find((page: any) => page.meta.key === pageKey).body, versions[0]!.body);
      assert.equal('selection' in await invoke({ commit: versions[0]!.commit, pageKeys: [pageKey], includeSecret: true }), false);
      for (const patch of [{ commit: head }, { at: '2026-01-15' }, { signal: {} }, { permissions: ['admin'] }, { root: '/foreign' }, { apply: true }]) {
        await assert.rejects(invoke({ ...input, includeSecret: true, ...patch }));
      }
      await assert.rejects(invoke({ pageKeys: [pageKey] }));
      assert.equal((await invoke({ ...input, includeSecret: true })).commit, versions[0]!.commit, 'denial must not terminate the service');
    });
    await agent(adapter, vault.root, { ...env, AMEM_PERMISSIONS: 'write' }, async (invoke, visible) => {
      if (adapter === 'Harness') assert.equal(visible, false);
      await assert.rejects(invoke({ ...input, includeSecret: true }));
    });
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  });

  test(`${adapter} dated Wiki: actual lock-wait cancellation is owned by this invocation`, async t => {
    const { vault, env, input } = await fixture(t), lock = join(vault.root, '.amem/write.lock');
    await agent(adapter, vault.root, env, async invoke => {
      let entered!: () => void, release!: () => void;
      const acquired = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
      const owner = withFileLock(lock, async () => { entered(); await gate; }), controller = new AbortController();
      try {
        await acquired;
        const pending = invoke(input, controller.signal).then(() => null, error => error);
        await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
        controller.abort(); const error = await pending; assert.ok(error);
        assert.match(String(error), adapter === 'MCP' ? /cancel|abort/i : /OPERATION_CANCELLED/);
        await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1); assert.equal(existsSync(lock), true);
      } finally { controller.abort(); release(); await owner; }
      assert.ok((await invoke(input)).selection);
    });
  });
}

test('dated Wiki HTTP: fixed authenticated route supports dates, keeps hash shape and refuses unknown fields and foreign authority', async t => {
  const { vault, input, llm, versions, cleanup } = await fixture(t), handle = await startWebServer(vault.root, { llm, masterKey }); cleanup.push(() => handle.stop());
  const post = async (data: object, extra: Record<string, string> = {}) => {
    const response = await fetch(handle.url + '/api/wiki-snapshot', { method: 'POST', headers: {
      Origin: handle.url, Authorization: 'Bearer ' + handle.token, 'Content-Type': 'application/json', ...extra,
    }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() as any };
  };
  const head = await vault.git.run(['rev-parse', 'HEAD']), selected = await post(input);
  assert.equal(selected.status, 200); assert.equal(selected.body.result.commit, versions[0]!.commit);
  assert.equal(selected.body.result.pages.find((page: any) => page.meta.key === pageKey).body, versions[0]!.body);
  assert.equal('selection' in (await post({ commit: versions[0]!.commit, pageKeys: [pageKey] })).body.result, false);
  for (const patch of [{ commit: head }, { at: '2026-01-15' }, { root: '/foreign' }, { signal: {} }, { apply: true }, { pageKeys: [pageKey, pageKey] }]) assert.equal((await post({ ...input, ...patch })).status, 400);
  assert.equal((await post(input, { Authorization: 'Bearer wrong' })).status, 403);
  assert.equal((await post(input, { Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!await predicate()) { assert.ok(Date.now() < deadline, 'Expected actual lock state'); await delay(10); }
}
