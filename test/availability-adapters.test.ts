import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
import { fixture, pageKey } from './dated-wiki-fixture.js';

const exec = promisify(execFile), observeName = 'memory_wiki_observe', readName = 'memory_wiki_as_known_at';
type Invoke = (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;

async function agent(kind: 'MCP' | 'Harness', root: string, env: Record<string, string>, action: (invoke: Invoke, names: string[]) => Promise<void>) {
  if (kind === 'MCP') {
    const client = new Client({ name: 'availability-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      const tools = (await client.listTools()).tools;
      assert.equal(tools.find(tool => tool.name === observeName)?.annotations?.readOnlyHint, false);
      assert.equal(tools.find(tool => tool.name === observeName)?.annotations?.idempotentHint, false);
      assert.equal(tools.find(tool => tool.name === readName)?.annotations?.readOnlyHint, true);
      await action(async (name, input, signal) => {
        const result = await client.callTool({ name, arguments: input }, signal ? { signal } : undefined);
        const first = result.content?.[0]; assert.equal(first?.type, 'text');
        if (first?.type !== 'text') throw new Error('Missing complete JSON result');
        if (result.isError) throw new Error(first.text);
        return JSON.parse(first.text);
      }, tools.map(tool => tool.name));
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, ctx = new Context(); let sequence = 0;
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
    Object.assign(process.env, env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root, defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12000 });
    await action(async (name, input, signal = new AbortController().signal) => {
      const result = await ctx.tools.execute({ name, arguments: input, signal, callId: `availability-${sequence++}` as ToolExecutionInput['callId'] });
      if (result.isError) throw new Error(JSON.stringify(result.error));
      return result.value;
    }, ctx.tools.schemas().map(tool => tool.name));
  } finally {
    await ctx.fiber.dispose();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test('availability CLI: explicit save, exact observed version, unknown legacy and strict selectors without query writes', async t => {
  const { vault, root, env, calls } = await fixture(t);
  const run = (action: string, args: string[], permissions = 'read,write') => exec(process.execPath,
    [join(process.cwd(), 'dist/cli.js'), 'wiki', action, pageKey, ...args, '--root', root], { env: { ...env, AMEM_PERMISSIONS: permissions } });
  const at = new Date().toISOString();
  assert.equal(JSON.parse((await run('as-known-at', ['--at', at])).stdout).items[0].status, 'unknown');
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const args of [[], ['--confirm=false'], ['--confirm', '--observed-at=2001-01-01T00:00:00Z'], ['--confirm', '--include-secret=garbage']]) {
    await assert.rejects(run('observe', args));
  }
  await assert.rejects(run('observe', ['--confirm'], 'read'));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const observed = JSON.parse((await run('observe', ['--confirm'])).stdout);
  assert.match(observed.evidenceId, /^ev-[a-f0-9]{12}$/);
  const third = await vault.capture({ content: 'ADAPTER_NEWER_VERSION_CANARY', scope: 'project', extract: false });
  await vault.wikiIngest({ evidenceIds: [third.evidenceId], apply: true });
  const current = await vault.wikiSnapshot({ commit: await vault.git.run(['rev-parse', 'HEAD']), pageKeys: [pageKey] });
  assert.match(current.pages.find(page => page.meta.key === pageKey)!.body, /ADAPTER_NEWER_VERSION_CANARY/);
  const savedHead = await vault.git.run(['rev-parse', 'HEAD']), count = calls();
  const selected = JSON.parse((await run('as-known-at', ['--at', observed.observedAt, '--observations', observed.evidenceId], 'read')).stdout);
  assert.equal(selected.items[0].status, 'observed'); assert.equal(selected.coverage.mode, 'explicit-observation-ids');
  assert.match(selected.items[0].snapshot.pages.find((page: any) => page.meta.key === pageKey).body, /DATED_WIKI_CURRENT_CANARY/);
  assert.doesNotMatch(JSON.stringify(selected), /ADAPTER_NEWER_VERSION_CANARY/);
  for (const args of [[], ['--at', '2001-01-01'], ['--at', at, '--observations='], ['--at', at, '--observations', observed.evidenceId + ','], ['--at', at, '--commit', savedHead], ['--at', at, '--confirm']]) {
    await assert.rejects(run('as-known-at', args));
  }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), savedHead); assert.equal(calls(), count);
});

test('availability CLI: SIGTERM cancels actual observation/read lock waits without a write', async t => {
  const { vault, root, env } = await fixture(t);
  for (const [action, flags] of [['observe', ['--confirm']], ['as-known-at', ['--at', new Date().toISOString()]]] as const) {
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const lock = join(root, '.amem/write.lock'), head = await vault.git.run(['rev-parse', 'HEAD']);
    const owner = withFileLock(lock, async () => { entered(); await gate; });
    let command: ReturnType<typeof exec> | undefined;
    try {
      await acquired;
      command = exec(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'wiki', action, pageKey, ...flags, '--root', root],
        { env: { ...env, AMEM_PERMISSIONS: 'read,write' } });
      const outcome = command.then(() => null, error => error);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
      command.child.kill('SIGTERM'); const error = await outcome;
      assert.ok(error); assert.equal(error.code, 130); assert.match(error.stderr, /OPERATION_CANCELLED/);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
    } finally { command?.child.kill('SIGTERM'); release(); await owner; }
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  }
});

