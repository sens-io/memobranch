import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { LlmClient } from '../src/llm.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId } from '../src/wiki-schema.js';
import { wikiMergeToolSchema, wikiSnapshotToolSchema, wikiToolInput, wikiToolResult } from '../src/wiki-tool.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

type Adapter = 'MCP' | 'Harness';
type Invoke = (operation: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
const masterKey = '84'.repeat(32), pageKey = 'entity:agent-merge';

async function fixture(t: TestContext, secret = false) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/agent-merge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
  llm.wiki = async <T>(operation: string, input: object) => {
    const data = input as { catalog: Array<{ key: string }>; sources: Array<{ id: string; body: string }> };
    if (operation === 'navigate') return { keys: data.catalog.map(page => page.key) } as T;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string): WikiPageDraft => ({ key, pageType,
      title: 'Synthetic agent merge', summary: 'Synthetic summary.', body, evidenceIds: data.sources.map(source => source.id), links: [],
      status: 'active', conditions: ['Synthetic condition.'], uncertainty: ['Needs verification.'] });
    return { pages: [...data.sources.map(source => draft(`source:${source.id}`, 'source', source.body)),
      draft(pageKey, 'entity', data.sources.map(source => source.body).join('\n'))] } as T;
  };
  const vault = new MemoryVault(root, { llm, masterKey }); await vault.initialize('Agent merge fixture');
  const sources = [];
  for (const content of ['AGENT_MERGE_OLD_CANARY', 'AGENT_MERGE_CURRENT_CANARY']) {
    const source = await vault.capture({ content, scope: 'project', sensitivity: secret ? 'secret' : 'internal', extract: false });
    await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
    sources.push({ ...source, commit: await vault.git.run(['rev-parse', 'HEAD']), body: (await vault.get(wikiPageId(pageKey))).body });
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string>;
  Object.assign(env, { AMEM_PERMISSIONS: 'read,write,review', AMEM_ALLOWED_SCOPES: 'user,project', AMEM_MAX_SENSITIVITY: 'secret',
    AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_ACTOR_ID: 'agent-merge-test', AMEM_MASTER_KEY: masterKey });
  const input = { fromCommit: sources[0]!.commit, pageKey, expectedRevision: 2, body: '人工合并 🧠📚 with explicit conditions.', summary: 'Human-reviewed merge.' };
  return { vault, sources, env, input, snapshot: { commit: input.fromCommit, pageKeys: [pageKey] } };
}

