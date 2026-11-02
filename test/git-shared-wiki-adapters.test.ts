import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { withFileLock } from '../src/utils.js';
import { integrity, pageKey } from './shared-wiki-fixture.js';
import { gitFixture } from './shared-wiki-git-fixture.js';

const exec = promisify(execFile), catalogName = 'memory_shared_wiki_catalog', snapshotName = 'memory_shared_wiki_snapshot';
function environment(data: Awaited<ReturnType<typeof gitFixture>>): Record<string, string> {
  return Object.assign(Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY')) as Record<string, string>,
    data.env, { AMEM_ACTOR_ID: data.principal.id, AMEM_TENANT_ID: data.principal.tenantId!, AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'project',
      AMEM_MAX_SENSITIVITY: 'secret', AMEM_SHARED_WIKI_CONFIG: data.configPath, AMEM_MASTER_KEY: '31'.repeat(32) });
}
test('Git CLI: actual v2 catalog/read, required pin, offline refusal and unchanged two-vault canonical state', async t => {
  const data = await gitFixture(t), { source, caller, binding, remote, cache, calls, versions } = data;
  const before = await Promise.all([source, caller].map(integrity)), count = calls(), raw = await readFile(join(source.root, versions[0]!.evidencePath));
  const run = (args: string[]) => exec(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'wiki', ...args, '--root', caller.root], { env: environment(data) });
  assert.equal(JSON.parse((await run(['shared-list'])).stdout).sources[0].commit, binding.commit); assert.equal(existsSync(cache), false);
  await assert.rejects(run(['shared-snapshot', binding.id, pageKey])); assert.equal(existsSync(cache), false);
  const result = JSON.parse((await run(['shared-snapshot', binding.id, pageKey, '--expected-commit', binding.commit])).stdout);
  assert.equal(result.source.commit, binding.commit); assert.equal(result.snapshot.authorityHead, before[0]!.head);
  assert.match(JSON.stringify(result), /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(JSON.stringify(result), /DATED_WIKI_CURRENT_CANARY|\.scratch|masterKeyEnv/);
  await rename(remote, remote + '.offline');
  try { await assert.rejects(run(['shared-snapshot', binding.id, pageKey, '--expected-commit', binding.commit])); }
  finally { await rename(remote + '.offline', remote); }
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before); assert.deepEqual(await readFile(join(source.root, versions[0]!.evidencePath)), raw); assert.equal(calls(), count);
});

test('Git CLI: SIGTERM cancels its actual cache refresh waiter without changing canonical data', async t => {
  const data = await gitFixture(t), { source, caller, binding } = data, before = await Promise.all([source, caller].map(integrity));
  const lock = join(caller.root, '.amem/shared-cache', binding.id + '.lock'), acquired = deferred(), release = deferred();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  let command: ReturnType<typeof exec> | undefined;
  try {
    await acquired.promise;
    command = exec(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'wiki', 'shared-snapshot', binding.id, pageKey,
      '--expected-commit', binding.commit, '--root', caller.root], { env: environment(data) });
    const result = command.then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2); assert.equal(existsSync(join(caller.root, '.amem/write.lock')), false);
    command.child.kill('SIGTERM'); const failure = await result; assert.ok(failure); assert.match(failure.stderr, /OPERATION_CANCELLED/);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 1);
  } finally { command?.child.kill('SIGTERM'); release.resolve(); await owner; }
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
});

