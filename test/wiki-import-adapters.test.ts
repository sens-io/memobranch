import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { SharedWikiImporter, sharedWikiImportApplySchema } from '../src/shared-wiki-import.js';
import { wikiIntegrationToolSchema, wikiToolInput, wikiToolResult } from '../src/wiki-tool.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId } from '../src/wiki-schema.js';
import { withFileLock } from '../src/utils.js';
import { integrity, pageKey, sharedFixture } from './shared-wiki-fixture.js';

const exec = promisify(execFile), copyPrepare = 'memory_shared_wiki_import_prepare', copyApply = 'memory_shared_wiki_import_apply';
const integrate = 'memory_wiki_integration_prepare', approve = 'memory_wiki_apply';
type Kind = 'MCP' | 'Harness';
type Invoke = (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;

async function fixture(t: TestContext, secret = false) {
  const data = await sharedFixture(t, secret ? 'secret' : 'internal');
  data.principal.permissions = ['read', 'write', 'review'];
  const env = Object.assign(Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMEM_') && name !== 'OPENAI_API_KEY')) as Record<string, string>, {
    AMEM_ACTOR_ID: data.principal.id, AMEM_TENANT_ID: data.callerConfig.tenantId, AMEM_PERMISSIONS: 'read,write,review',
    AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: 'secret', AMEM_MASTER_KEY: '31'.repeat(32),
    AMEM_SHARED_WIKI_CONFIG: data.configPath, SHARED_TEST_MASTER_KEY: data.env.SHARED_TEST_MASTER_KEY!,
  });
  const selection = { ...data.input, expectedCommit: data.binding.commit };
  const importer = new SharedWikiImporter(data.caller, { configPath: data.configPath, env: data.env });
  const draft = (evidenceId: string) => ({ evidenceId, pageKey: 'concept:adapter-import', expectedRevision: 0,
    title: 'Reviewed adapter import', summary: 'Human-authored integration.', body: 'ADAPTER_AUTHORED_CANARY 中文 🧠📚',
    includeSecret: secret, conditions: ['Human review is specific to this project.'], uncertainty: ['Needs external verification.'] });
  const run = (args: string[], overrides: Record<string, string> = {}) => exec(process.execPath,
    [join(process.cwd(), 'dist/cli.js'), 'wiki', ...args, '--root', data.caller.root], { env: { ...env, ...overrides }, maxBuffer: 10 * 1_048_576 });
  const file = async (name: string, value: unknown) => {
    const path = join(data.caller.root, '.amem', name + '.json'); await writeFile(path, JSON.stringify(value), { mode: 0o600 }); return path;
  };
  return { ...data, env, selection, importer, draft, run, file };
}

async function agent(kind: Kind, root: string, env: Record<string, string>, action: (invoke: Invoke, names: string[], dispose: () => Promise<void>) => Promise<void>) {
  if (kind === 'MCP') {
    const client = new Client({ name: 'wiki-import-adapter-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      const tools = (await client.listTools()).tools;
      for (const tool of tools.filter(tool => [copyPrepare, copyApply, integrate].includes(tool.name))) assert.equal(tool.annotations?.readOnlyHint, false);
      await action(async (name, input, signal) => {
        const result = await client.callTool({ name, arguments: input }, signal ? { signal } : undefined);
        const first = result.content?.[0]; assert.equal(first?.type, 'text'); if (first?.type !== 'text') throw new Error('Missing complete JSON');
        if (result.isError) throw new Error(first.text); return JSON.parse(first.text);
      }, tools.map(tool => tool.name), () => client.close());
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, ctx = new Context(); let sequence = 0, disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= Promise.resolve(ctx.fiber.dispose()).then(() => {});
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('AMEM_') || name === 'OPENAI_API_KEY') delete process.env[name];
    Object.assign(process.env, env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root, sharedWikiConfig: '', defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12000 });
    await action(async (name, input, signal = new AbortController().signal) => {
      const result = await ctx.tools.execute({ name, arguments: input, signal, callId: `wiki-import-${sequence++}` as ToolExecutionInput['callId'] });
      if (result.isError) throw new Error(JSON.stringify(result.error)); return result.value;
    }, ctx.tools.schemas().map(tool => tool.name), dispose);
  } finally { await dispose(); for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved); }
}

