import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
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
import { startWebServer } from '../src/web.js';
import { integrity, pageKey } from './shared-wiki-fixture.js';
import { cloudClientFixture, cloudCredential } from './cloud-shared-wiki-client-fixture.js';

const exec = promisify(execFile), catalogName = 'memory_shared_wiki_catalog', snapshotName = 'memory_shared_wiki_snapshot';
function environment(data: Awaited<ReturnType<typeof cloudClientFixture>>): Record<string, string> {
  return Object.assign(Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY')) as Record<string, string>,
    { AMEM_ACTOR_ID: data.principal.id, AMEM_TENANT_ID: data.principal.tenantId!, AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'project',
      AMEM_MAX_SENSITIVITY: 'secret', AMEM_SHARED_WIKI_CONFIG: data.configPath, CLOUD_TEST_CREDENTIAL: cloudCredential });
}
test('cloud CLI: real service read via v2 binding, mandatory pin, safe failures and unchanged three-vault state', async t => {
  const data = await cloudClientFixture(t), { source, broker, caller, selection, binding, saveAccounts } = data;
  const before = await Promise.all([source, broker, caller].map(integrity)), env = environment(data);
  const run = (args: string[], overrides: Record<string, string> = {}) => exec(process.execPath,
    [join(process.cwd(), 'dist/cli.js'), 'wiki', ...args, '--root', caller.root], { env: { ...env, ...overrides } });
  assert.equal(JSON.parse((await run(['shared-list'])).stdout).sources[0].id, binding.id);
  const result = JSON.parse((await run(['shared-snapshot', binding.id, pageKey, '--expected-commit', binding.commit])).stdout);
  assert.equal(result.snapshot.commit, binding.commit); assert.match(JSON.stringify(result), /DATED_WIKI_OLD_CANARY/);
  assert.equal(JSON.stringify(result).includes(cloudCredential), false); assert.doesNotMatch(JSON.stringify(result), /credentialEnv|\.scratch/);
  await assert.rejects(run(['shared-snapshot', binding.id, pageKey]));
  await assert.rejects(run(['shared-snapshot', binding.id, pageKey, '--expected-commit', binding.commit], { CLOUD_TEST_CREDENTIAL: '' }));
  await saveAccounts([]); await assert.rejects(run(['shared-snapshot', binding.id, pageKey, '--expected-commit', selection.expectedCommit]));
  assert.deepEqual(await Promise.all([source, broker, caller].map(integrity)), before);
});

for (const kind of ['MCP', 'Harness'] as const) {
  test(`cloud ${kind}: real SDK uses the configured remote, private selection and current grant checks`, async t => {
    const data = await cloudClientFixture(t, 'secret'), { source, broker, caller, selection, binding, saveAccounts } = data;
    const before = await Promise.all([source, broker, caller].map(integrity));
    await agent(kind, caller.root, environment(data), async (invoke, names) => {
      assert.ok(names.includes(catalogName)); assert.ok(names.includes(snapshotName));
      assert.equal((await invoke(catalogName, {})).sources[0].id, binding.id);
      await assert.rejects(invoke(snapshotName, { ...selection, includeSecret: false }));
      const result = await invoke(snapshotName, selection); assert.equal(result.snapshot.commit, binding.commit);
      assert.match(JSON.stringify(result), /DATED_WIKI_OLD_CANARY/); assert.equal(JSON.stringify(result).includes(cloudCredential), false);
      for (const extra of [{ origin: binding.origin }, { credentialEnv: binding.credentialEnv }, { principal: caller.principal }, { commit: binding.commit }]) {
        await assert.rejects(invoke(snapshotName, { ...selection, ...extra }));
      }
      await saveAccounts([]); await assert.rejects(invoke(snapshotName, selection));
    });
    assert.deepEqual(await Promise.all([source, broker, caller].map(integrity)), before);
  });
}

test('cloud Web: authenticated local management API keeps cloud credentials on the host and remote cancellation releases the actual source waiter', async t => {
  const data = await cloudClientFixture(t), { source, broker, caller, selection, configPath, principal } = data;
  const previous = process.env.CLOUD_TEST_CREDENTIAL; process.env.CLOUD_TEST_CREDENTIAL = cloudCredential;
  const handle = await startWebServer(caller.root, { principal, sharedWikiConfig: configPath });
  try {
    const call = async (name: string, body: object, signal?: AbortSignal) => {
      const response = await fetch(handle.url + '/api/' + name, { method: 'POST', headers: {
        Origin: handle.url, Authorization: 'Bearer ' + handle.token, 'Content-Type': 'application/json',
      }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
      return { status: response.status, value: await response.json() as any };
    };
    const before = await Promise.all([source, broker, caller].map(integrity));
    const catalog = await call('shared-catalog', {}); assert.equal(catalog.status, 200); assert.equal(catalog.value.result.configured, true);
    const view = await call('shared-snapshot', selection); assert.equal(view.status, 200); assert.match(JSON.stringify(view.value), /DATED_WIKI_OLD_CANARY/);
    assert.equal(JSON.stringify(view.value).includes(cloudCredential), false); assert.doesNotMatch(JSON.stringify(catalog.value), /credentialEnv|origin|caFile/);
    assert.equal((await call('shared-snapshot', { ...selection, token: cloudCredential })).status, 400);
    const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred(), controller = new AbortController();
    const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
    try {
      await acquired.promise; const pending = call('shared-snapshot', selection, controller.signal).then(() => null, error => error);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2); controller.abort(); assert.ok(await pending);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
    } finally { controller.abort(); release.resolve(); await owner; }
    assert.deepEqual(await Promise.all([source, broker, caller].map(integrity)), before);
  } finally { await handle.stop(); if (previous === undefined) delete process.env.CLOUD_TEST_CREDENTIAL; else process.env.CLOUD_TEST_CREDENTIAL = previous; }
});

type Invoke = (name: string, input: Record<string, unknown>) => Promise<any>;
async function agent(kind: 'MCP' | 'Harness', root: string, env: Record<string, string>, action: (invoke: Invoke, names: string[]) => Promise<void>) {
  if (kind === 'MCP') {
    const client = new Client({ name: 'cloud-shared-wiki-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      await action(async (name, input) => { const result = await client.callTool({ name, arguments: input }); const first = result.content?.[0];
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
    await action(async (name, input) => {
      const result = await context.tools.execute({ name, arguments: input, signal: new AbortController().signal, callId: ('cloud-' + sequence++) as ToolExecutionInput['callId'] });
      if (result.isError) throw new Error(JSON.stringify(result.error)); return result.value;
    }, context.tools.schemas().map(tool => tool.name));
  } finally {
    await context.fiber.dispose(); for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved);
  }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(predicate: () => Promise<boolean>) { const end = performance.now() + 5000; while (!await predicate()) { assert.ok(performance.now() < end, 'Expected actual remote source wait'); await delay(10); } }
