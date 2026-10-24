import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
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
import { integrity, pageKey, sharedFixture } from './shared-wiki-fixture.js';

const exec = promisify(execFile), catalogName = 'memory_shared_wiki_catalog', snapshotName = 'memory_shared_wiki_snapshot';
type Invoke = (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
function environment(fixture: Awaited<ReturnType<typeof sharedFixture>>): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY')) as Record<string, string>;
  return Object.assign(env, { AMEM_ACTOR_ID: fixture.principal.id, AMEM_ACTOR_NAME: fixture.principal.name, AMEM_TENANT_ID: fixture.callerConfig.tenantId,
    AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: 'secret', AMEM_MASTER_KEY: '31'.repeat(32),
    AMEM_SHARED_WIKI_CONFIG: fixture.configPath, SHARED_TEST_MASTER_KEY: fixture.env.SHARED_TEST_MASTER_KEY! });
}
async function agent(kind: 'MCP' | 'Harness', root: string, env: Record<string, string>, action: (invoke: Invoke, names: string[]) => Promise<void>, explicitConfig?: string) {
  if (kind === 'MCP') {
    const client = new Client({ name: 'shared-wiki-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      const tools = (await client.listTools()).tools;
      for (const tool of tools.filter(tool => tool.name.startsWith('memory_shared_wiki_'))) assert.equal(tool.annotations?.readOnlyHint, true);
      await action(async (name, input, signal) => {
        const result = await client.callTool({ name, arguments: input }, signal ? { signal } : undefined);
        const first = result.content?.[0]; assert.equal(first?.type, 'text'); if (first?.type !== 'text') throw new Error('Missing complete JSON result');
        if (result.isError) throw new Error(first.text); return JSON.parse(first.text);
      }, tools.map(tool => tool.name));
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, ctx = new Context(); let sequence = 0;
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('AMEM_') || name === 'OPENAI_API_KEY') delete process.env[name];
    Object.assign(process.env, env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root, sharedWikiConfig: explicitConfig ?? '',
      defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12000 });
    await action(async (name, input, signal = new AbortController().signal) => {
      const result = await ctx.tools.execute({ name, arguments: input, signal, callId: `shared-${sequence++}` as ToolExecutionInput['callId'] });
      if (result.isError) throw new Error(JSON.stringify(result.error)); return result.value;
    }, ctx.tools.schemas().map(tool => tool.name));
  } finally {
    await ctx.fiber.dispose(); for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved);
  }
}

test('shared Wiki CLI: configured catalog and fixed old content; no path/pin/grant overrides or read side effects', async t => {
  const fixture = await sharedFixture(t), { source, caller, input, binding } = fixture, env = environment(fixture);
  const run = (action: string, args: string[], overrides: Record<string, string> = {}) => exec(process.execPath,
    [join(process.cwd(), 'dist/cli.js'), 'wiki', action, ...args, '--root', caller.root], { env: { ...env, ...overrides } });
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller);
  const catalog = JSON.parse((await run('shared-list', [])).stdout); assert.equal(catalog.sources[0].id, binding.id);
  const result = JSON.parse((await run('shared-snapshot', [binding.id, pageKey])).stdout);
  assert.equal(result.snapshot.commit, binding.commit); assert.match(result.snapshot.pages.find((page: any) => page.meta.key === pageKey).body, /DATED_WIKI_OLD_CANARY/);
  assert.doesNotMatch(JSON.stringify(result), /DATED_WIKI_CURRENT_CANARY/);
  for (const args of [[binding.id, pageKey, '--commit', beforeSource.head], [binding.id, pageKey, '--file', fixture.configPath],
    [binding.id, pageKey, '--confirm'], [binding.id, pageKey, '--include-secret=true=garbage'], [source.root, pageKey], [binding.id, pageKey, pageKey]]) await assert.rejects(run('shared-snapshot', args));
  await assert.rejects(run('shared-list', [binding.id])); await assert.rejects(run('shared-list', [], { AMEM_SHARED_WIKI_CONFIG: '' }));
  await assert.rejects(run('shared-snapshot', [binding.id, pageKey], { AMEM_ACTOR_ID: 'foreign' }));
  await assert.rejects(run('shared-snapshot', [binding.id, pageKey], { AMEM_PERMISSIONS: 'write' }));
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
});

test('shared Wiki CLI: SIGTERM interrupts a real source lock wait without affecting source or caller', async t => {
  const fixture = await sharedFixture(t), { source, caller, binding } = fixture, lock = join(source.root, '.amem/write.lock');
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller), acquired = deferred(), release = deferred();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; }); let command: ReturnType<typeof exec> | undefined;
  try {
    await acquired.promise; command = exec(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'wiki', 'shared-snapshot', binding.id, pageKey, '--root', caller.root], { env: environment(fixture) });
    const outcome = command.then(() => null, error => error); await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
    command.child.kill('SIGTERM'); const error = await outcome; assert.equal(error?.code, 130); assert.match(error.stderr, /OPERATION_CANCELLED/);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
  } finally { command?.child.kill('SIGTERM'); release.resolve(); await owner; }
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
});