test('Wiki import CLI: complete fixed-version copy, separately authored integration/update and exact retry preserve evidence', async t => {
  const data = await fixture(t), { source, caller, callerAdmin, binding, run, file, draft, calls } = data;
  const before = await Promise.all([source, caller].map(integrity)), count = calls();
  const prepared = JSON.parse((await run(['import-prepare', binding.id, pageKey, '--expected-commit', binding.commit])).stdout);
  assert.match(JSON.stringify(prepared), /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(JSON.stringify(prepared), /DATED_WIKI_CURRENT_CANARY/);
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
  const copyFile = await file('copy', prepared);
  await assert.rejects(run(['import-apply', '--file', copyFile]));
  const copied = JSON.parse((await run(['import-apply', '--file', copyFile, '--confirm'])).stdout), bytes = await readFile(join(caller.root, copied.evidencePath));
  assert.equal(copied.duplicate, false); assert.deepEqual(await callerAdmin.wikiCatalog(), []);
  assert.equal(JSON.parse((await run(['import-apply', '--file', copyFile, '--confirm'])).stdout).duplicate, true);
  const draftFile = await file('draft', draft(copied.evidenceId)), head = await integrity(caller);
  const integration = JSON.parse((await run(['integration-prepare', '--file', draftFile])).stdout);
  assert.equal(integration.plan.kind, 'integrate'); assert.equal(integration.comparison.current, null);
  assert.match(JSON.stringify(integration.comparison.artifact), /DATED_WIKI_OLD_CANARY/);
  assert.deepEqual(await integrity(caller), head); assert.deepEqual(await callerAdmin.wikiCatalog(), []);
  const planFile = await file('integration', integration);
  const applied = JSON.parse((await run(['apply', '--file', planFile])).stdout); assert.ok(applied.commit);
  assert.deepEqual(JSON.parse((await run(['apply', '--file', planFile])).stdout), { pageIds: [], commit: null });
  await file('draft', { ...draft(copied.evidenceId), expectedRevision: 1, body: 'UPDATED_AUTHORED_CANARY' });
  const update = JSON.parse((await run(['integration-prepare', '--file', draftFile])).stdout);
  assert.match(update.comparison.current.body, /ADAPTER_AUTHORED_CANARY/);
  assert.match(update.preview.pages.find((page: any) => page.key === draft(copied.evidenceId).pageKey).after.body, /UPDATED_AUTHORED_CANARY/);
  assert.deepEqual(await readFile(join(caller.root, copied.evidencePath)), bytes); assert.deepEqual(await integrity(source), before[0]); assert.equal(calls(), count);
});

test('Wiki import CLI: strict bounded files/flags, separate permissions and changed source approval refuse without partial writes', async t => {
  const { caller, binding, selection, importer, file, run, draft, saveBindings } = await fixture(t), before = await integrity(caller);
  for (const args of [[binding.id, pageKey], [binding.id, pageKey, '--expected-commit', 'HEAD'], [binding.id, pageKey, '--expected-commit', binding.commit, '--apply'],
    [binding.id, pageKey, '--expected-commit', binding.commit, '--include-secret=wrong'], [binding.id, pageKey, '--expected-commit', binding.commit, '--root-source', caller.root]]) {
    await assert.rejects(run(['import-prepare', ...args]));
  }
  const prepared = await importer.prepare(selection), copyFile = await file('copy', prepared);
  for (const permissions of ['read', 'write', 'read,write']) await assert.rejects(run(['import-apply', '--file', copyFile, '--confirm'], { AMEM_PERMISSIONS: permissions }));
  await assert.rejects(run(['import-apply', '--file', copyFile, '--confirm=wrong']));
  await assert.rejects(run(['integration-prepare', '--file', '-']));
  const badFile = await file('bad', { ...draft('ev-' + 'a'.repeat(12)), apply: true });
  await assert.rejects(run(['integration-prepare', '--file', badFile]));
  await writeFile(badFile, ' '.repeat(1_000_001)); await assert.rejects(run(['integration-prepare', '--file', badFile]));
  binding.readers = []; await saveBindings(); await assert.rejects(run(['import-apply', '--file', copyFile, '--confirm']));
  assert.deepEqual(await integrity(caller), before);
});

test('Wiki import CLI: a complete formatted copy file may exceed the compact plan limit but never its bounded input limit', async t => {
  const { caller, importer, selection, file, run } = await fixture(t), prepared = await importer.prepare(selection);
  const path = await file('formatted-copy', prepared);
  // Formatting is not part of the signed canonical payload. Do not reject an
  // otherwise valid proposal merely because its saved representation is larger.
  await writeFile(path, ' '.repeat(1_000_001) + JSON.stringify(prepared, null, 2));
  const copied = JSON.parse((await run(['import-apply', '--file', path, '--confirm'])).stdout); assert.ok(copied.evidenceId);
  const before = await integrity(caller);
  await writeFile(path, ' '.repeat(9 * 1_048_576 + 1));
  await assert.rejects(run(['import-apply', '--file', path, '--confirm']), (error: any) => /CONTENT_TOO_LARGE/.test(error.stderr));
  assert.deepEqual(await integrity(caller), before);
});

for (const kind of ['MCP', 'Harness'] as const) {
  test(`${kind} Wiki import: actual SDK copy and complete human-authored comparison require separate approvals`, async t => {
    const { caller, callerAdmin, source, env, selection, draft, calls, saveBindings } = await fixture(t), before = await Promise.all([source, caller].map(integrity)), count = calls();
    await agent(kind, caller.root, env, async (invoke, names) => {
      for (const name of [copyPrepare, copyApply, integrate, approve]) assert.ok(names.includes(name));
      const prepared = await invoke(copyPrepare, selection); assert.match(JSON.stringify(prepared), /DATED_WIKI_OLD_CANARY/);
      assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
      for (const confirm of [undefined, false, 'true']) await assert.rejects(invoke(copyApply, { plan: prepared.plan, ...(confirm === undefined ? {} : { confirm }) }));
      const forged = structuredClone(prepared.plan); forged.artifact.warning = 'Edited proposal'; await assert.rejects(invoke(copyApply, { plan: forged, confirm: true }));
      const copied = await invoke(copyApply, { plan: prepared.plan, confirm: true }); assert.ok(copied.commit);
      const bytes = await readFile(join(caller.root, copied.evidencePath)), head = await integrity(caller);
      assert.deepEqual(await callerAdmin.wikiCatalog(), []);
      assert.deepEqual(await invoke(copyApply, { plan: prepared.plan, confirm: true }), { ...copied, duplicate: true, commit: null });
      // A retained copy can still be integrated after remote sharing is removed.
      await saveBindings([]);
      await assert.rejects(invoke(copyApply, { plan: prepared.plan, confirm: true }));
      const integrated = await invoke(integrate, draft(copied.evidenceId));
      assert.equal(integrated.plan.kind, 'integrate'); assert.equal(integrated.comparison.current, null);
      assert.match(JSON.stringify(integrated.comparison.artifact), /DATED_WIKI_OLD_CANARY/);
      const target = integrated.preview.pages.find((page: any) => page.key === draft(copied.evidenceId).pageKey);
      assert.match(target.after.body, /ADAPTER_AUTHORED_CANARY/); assert.ok(target.after.conditions.includes('Human review is specific to this project.'));
      assert.deepEqual(await invoke('memory_wiki_preview', { plan: integrated.plan }), integrated.preview);
      assert.deepEqual(await integrity(caller), head);
      const edited = structuredClone(integrated.plan); edited.pages[0].body = 'Changed signed text'; await assert.rejects(invoke(approve, { plan: edited }));
      assert.ok((await invoke(approve, { plan: integrated.plan })).commit);
      assert.deepEqual(await invoke(approve, { plan: integrated.plan }), { pageIds: [], commit: null });
      assert.match((await callerAdmin.get(wikiPageId(draft(copied.evidenceId).pageKey))).body, /ADAPTER_AUTHORED_CANARY/);
      assert.deepEqual(await readFile(join(caller.root, copied.evidencePath)), bytes);
    });
    assert.deepEqual(await integrity(source), before[0]); assert.equal(calls(), count);
  });

  test(`${kind} Wiki import: strict host-owned fields, private selection/keys and permission tiers apply to real registered tools`, async t => {
    const data = await fixture(t, true), { caller, env, selection, importer, draft } = data, before = await integrity(caller);
    await agent(kind, caller.root, env, async invoke => {
      await assert.rejects(invoke(copyPrepare, { ...selection, includeSecret: false }));
      for (const patch of [{ root: data.source.root }, { principal: caller.principal }, { signal: {} }, { apply: true },
        { expectedCommit: 'HEAD' }, { pageKeys: [pageKey, pageKey] }, { includeSecret: 'true' }]) await assert.rejects(invoke(copyPrepare, { ...selection, ...patch }));
    });
    assert.deepEqual(await integrity(caller), before);
    const prepared = await importer.prepare(selection);
    await agent(kind, caller.root, { ...env, SHARED_TEST_MASTER_KEY: '' }, async invoke => { await assert.rejects(invoke(copyApply, { plan: prepared.plan, confirm: true })); });
    const copied = await importer.apply(prepared.plan, { confirm: true });
    await agent(kind, caller.root, { ...env, AMEM_MASTER_KEY: '' }, async invoke => { await assert.rejects(invoke(integrate, draft(copied.evidenceId))); });
    for (const permissions of ['read', 'write', 'read,write']) await agent(kind, caller.root, { ...env, AMEM_PERMISSIONS: permissions }, async (invoke, names) => {
      if (permissions !== 'read,write') {
        assert.equal(names.includes(copyPrepare), false); await assert.rejects(invoke(copyPrepare, selection));
        await assert.rejects(invoke(integrate, draft(copied.evidenceId)));
      }
      assert.equal(names.includes(copyApply), false); await assert.rejects(invoke(copyApply, { plan: prepared.plan, confirm: true }));
      if (permissions === 'read,write') {
        for (const patch of [{ apply: true }, { root: caller.root }, { signal: {} }, { expectedRevision: 0.5 }, { includeSecret: 'true' }]) await assert.rejects(invoke(integrate, { ...draft(copied.evidenceId), ...patch }));
        const proposal = await invoke(integrate, draft(copied.evidenceId));
        assert.equal(proposal.preview.pages[0].after.sensitivity, 'secret'); await assert.rejects(invoke(approve, { plan: proposal.plan }));
      }
    });
    await agent(kind, caller.root, { ...env, AMEM_SHARED_WIKI_CONFIG: '' }, async (invoke, names) => {
      assert.equal(names.includes(copyPrepare), false); assert.ok(names.includes(integrate));
      assert.equal((await invoke(integrate, draft(copied.evidenceId))).plan.kind, 'integrate');
    });
    assert.deepEqual(await data.callerAdmin.wikiCatalog(), []);
  });

  for (const operation of [copyPrepare, copyApply, integrate]) test(`${kind} Wiki import: ${operation} cancellation releases its real source/destination waiter`, async t => {
    const { caller, source, env, selection, importer, draft } = await fixture(t);
    const prepared = await importer.prepare(selection);
    const copied = operation === integrate ? await importer.apply(prepared.plan, { confirm: true }) : undefined;
    const input = operation === copyPrepare ? selection : operation === copyApply ? { plan: prepared.plan, confirm: true } : draft(copied!.evidenceId);
    const locked = operation === integrate ? caller : source, lock = join(locked.root, '.amem/write.lock'), before = await Promise.all([source, caller].map(integrity));
    await agent(kind, caller.root, env, async invoke => {
      const acquired = deferred(), release = deferred(), controller = new AbortController();
      const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
      try {
        await acquired.promise; const pending = invoke(operation, input, controller.signal).then(() => null, error => error);
        await waitFor(async () => (await readdir(lock + '.queue')).length === 2); controller.abort();
        const error = await pending; assert.ok(error); assert.match(String(error), kind === 'MCP' ? /cancel|abort/i : /OPERATION_CANCELLED/);
        await waitFor(async () => (await readdir(lock + '.queue')).length === 1); assert.equal(existsSync(lock), true);
      } finally { controller.abort(); release.resolve(); await owner; }
      assert.equal(existsSync(lock), false);
      assert.ok(await invoke(operation === copyApply ? copyPrepare : operation, operation === copyApply ? selection : input));
    });
    assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
  });
}

for (const action of ['import-prepare', 'import-apply', 'integration-prepare']) test(`Wiki import CLI: SIGTERM cancels ${action} while preserving its lock owner`, async t => {
  const { source, caller, binding, importer, selection, run, file, draft } = await fixture(t), prepared = await importer.prepare(selection);
  const copied = action === 'integration-prepare' ? await importer.apply(prepared.plan, { confirm: true }) : undefined;
  const args = action === 'import-prepare' ? [binding.id, pageKey, '--expected-commit', binding.commit]
    : action === 'import-apply' ? ['--file', await file('copy', prepared), '--confirm'] : ['--file', await file('draft', draft(copied!.evidenceId))];
  const locked = action === 'integration-prepare' ? caller : source, lock = join(locked.root, '.amem/write.lock');
  const before = await Promise.all([source, caller].map(integrity)), acquired = deferred(), release = deferred();
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; }); let command: ReturnType<typeof exec> | undefined;
  try {
    await acquired.promise; command = run([action, ...args]); const outcome = command.then(() => null, error => error);
    try {
      await Promise.race([
        waitFor(async () => (await readdir(lock + '.queue')).length === 2),
        outcome.then(error => assert.fail('CLI exited before reaching its source/destination waiter: ' + (error?.stderr ?? 'unexpected success'))),
      ]);
    } catch (cause) {
      command.child.kill('SIGTERM');
      const failure = await outcome;
      throw new Error('CLI waiter observation failed; child code ' + failure?.code + ' signal ' + failure?.signal + '; stderr: ' + (failure?.stderr ?? 'unexpected success'), { cause });
    }
    command.child.kill('SIGTERM');
    const error = await outcome; assert.equal(error?.code, 130); assert.match(error.stderr, /OPERATION_CANCELLED/);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 1); assert.equal(existsSync(lock), true);
  } finally { command?.child.kill('SIGTERM'); release.resolve(); await owner; }
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
});