for (const kind of ['MCP', 'Harness'] as const) {
  test(`${kind} availability: real SDK keeps observation, read-only unknown/history, private selection and withdrawal distinct`, async t => {
    const { vault, root, env, calls } = await fixture(t, 'secret');
    await agent(kind, root, { ...env, AMEM_PERMISSIONS: 'read,write' }, async (invoke, names) => {
      assert.ok(names.includes(observeName)); assert.ok(names.includes(readName));
      const input = { pageKeys: [pageKey] }, at = new Date().toISOString(), head = await vault.git.run(['rev-parse', 'HEAD']);
      const unknown = await invoke(readName, { ...input, at }); assert.equal(unknown.items[0].status, 'unknown');
      assert.doesNotMatch(JSON.stringify(unknown), /DATED_WIKI_CURRENT_CANARY/);
      await assert.rejects(invoke(observeName, { ...input, confirm: true }));
      for (const patch of [{ confirm: false }, { observedAt: at }, { actorId: 'other' }, { tenantId: 'other' }, { signal: {} }, { root: '/foreign' }, { pageKeys: [pageKey, pageKey] }]) {
        await assert.rejects(invoke(observeName, { ...input, confirm: true, includeSecret: true, ...patch }));
      }
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
      const observed = await invoke(observeName, { ...input, confirm: true, includeSecret: true });
      const query = { ...input, at: observed.observedAt, includeSecret: true, observationIds: [observed.evidenceId] };
      const saved = await vault.git.run(['rev-parse', 'HEAD']), count = calls();
      const result = await invoke(readName, query); assert.equal(result.items[0].status, 'observed');
      assert.equal(result.items[0].snapshot.commit, observed.observedCommit); assert.match(result.warnings.join(' '), /outside that set/);
      assert.match(result.items[0].snapshot.pages.find((page: any) => page.meta.key === pageKey).body, /DATED_WIKI_CURRENT_CANARY/);
      for (const patch of [{ commit: saved }, { permissions: ['admin'] }, { signal: {} }, { apply: true }, { at: '2001-01-01' }, { observationIds: [] }]) await assert.rejects(invoke(readName, { ...query, ...patch }));
      assert.equal((await invoke(readName, query)).items[0].status, 'observed');
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), saved); assert.equal(calls(), count);
      await vault.wikiRevoke(pageKey, 'Withdraw adapter fixture');
      await assert.rejects(invoke(readName, query));
    });
  });

  test(`${kind} availability: missing read/write grants do not permit observations or foreign-tenant reads`, async t => {
    const { root, env, vault } = await fixture(t);
    for (const permissions of ['read', 'write']) await agent(kind, root, { ...env, AMEM_PERMISSIONS: permissions }, async (invoke, names) => {
      if (kind === 'Harness') { assert.equal(names.includes(observeName), false); assert.equal(names.includes(readName), permissions === 'read'); }
      const head = await vault.git.run(['rev-parse', 'HEAD']);
      await assert.rejects(invoke(observeName, { pageKeys: [pageKey], confirm: true }));
      if (permissions === 'write') await assert.rejects(invoke(readName, { pageKeys: [pageKey], at: new Date().toISOString() }));
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
    });
    await agent(kind, root, { ...env, AMEM_TENANT_ID: 'foreign' }, async invoke => {
      await assert.rejects(invoke(readName, { pageKeys: [pageKey], at: new Date().toISOString() }));
    });
  });

  test(`${kind} availability: actual lock-wait cancellation belongs to each invocation and leaves no observation`, async t => {
    const { root, env, vault } = await fixture(t);
    await agent(kind, root, { ...env, AMEM_PERMISSIONS: 'read,write' }, async invoke => {
      for (const [name, input] of [[observeName, { pageKeys: [pageKey], confirm: true }], [readName, { pageKeys: [pageKey], at: new Date().toISOString() }]] as const) {
        let entered!: () => void, release!: () => void;
        const acquired = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
        const lock = join(root, '.amem/write.lock'), head = await vault.git.run(['rev-parse', 'HEAD']);
        const owner = withFileLock(lock, async () => { entered(); await gate; }), controller = new AbortController();
        try {
          await acquired;
          const pending = invoke(name, input, controller.signal).then(() => null, error => error);
          await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
          controller.abort(); const error = await pending; assert.ok(error);
          assert.match(String(error), kind === 'MCP' ? /cancel|abort/i : /OPERATION_CANCELLED/);
          await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
        } finally { controller.abort(); release(); await owner; }
        assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
      }
      assert.equal((await invoke(readName, { pageKeys: [pageKey], at: new Date().toISOString() })).items[0].status, 'unknown');
    });
  });
}

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!await predicate()) { assert.ok(Date.now() < deadline, 'Expected actual lock state'); await delay(10); }
}