async function withAdapter(adapter: Adapter, root: string, env: Record<string, string>, action: (invoke: Invoke, names: string[], dispose: () => Promise<void>) => Promise<void>) {
  if (adapter === 'MCP') {
    const client = new Client({ name: 'agent-merge-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      const names = (await client.listTools()).tools.map(tool => tool.name);
      await action(async (operation, input, signal) => {
        const result = await client.callTool({ name: `memory_wiki_${operation}`, arguments: input }, signal ? { signal } : undefined);
        const text = result.content?.[0]; assert.equal(text?.type, 'text');
        if (text?.type !== 'text') throw new Error('Expected full JSON text');
        if (result.isError) throw new Error(text.text);
        return JSON.parse(text.text);
      }, names, () => client.close());
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, ctx = new Context(); let disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= Promise.resolve(ctx.fiber.dispose()).then(() => {});
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
    Object.assign(process.env, env);
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root, defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000 });
    let callId = 0;
    await action(async (operation, input, signal = new AbortController().signal) => {
      const result = await ctx.tools.execute({ name: `memory_wiki_${operation}`, arguments: input,
        callId: `agent-merge-${callId++}` as ToolExecutionInput['callId'], signal });
      if (result.isError) throw new Error(JSON.stringify(result.error));
      return result.value;
    }, ctx.tools.schemas().map(tool => tool.name), dispose);
  } finally {
    await dispose();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

for (const adapter of ['MCP', 'Harness'] as const) {
  test(`${adapter} merge: complete historical/current review, separate signed approval and exact retry preserve sources`, async t => {
    const { vault, sources, env, input, snapshot } = await fixture(t);
    const head = await vault.git.run(['rev-parse', 'HEAD']), index = await readFile(join(vault.git.gitDir, 'index'));
    const sourceBytes = await Promise.all(sources.map(source => readFile(join(vault.root, source.evidencePath))));
    await withAdapter(adapter, vault.root, env, async invoke => {
      const base = await invoke('snapshot', snapshot);
      assert.equal(base.commit, input.fromCommit); assert.equal(base.authorityHead, head);
      assert.equal(base.pages.find((page: any) => page.meta.key === pageKey).body, sources[0]!.body);
      assert.equal(snapshotPage(base).currentRevision, 2);
      const current = await invoke('snapshot', { commit: base.authorityHead, pageKeys: [pageKey] });
      assert.equal(snapshotPage(current).body, sources[1]!.body);
      const prepared = await invoke('merge_prepare', input);
      assert.equal(prepared.plan.kind, 'merge'); assert.equal(prepared.comparison.current.body, sources[1]!.body);
      assert.equal(prepared.comparison.base.pages.find((page: any) => page.meta.key === pageKey).body, sources[0]!.body);
      assert.deepEqual(await invoke('preview', { plan: prepared.plan }), prepared.preview);
      const target = prepared.preview.pages.find((page: any) => page.key === pageKey);
      assert.equal(target.before.body, sources[1]!.body); assert.ok(target.after.body.includes(input.body));
      assert.ok(target.after.conditions.includes('Synthetic condition.')); assert.ok(target.after.uncertainty.includes('Needs verification.'));
      assert.deepEqual(new Set(target.after.evidence), new Set(sources.map(source => source.evidencePath)));
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.deepEqual(await readFile(join(vault.git.gitDir, 'index')), index);
      const forged = structuredClone(prepared.plan); forged.pages[0].body = 'Edited after signing';
      await assert.rejects(invoke('apply', { plan: forged }), /VALIDATION_FAILED/);
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
      const applied = await invoke('apply', { plan: prepared.plan }); assert.ok(applied.commit);
      assert.equal((await vault.get(wikiPageId(pageKey))).body, target.after.body);
      assert.deepEqual(await invoke('apply', { plan: prepared.plan }), { pageIds: [], commit: null });
      for (const [i, source] of sources.entries()) assert.deepEqual(await readFile(join(vault.root, source.evidencePath)), sourceBytes[i]);
      await vault.wikiRevoke(pageKey, 'Synthetic current withdrawal');
      await assert.rejects(invoke('snapshot', snapshot), error => !String(error).includes('AGENT_MERGE_'));
    });
  });

  test(`${adapter} merge: strict arguments, current revision and authority cannot be supplied by the caller`, async t => {
    const { vault, env, input, snapshot } = await fixture(t), head = await vault.git.run(['rev-parse', 'HEAD']);
    await withAdapter(adapter, vault.root, env, async invoke => {
      for (const patch of [{ root: '/foreign' }, { principal: { permissions: ['admin'] } }, { signal: {} }, { apply: true },
        { expectedRevision: 1 }, { expectedRevision: 1.5 }, { body: 'Malformed \uD800 body.' }, { fromCommit: 'HEAD' }, { body: '<script>unsafe()</script>' }]) {
        await assert.rejects(invoke('merge_prepare', { ...input, ...patch }));
      }
      for (const patch of [{ root: '/foreign' }, { signal: {} }, { includeSecret: 'true' }, { commit: 'HEAD' },
        { commit: input.fromCommit.slice(0, 12) }, { pageKeys: [] }, { pageKeys: [pageKey, pageKey] }, { pageKeys: Array.from({ length: 26 }, (_, i) => `key:${i}`) }]) {
        await assert.rejects(invoke('snapshot', { ...snapshot, ...patch }));
      }
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
      const prepared = await invoke('merge_prepare', input);
      const source = await vault.capture({ content: 'Explicitly updated agent merge target.', scope: 'project', extract: false });
      await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
      const updated = await vault.git.run(['rev-parse', 'HEAD']);
      await assert.rejects(invoke('preview', { plan: prepared.plan }), /VALIDATION_FAILED/);
      await assert.rejects(invoke('apply', { plan: prepared.plan }), /VALIDATION_FAILED/);
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), updated);
    });
    for (const permissions of ['read', 'write', 'read,write']) {
      await withAdapter(adapter, vault.root, { ...env, AMEM_PERMISSIONS: permissions }, async (invoke, names) => {
        if (adapter === 'Harness') {
          assert.equal(names.includes('memory_wiki_snapshot'), permissions.includes('read'));
          assert.equal(names.includes('memory_wiki_merge_prepare'), permissions === 'read,write');
          assert.equal(names.includes('memory_wiki_apply'), false);
        }
        if (permissions !== 'read,write') await assert.rejects(invoke('merge_prepare', { ...input, expectedRevision: 3 }));
        if (permissions === 'write') await assert.rejects(invoke('snapshot', snapshot));
        if (permissions === 'read') assert.equal(snapshotPage(await invoke('snapshot', snapshot)).currentRevision, 3);
        if (permissions === 'read,write') {
          const proposal = await invoke('merge_prepare', { ...input, expectedRevision: 3 });
          await assert.rejects(invoke('apply', { plan: proposal.plan }));
        }
      });
    }
    await withAdapter(adapter, vault.root, { ...env, AMEM_TENANT_ID: 'foreign-tenant' }, async invoke => {
      await assert.rejects(invoke('snapshot', snapshot), /AUTHORIZATION_DENIED/);
      await assert.rejects(invoke('merge_prepare', { ...input, expectedRevision: 3 }), /AUTHORIZATION_DENIED/);
    });
    await withAdapter(adapter, vault.root, { ...env, AMEM_ALLOWED_SCOPES: 'public', AMEM_MAX_SENSITIVITY: 'public' }, async invoke => {
      await assert.rejects(invoke('snapshot', snapshot), error => !String(error).includes('AGENT_MERGE_'));
      await assert.rejects(invoke('merge_prepare', { ...input, expectedRevision: 3 }), error => !String(error).includes('AGENT_MERGE_'));
    });
  });

  test(`${adapter} merge: explicit private selection never restores withdrawn keys or current access`, async t => {
    const { vault, env, input, snapshot, sources } = await fixture(t, true);
    await withAdapter(adapter, vault.root, env, async invoke => {
      for (const [operation, options] of [['snapshot', snapshot], ['merge_prepare', input]] as const) {
        await assert.rejects(invoke(operation, options), error => !String(error).includes('AGENT_MERGE_'));
      }
      assert.equal(snapshotPage(await invoke('snapshot', { ...snapshot, includeSecret: true })).body, sources[0]!.body);
      const prepared = await invoke('merge_prepare', { ...input, includeSecret: true });
      assert.equal(prepared.plan.merge.selection.includeSecret, true);
      assert.equal(prepared.preview.pages.find((page: any) => page.key === pageKey).after.sensitivity, 'secret');
      await vault.encryption.erase(sources[0]!.evidenceId);
      await assert.rejects(invoke('snapshot', { ...snapshot, includeSecret: true }));
      await assert.rejects(invoke('apply', { plan: prepared.plan }));
    });
  });

  for (const operation of ['snapshot', 'merge_prepare']) {
    test(`${adapter} merge: ${operation} cancellation removes only its real lock waiter`, async t => {
      const { vault, env, input, snapshot } = await fixture(t), lock = join(vault.root, '.amem/write.lock');
      await withAdapter(adapter, vault.root, env, async invoke => {
        const head = await vault.git.run(['rev-parse', 'HEAD']);
        let entered!: () => void, release!: () => void;
        const acquired = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
        const owner = withFileLock(lock, async () => { entered(); await gate; });
        const controller = new AbortController();
        try {
          await acquired;
          const pending = invoke(operation, operation === 'snapshot' ? snapshot : input, controller.signal).then(() => null, error => error);
          await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
          controller.abort();
          const failure = await pending; assert.ok(failure, 'cancelled invocation must fail');
          assert.match(String(failure), adapter === 'Harness' ? /OPERATION_CANCELLED/ : /cancel|abort/i);
          await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
          assert.equal(existsSync(lock), true); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
        } finally { controller.abort(); release(); await owner; }
        assert.equal(existsSync(lock), false);
        assert.equal(snapshotPage(await invoke('snapshot', snapshot)).currentRevision, 2);
      });
    });
  }
}