test('Harness Wiki import: disposal waits for cancellation and complete oversized reviews fail without truncation', async t => {
  const { caller, source, env, selection } = await fixture(t), before = await Promise.all([source, caller].map(integrity));
  await agent('Harness', caller.root, env, async invoke => {
    const huge = '\0'.repeat(2_500_000);
    const prepare = t.mock.method(SharedWikiImporter.prototype, 'prepare', async () => ({ plan: { body: huge } } as any));
    await assert.rejects(invoke(copyPrepare, selection), /CONTENT_TOO_LARGE/); prepare.mock.restore();
    const integration = t.mock.method(MemoryVault.prototype, 'wikiIntegrationPrepare', async () => ({ plan: {}, comparison: { body: huge } } as any));
    await assert.rejects(invoke(integrate, { evidenceId: 'ev-' + 'a'.repeat(12), pageKey: 'concept:test', expectedRevision: 0, title: 'Test', summary: 'Test', body: 'Test' }), /CONTENT_TOO_LARGE/); integration.mock.restore();
  });
  await agent('Harness', caller.root, env, async (invoke, _names, dispose) => {
    const lock = join(source.root, '.amem/write.lock'), acquired = deferred(), release = deferred();
    const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
    try {
      await acquired.promise; const pending = invoke(copyPrepare, selection).then(() => null, error => error);
      await waitFor(async () => (await readdir(lock + '.queue')).length === 2); await dispose();
      assert.match(String(await pending), /OPERATION_CANCELLED/); assert.equal((await readdir(lock + '.queue')).length, 1);
    } finally { release.resolve(); await owner; }
  });
  assert.deepEqual(await Promise.all([source, caller].map(integrity)), before);
});