for (const kind of ['MCP', 'Harness'] as const) {
  test(`Git ${kind}: real SDK private selection, exact old pin and changed host grants`, async t => {
    const data = await gitFixture(t, 'secret'), { source, caller, binding, input, saveBindings, provisionKeys, calls, versions } = data;
    await provisionKeys(); const before = await Promise.all([source, caller].map(integrity)), count = calls();
    const raw = await readFile(join(source.root, versions[0]!.evidencePath));
    await agent(kind, caller.root, environment(data), async (invoke, names) => {
      assert.ok(names.includes(catalogName)); assert.ok(names.includes(snapshotName));
      assert.equal((await invoke(catalogName, {})).sources[0].commit, binding.commit);
      await assert.rejects(invoke(snapshotName, { ...input, includeSecret: false }));
      const result = await invoke(snapshotName, input); assert.equal(result.source.commit, binding.commit); assert.match(JSON.stringify(result), /DATED_WIKI_OLD_CANARY/);
      assert.doesNotMatch(JSON.stringify(result), /DATED_WIKI_CURRENT_CANARY|\.scratch|SHARED_TEST_MASTER_KEY/);
      for (const extra of [{ remote: binding.remote }, { root: source.root }, { principal: caller.principal }, { commit: binding.commit }, { expectedCommit: '0'.repeat(40) }]) {
        await assert.rejects(invoke(snapshotName, { ...input, ...extra }));
      }
      binding.readers[0]!.id = 'withdrawn-reader'; await saveBindings();
      assert.deepEqual((await invoke(catalogName, {})).sources, []); await assert.rejects(invoke(snapshotName, input));
    });
    assert.deepEqual(await Promise.all([source, caller].map(integrity)), before); assert.deepEqual(await readFile(join(source.root, versions[0]!.evidencePath)), raw); assert.equal(calls(), count);
  });
  test(`Git ${kind}: actual per-invocation cancellation releases the cache queue without a caller writer lock`, async t => {
    const data = await gitFixture(t), { source, caller, binding, input } = data, before = await Promise.all([source, caller].map(integrity));
    await agent(kind, caller.root, environment(data), async invoke => {
      const lock = join(caller.root, '.amem/shared-cache', binding.id + '.lock'), acquired = deferred(), release = deferred(), controller = new AbortController();
      const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
      try {
        await acquired.promise; const result = invoke(snapshotName, input, controller.signal).then(() => null, error => error);
        await waitFor(async () => (await readdir(lock + '.queue')).length === 2); assert.equal(existsSync(join(caller.root, '.amem/write.lock')), false);
        controller.abort(); assert.ok(await result); await waitFor(async () => (await readdir(lock + '.queue')).length === 1);
      } finally { controller.abort(); release.resolve(); await owner; }
    });
    assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
  });
}

type Invoke = (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
async function agent(kind: 'MCP' | 'Harness', root: string, env: Record<string, string>, action: (invoke: Invoke, names: string[]) => Promise<void>) {
  if (kind === 'MCP') {
    const client = new Client({ name: 'git-shared-wiki-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      await action(async (name, input, signal) => {
        const result = await client.callTool({ name, arguments: input }, signal ? { signal } : undefined), first = result.content?.[0];
        assert.equal(first?.type, 'text'); if (first?.type !== 'text' || result.isError) throw new Error(first?.type === 'text' ? first.text : 'Missing result'); return JSON.parse(first.text);
      }, (await client.listTools()).tools.map(tool => tool.name));
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, context = new Context(); let sequence = 0;
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('AMEM_') || name === 'OPENAI_API_KEY') delete process.env[name];
    Object.assign(process.env, env); await context.plugin(SystemPrompt, {}); await context.plugin(ToolRuntime, {});
    await context.plugin(plugin, { vaultRoot: root, defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12000 });
    await action(async (name, input, signal = new AbortController().signal) => {
      const result = await context.tools.execute({ name, arguments: input, signal, callId: ('git-shared-' + sequence++) as ToolExecutionInput['callId'] });
      if (result.isError) throw new Error(JSON.stringify(result.error)); return result.value;
    }, context.tools.schemas().map(tool => tool.name));
  } finally {
    await context.fiber.dispose(); for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved);
  }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(predicate: () => Promise<boolean>) { const end = performance.now() + 10000; while (!await predicate()) { assert.ok(performance.now() < end, 'Expected actual Git cache waiter'); await delay(10); } }