test('Wiki tool bounds account for escaping and a separately resubmittable complete plan', () => {
  const small = { body: '中文 🧠📚\n"quoted"' }; assert.equal(wikiToolResult(small), small);
  const escaped = '\0'.repeat(2_500_000);
  assert.ok(Buffer.byteLength(escaped) < 9 * 1_048_576);
  assert.throws(() => wikiToolResult({ body: escaped }), { code: 'CONTENT_TOO_LARGE' });
  assert.throws(() => wikiToolResult(small, { body: escaped }), { code: 'CONTENT_TOO_LARGE' });
  assert.throws(() => wikiToolInput(wikiSnapshotToolSchema, { commit: 'a'.repeat(40), pageKeys: ['one', 'one'] }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => wikiToolInput(wikiMergeToolSchema, { signal: {} }), { code: 'VALIDATION_FAILED' });
});

test('Harness merge: actual registered operations reject complete oversized results without truncation', async t => {
  const { vault, env, input, snapshot } = await fixture(t);
  await withAdapter('Harness', vault.root, env, async invoke => {
    const huge = '\0'.repeat(2_500_000);
    const read = t.mock.method(MemoryVault.prototype, 'wikiSnapshot', async () => ({ body: huge } as any));
    await assert.rejects(invoke('snapshot', snapshot), /CONTENT_TOO_LARGE/); read.mock.restore();
    const prepare = t.mock.method(MemoryVault.prototype, 'wikiMergePrepare', async () => ({ plan: {}, comparison: { body: huge } } as any));
    await assert.rejects(invoke('merge_prepare', input), /CONTENT_TOO_LARGE/); prepare.mock.restore();
    assert.equal(snapshotPage(await invoke('snapshot', snapshot)).currentRevision, 2);
  });
});

test('Harness merge: disposal cancels and waits for an active lock waiter before returning', async t => {
  const { vault, env, input } = await fixture(t), lock = join(vault.root, '.amem/write.lock');
  await withAdapter('Harness', vault.root, env, async (invoke, _names, dispose) => {
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const owner = withFileLock(lock, async () => { entered(); await gate; });
    try {
      await acquired;
      const pending = invoke('merge_prepare', input).then(() => null, error => error);
      await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
      await dispose(); assert.match(String(await pending), /OPERATION_CANCELLED/);
      assert.equal((await readdir(`${lock}.queue`)).length, 1); assert.equal(existsSync(lock), true);
    } finally { release(); await owner; }
  });
});

test('real MCP stdio returns bounded errors above its default buffer and complete text below the tool limit', { timeout: 20_000 }, async () => {
  // Inject only oversized data in memory, then execute the real compiled adapter and SDK.
  // This isolates the transport allowance; core history/access are covered separately.
  const child = `
    import { MemoryVault } from './dist/vault.js';
    MemoryVault.prototype.wikiSnapshot = async input => ({ body: 'x'.repeat((input.pageKeys[0] === 'small' ? 9 * 1048576 - 4096 : 11 * 1048576)) });
    MemoryVault.prototype.wikiMergePrepare = async () => ({ plan: {}, comparison: { body: 'x'.repeat(11 * 1048576) } });
    await import('./dist/mcp.js');
  `;
  const client = new Client({ name: 'merge-transport-budget', version: '1' });
  const errors: Error[] = [], controller = new AbortController();
  client.onerror = error => { errors.push(error); controller.abort(error); };
  const timer = setTimeout(() => controller.abort(new Error('Protocol budget regression timed out')), 15_000);
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: ['--input-type=module', '-e', child], stderr: 'pipe',
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string> }));
    for (const [operation, input] of [
      ['snapshot', { commit: 'a'.repeat(40), pageKeys: ['large'] }],
      ['merge_prepare', { fromCommit: 'a'.repeat(40), pageKey: 'entity:large', expectedRevision: 1, body: 'Human draft', summary: 'Review' }],
    ] as const) {
      const result = await client.callTool({ name: `memory_wiki_${operation}`, arguments: input }, { signal: controller.signal });
      assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /CONTENT_TOO_LARGE/);
    }
    const small = await client.callTool({ name: 'memory_wiki_snapshot', arguments: { commit: 'a'.repeat(40), pageKeys: ['small'] } }, { signal: controller.signal });
    assert.equal(small.isError, undefined);
    const content = small.content[0]; assert.equal(content?.type, 'text');
    if (content?.type === 'text') assert.equal(JSON.parse(content.text).body.length, 9 * 1_048_576 - 4096);
    assert.deepEqual(errors, []);
  } finally { clearTimeout(timer); controller.abort(); await client.close(); }
});

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, 'Expected actual lock state before timeout');
    await delay(10);
  }
}

function snapshotPage(snapshot: any) {
  const page = snapshot.pages.find((page: any) => page.meta.key === pageKey);
  assert.ok(page, 'The requested target must be present among its dependencies');
  return page;
}