test('Wiki import tool schemas exclude host signals and require literal confirmation; approval envelope uses copy operation', () => {
  assert.throws(() => wikiToolInput(sharedWikiImportApplySchema, { plan: {}, confirm: 'true' }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => wikiToolInput(wikiIntegrationToolSchema, { signal: {} }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => wikiToolResult({}, { body: '\0'.repeat(2_500_000) }, copyApply), { code: 'CONTENT_TOO_LARGE' });
});

test('Wiki import real MCP and CLI refuse oversized complete copy/integration reviews before transport truncation', { timeout: 20_000 }, async () => {
  const injection = `
    import { SharedWikiImporter } from './dist/shared-wiki-import.js';
    import { MemoryVault } from './dist/vault.js';
    SharedWikiImporter.prototype.prepare = async () => ({ plan: { body: '\\0'.repeat(2500000) } });
    MemoryVault.prototype.wikiIntegrationPrepare = async () => ({ plan: {}, comparison: { body: '\\0'.repeat(2500000) } });
  `;
  const env = Object.assign(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string>, {
    AMEM_SHARED_WIKI_CONFIG: join(process.cwd(), '.scratch/unused-import-host.json'), AMEM_PERMISSIONS: 'read,write,review',
  });
  const client = new Client({ name: 'import-review-budget', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: ['--input-type=module', '-e', injection + "await import('./dist/mcp.js');"], env, stderr: 'pipe' }));
    for (const [name, args] of [[copyPrepare, { sourceId: 'team', expectedCommit: 'a'.repeat(40), pageKeys: ['concept:test'] }],
      [integrate, { evidenceId: 'ev-' + 'a'.repeat(12), pageKey: 'concept:test', expectedRevision: 0, title: 'Test', summary: 'Test', body: 'Test' }]] as const) {
      const result = await client.callTool({ name, arguments: args }); assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /CONTENT_TOO_LARGE/);
    }
  } finally { await client.close(); }
  // The CLI must use the same complete-result allowance, not print an enormous
  // signed result which its own bounded approval-file reader cannot resubmit.
  await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', injection + "process.argv = ['node','cli','wiki','import-prepare','team','concept:test','--expected-commit','" + 'a'.repeat(40) + "']; await import('./dist/cli.js');"], { env }),
    (error: any) => /CONTENT_TOO_LARGE/.test(error.stderr) && error.stdout === '');
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }
async function waitFor(check: () => Promise<boolean>) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) { try { if (await check()) return; } catch {} await delay(15); }
  assert.fail('Actual adapter lock waiter did not reach the expected state');
}