for (const kind of ['MCP', 'Harness'] as const) {
  test(`${kind} shared Wiki: real SDK enforces private selection, strict host authority and current source withdrawal`, async t => {
    const fixture = await sharedFixture(t, 'secret'), { source, caller, input, binding } = fixture, env = environment(fixture);
    const beforeSource = await integrity(source), beforeCaller = await integrity(caller);
    await agent(kind, caller.root, env, async (invoke, names) => {
      assert.deepEqual(names.filter(name => name.startsWith('memory_shared_wiki_')).sort(), [catalogName, snapshotName]);
      const catalog = await invoke(catalogName, {}); assert.equal(catalog.sources[0].id, binding.id); assert.equal('root' in catalog.sources[0], false);
      await assert.rejects(invoke(snapshotName, { ...input, includeSecret: false }));
      const result = await invoke(snapshotName, input); assert.equal(result.snapshot.commit, binding.commit);
      assert.match(result.snapshot.pages.find((page: any) => page.meta.key === pageKey).body, /DATED_WIKI_OLD_CANARY/);
      for (const extra of [{ root: source.root }, { commit: beforeSource.head }, { tenantId: fixture.sourceConfig.tenantId }, { principal: caller.principal },
        { permissions: ['admin'] }, { masterKeyEnv: 'SHARED_TEST_MASTER_KEY' }, { signal: {} }, { apply: true }, { pageKeys: [pageKey, pageKey] }]) await assert.rejects(invoke(snapshotName, { ...input, ...extra }));
      await assert.rejects(invoke(catalogName, { sourceId: binding.id }));
      assert.equal((await invoke(snapshotName, input)).snapshot.commit, binding.commit);
      assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
      await source.wikiRevoke(pageKey, 'Withdraw shared adapter source'); await assert.rejects(invoke(snapshotName, input));
    });
  });

  test(`${kind} shared Wiki: unconfigured/unauthorized hosts do not gain read capability`, async t => {
    const fixture = await sharedFixture(t), { caller, input, configPath } = fixture;
    const empty = environment(fixture); delete empty.AMEM_SHARED_WIKI_CONFIG;
    await agent(kind, caller.root, empty, async (invoke, names) => {
      assert.equal(names.some(name => name.startsWith('memory_shared_wiki_')), false); await assert.rejects(invoke(snapshotName, input));
    });
    await agent(kind, caller.root, { ...environment(fixture), AMEM_ACTOR_ID: 'foreign' }, async invoke => {
      assert.deepEqual((await invoke(catalogName, {})).sources, []); await assert.rejects(invoke(snapshotName, input));
    });
    await agent(kind, caller.root, { ...environment(fixture), AMEM_PERMISSIONS: 'write' }, async (invoke, names) => {
      if (kind === 'Harness') assert.equal(names.some(name => name.startsWith('memory_shared_wiki_')), false);
      await assert.rejects(invoke(catalogName, {})); await assert.rejects(invoke(snapshotName, input));
    });
    if (kind === 'Harness') await agent(kind, caller.root, empty, async invoke => { assert.ok((await invoke(snapshotName, input)).snapshot.commit); }, configPath);
  });

  test(`${kind} shared Wiki: real source lock wait cancellation leaves the service usable and state unchanged`, async t => {
    const fixture = await sharedFixture(t), { source, caller, input } = fixture, lock = join(source.root, '.amem/write.lock');
    const beforeSource = await integrity(source), beforeCaller = await integrity(caller);
    await agent(kind, caller.root, environment(fixture), async invoke => {
      const acquired = deferred(), release = deferred(), controller = new AbortController(), owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
      try {
        await acquired.promise; const pending = invoke(snapshotName, input, controller.signal).then(() => null, error => error);
        await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); controller.abort();
        const error = await pending; assert.ok(error); assert.match(String(error), kind === 'MCP' ? /cancel|abort/i : /OPERATION_CANCELLED/);
        await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
      } finally { controller.abort(); release.resolve(); await owner; }
      assert.equal((await invoke(snapshotName, input)).snapshot.commit, fixture.binding.commit);
    });
    assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
  });
}

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(predicate: () => Promise<boolean>) { const end = performance.now() + 4000; while (!await predicate()) { assert.ok(performance.now() < end, 'Expected actual lock state'); await delay(10); } }
