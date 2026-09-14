import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { MemoryVault } from '../src/vault.js';
import type { WikiCatalogEntry, WikiLintResult, WikiPlan, WikiQueryResult } from '../src/wiki-types.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const mcp = fileURLToPath(new URL('../dist/mcp.js', import.meta.url));
const wikiCategories = {
  read: ['memory_wiki_catalog', 'memory_wiki_query', 'memory_wiki_rules'],
  write: ['memory_wiki_file', 'memory_wiki_ingest'],
  review: ['memory_wiki_apply', 'memory_wiki_revoke'],
  maintain: ['memory_wiki_lint', 'memory_wiki_migrate', 'memory_wiki_set_rules'],
};

test('G03/G04/W02 built CLI exposes explicit Wiki maintenance and rejects unauthorized apply', async () => {
  await withVault(async (vault, env) => {
    const run = async (args: string[], input?: string, policy = env) => {
      const pending = exec(process.execPath, [cli, 'wiki', ...args, '--root', vault.root], { env: policy });
      if (input !== undefined) pending.child.stdin?.end(input);
      return JSON.parse((await pending).stdout) as unknown;
    };
    const migrated = await run(['migrate']) as { created: boolean };
    assert.equal(typeof migrated.created, 'boolean');
    const migratedHead = await vault.git.run(['rev-parse', 'HEAD']);
    assert.equal((await run(['migrate']) as { created: boolean }).created, false);
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), migratedHead);
    await run(['set-rules', 'Retain source citations and uncertainty.', '--purpose', 'CLI Wiki purpose']);
    const before = await canonicalSnapshot(vault);
    assert.ok(Array.isArray(await run(['catalog'])));
    assert.match(JSON.stringify(await run(['rules'])), /CLI Wiki purpose/);
    assertStructuralLint(await run(['lint']));
    assert.deepEqual(await canonicalSnapshot(vault), before, 'catalog, rules, and lint preserve canonical content');
    await assert.rejects(run(['apply', '--file', '-'], '{invalid json'), cliFailure('VALIDATION_FAILED'));
    await assert.rejects(run(['query', 'AtlasStore', '--max-pages', '51']), cliFailure('VALIDATION_FAILED'));
    await assert.rejects(run(['query', 'AtlasStore', '--max-pages']), cliFailure('VALIDATION_FAILED'));
    await assert.rejects(run(['file', '--file', '-', '--title', 'Denied save', '--apply'], '{}', { ...env, AMEM_PERMISSIONS: 'write' }), cliFailure('AUTHORIZATION_DENIED'));
    await assert.rejects(run(['apply', '--file', '-'], '{}', { ...env, AMEM_PERMISSIONS: 'read' }), cliFailure('AUTHORIZATION_DENIED'));
    assert.deepEqual(await canonicalSnapshot(vault), before);
  });
});

test('G03/G04/S02 official Harness exposes Wiki categories and rejects apply before compilation', async () => {
  await withVault(async (vault, env) => {
    for (const [permission, expected] of Object.entries(wikiCategories)) {
      await withHarness(vault.root, { ...env, AMEM_PERMISSIONS: permission }, async (tools) => {
        assert.deepEqual(tools.schemas().map((tool) => tool.name).filter((name) => name.startsWith('memory_wiki_')).sort(), expected);
        if (permission === 'write') {
          assertToolError(await call(tools, 'memory_wiki_ingest', { evidenceIds: ['ev-not-present'], apply: true }), 'AUTHORIZATION_DENIED');
          assertToolError(await call(tools, 'memory_wiki_file', { result: {}, title: 'Denied filing', apply: true }), 'AUTHORIZATION_DENIED');
          assertToolError(await call(tools, 'memory_wiki_ingest', { evidenceIds: [] }), 'VALIDATION_FAILED');
        }
        if (permission === 'read') {
          assert.ok(Array.isArray(success(await call(tools, 'memory_wiki_catalog', {}))));
          assertToolError(await call(tools, 'memory_wiki_query', { question: 'x', maxPages: 51 }), 'VALIDATION_FAILED');
          assertToolError(await call(tools, 'memory_wiki_catalog', { permissions: ['admin'] }), 'VALIDATION_FAILED');
        }
        if (permission === 'review') {
          assertToolError(await call(tools, 'memory_wiki_apply', { plan: {} }), 'VALIDATION_FAILED');
        }
        if (permission === 'maintain') {
          success(await call(tools, 'memory_wiki_migrate', {}));
          success(await call(tools, 'memory_wiki_set_rules', { purpose: 'Harness Wiki purpose', instructions: 'Keep citations explicit.' }));
          assertStructuralLint(success(await call(tools, 'memory_wiki_lint', {})));
        }
      });
    }
  });
});

test('G03/S06/S07 official Harness Wiki reads are canonical-read-only and cancelled invocations cannot mutate', async () => {
  await withVault(async (vault, env) => {
    await vault.wikiMigrate();
    await withHarness(vault.root, env, async (tools, dispose) => {
      const before = await canonicalSnapshot(vault);
      const controller = new AbortController();
      controller.abort();
      const cancelled = await call(tools, 'memory_wiki_set_rules', { purpose: 'Cancelled rule', instructions: 'Must never persist.' }, controller.signal);
      assert.equal(cancelled.isError, true);
      assert.equal(cancelled.error?.info?.code, 'ABORTED_BEFORE_DISPATCH');
      success(await call(tools, 'memory_wiki_catalog', {}));
      success(await call(tools, 'memory_wiki_rules', {}));
      success(await call(tools, 'memory_wiki_lint', {}));
      assert.deepEqual(await canonicalSnapshot(vault), before);
      await dispose();
      assert.deepEqual(tools.schemas(), [], 'disposal removes every Wiki tool');
    });
  });
});

test('G03/G04 real MCP Wiki tools have truthful annotations and preserve service after denial', async () => {
  await withVault(async (vault, env) => {
    const client = new Client({ name: 'wiki-adapter-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [mcp, vault.root], env: { ...env, AMEM_PERMISSIONS: 'read,write,maintain' }, stderr: 'pipe' });
    try {
      await client.connect(transport);
      const listed = (await client.listTools()).tools;
      assert.deepEqual(listed.map((tool) => tool.name).filter((name) => name.startsWith('memory_wiki_')).sort(), Object.values(wikiCategories).flat().sort());
      for (const name of ['catalog', 'rules', 'query', 'lint']) {
        assert.equal(listed.find((tool) => tool.name === `memory_wiki_${name}`)?.annotations?.readOnlyHint, true);
      }
      for (const name of ['ingest', 'file', 'apply', 'migrate', 'set_rules', 'revoke']) {
        assert.equal(listed.find((tool) => tool.name === `memory_wiki_${name}`)?.annotations?.readOnlyHint, false);
      }
      assert.equal(listed.find((tool) => tool.name === 'memory_wiki_revoke')?.annotations?.destructiveHint, true);
      const invoke = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name: `memory_wiki_${name}`, arguments: args });
      assert.equal((await invoke('migrate')).isError, undefined);
      assert.equal((await invoke('set_rules', { purpose: 'MCP Wiki purpose', instructions: 'Cite actual page revisions.' })).isError, undefined);
      const before = await canonicalSnapshot(vault);
      for (const [name, args] of [
        ['ingest', { evidenceIds: ['ev-not-present'], apply: true }],
        ['file', { result: {}, title: 'Denied save', apply: true }],
        ['apply', { plan: {} }],
      ] as const) {
        const denied = await invoke(name, args);
        assert.equal(denied.isError, true);
        assert.match(JSON.stringify(denied.content), /AUTHORIZATION_DENIED/);
      }
      assert.equal((await invoke('query', { question: 'x', maxPages: 51 })).isError, true);
      assert.equal((await invoke('catalog', { tenantId: 'forged' })).isError, true);
      assert.match(JSON.stringify((await invoke('rules')).content), /MCP Wiki purpose/);
      assert.equal((await invoke('catalog')).isError, undefined);
      assertStructuralLint(mcpValue(await invoke('lint')));
      assert.deepEqual(await canonicalSnapshot(vault), before);
    } finally {
      await client.close();
    }
  });
});

for (const adapter of ['CLI', 'MCP', 'Harness'] as const) {
  test(`G03/I04/Q03/L04 ${adapter} compiles, applies, queries, files, repairs, and revokes persistent Wiki pages`, { timeout: 30_000 }, async () => {
    await withVault(async (vault, baseEnv) => {
      const captured = await vault.capture({ content: 'AtlasStore supports daily snapshots for project deployments.', scope: 'user', sensitivity: 'internal' });
      const evidence = await vault.get(captured.evidenceId);
      const evidenceBytes = await readFile(join(vault.root, evidence.path), 'utf8');
      await withWikiProvider(captured.evidenceId, async (providerEnv, operations) => {
        await withAdapter(adapter, vault, { ...baseEnv, ...providerEnv }, async (invoke) => {
          await invoke('migrate', {});
          await invoke('set_rules', { purpose: `${adapter} atlas knowledge`, instructions: 'Preserve source citations and deployment conditions.' });
          const baseline = await canonicalSnapshot(vault);
          const prepared = await invoke('ingest', { evidenceIds: [captured.evidenceId] }) as { plan: WikiPlan; commit: string | null };
          assert.ok(prepared.plan.pages.length >= 2);
          assert.equal(prepared.commit, null);
          assert.deepEqual(await canonicalSnapshot(vault), baseline, 'planning must not write canonical knowledge');
          const applied = await invoke('apply', { plan: prepared.plan }) as { pageIds: string[]; commit: string | null };
          assert.equal(applied.pageIds.length, 2);
          assert.equal(applied.commit, await vault.git.run(['rev-parse', 'HEAD']));
          const catalog = await invoke('catalog', {}) as WikiCatalogEntry[];
          assert.equal(catalog.length, 2);
          const entity = catalog.find((page) => page.key === 'entity:atlasstore');
          assert.ok(entity);
          assert.match((await vault.get(entity.id)).body, /daily snapshots/);
          assert.equal(await readFile(join(vault.root, evidence.path), 'utf8'), evidenceBytes);
          const compiled = await canonicalSnapshot(vault);
          const question = await invoke('query', { question: 'What does AtlasStore support?' }) as WikiQueryResult;
          assert.equal(question.citations[0]?.key, 'entity:atlasstore');
          assert.match(question.answer, /daily snapshots/);
          assert.deepEqual(await canonicalSnapshot(vault), compiled, 'ordinary query must not file itself');
          const filed = await invoke('file', { result: question, title: 'AtlasStore comparison', key: 'comparison:atlasstore', pageType: 'comparison' }) as { plan: WikiPlan; commit: string | null };
          assert.equal(filed.commit, null);
          assert.deepEqual(await canonicalSnapshot(vault), compiled, 'filing prepares a plan until explicitly applied');
          await invoke('apply', { plan: filed.plan });
          const filedPage = (await invoke('catalog', {}) as WikiCatalogEntry[]).find((page) => page.key === 'comparison:atlasstore');
          assert.equal(filedPage?.pageType, 'comparison');
          assert.ok(filedPage);
          assert.match((await vault.get(filedPage.id)).body, /Generated analysis/);
          const beforeLint = await canonicalSnapshot(vault);
          const lint = await invoke('lint', { semantic: true }) as WikiLintResult;
          assert.equal(lint.semantic, 'available');
          assert.ok(lint.issues.some((issue) => issue.kind === 'gap'));
          assert.equal(lint.plans.length, 1);
          assert.deepEqual(await canonicalSnapshot(vault), beforeLint, 'semantic suggestions do not apply repairs');
          await invoke('apply', { plan: lint.plans[0] });
          const repair = (await invoke('catalog', {}) as WikiCatalogEntry[]).find((page) => page.key === 'concept:restore-verification');
          assert.ok(repair, 'an explicitly accepted repair persists');
          assert.match((await vault.get(repair.id)).body, /remains unverified/);
          await invoke('revoke', { key: 'concept:restore-verification', reason: 'Superseded research question' });
          assert.equal((await invoke('catalog', {}) as WikiCatalogEntry[]).some((page) => page.key === 'concept:restore-verification'), false);
          assert.equal(await readFile(join(vault.root, evidence.path), 'utf8'), evidenceBytes);
          assert.ok(operations.includes('compile') && operations.includes('navigate') && operations.includes('query') && operations.includes('lint'));
        });
      });
    });
  });
}

type InvokeWiki = (operation: string, args: Record<string, unknown>) => Promise<unknown>;

async function withAdapter(adapter: 'CLI' | 'MCP' | 'Harness', vault: MemoryVault, env: Record<string, string>, action: (invoke: InvokeWiki) => Promise<void>): Promise<void> {
  if (adapter === 'Harness') {
    await withHarness(vault.root, env, async (tools) => action(async (operation, args) => success(await call(tools, `memory_wiki_${operation}`, args as ToolExecutionInput['arguments']))));
    return;
  }
  if (adapter === 'MCP') {
    const client = new Client({ name: 'wiki-workflow-test', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [mcp, vault.root], env, stderr: 'pipe' }));
      await action(async (operation, args) => mcpValue(await client.callTool({ name: `memory_wiki_${operation}`, arguments: args })));
    } finally { await client.close(); }
    return;
  }
  await action(async (operation, input) => {
    const args = [operation.replaceAll('_', '-')];
    let stdin: string | undefined;
    if (operation === 'set_rules') args.push(String(input.instructions), '--purpose', String(input.purpose));
    if (operation === 'ingest') args.push(...input.evidenceIds as string[]);
    if (operation === 'query') args.push(String(input.question));
    if (operation === 'revoke') args.push(String(input.key), '--reason', String(input.reason));
    if (operation === 'apply') { args.push('--file', '-'); stdin = JSON.stringify({ plan: input.plan }); }
    if (operation === 'file') {
      args.push('--file', '-', '--title', String(input.title), '--key', String(input.key), '--page-type', String(input.pageType));
      stdin = JSON.stringify(input.result);
    }
    if (input.apply === true) args.push('--apply');
    if (input.semantic === true) args.push('--semantic');
    const pending = exec(process.execPath, [cli, 'wiki', ...args, '--root', vault.root], { env });
    if (stdin !== undefined) pending.child.stdin?.end(stdin);
    return JSON.parse((await pending).stdout) as unknown;
  });
}

async function withWikiProvider(evidenceId: string, action: (env: Record<string, string>, operations: string[]) => Promise<void>): Promise<void> {
  const operations: string[] = [];
  const draft = (key: string, pageType: string, title: string, body: string, links: string[]) => ({
    key, pageType, title, summary: body, body, evidenceIds: [evidenceId], links, conditions: ['Project deployments'], uncertainty: [], status: 'active',
  });
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: Array<{ content: string }> };
      const payload = JSON.parse(envelope.messages[1]!.content) as { operation: string; input: { catalog: Array<{ key: string }>; pages: Array<{ key: string }> } };
      operations.push(payload.operation);
      let result: unknown;
      if (payload.operation === 'navigate') result = { keys: payload.input.catalog.map((page) => page.key) };
      else if (payload.operation === 'compile') result = { pages: [
        draft(`source:${evidenceId}`, 'source', 'AtlasStore snapshot source', 'AtlasStore supports daily snapshots for project deployments.', ['entity:atlasstore']),
        draft('entity:atlasstore', 'entity', 'AtlasStore', 'AtlasStore provides daily snapshots for project deployments.', [`source:${evidenceId}`]),
      ] };
      else if (payload.operation === 'query') result = { answer: 'AtlasStore supports daily snapshots for project deployments.', citations: ['entity:atlasstore'], uncertainty: ['Restoration performance has not been verified.'] };
      else if (payload.operation === 'lint') result = { suggestions: [{ kind: 'gap', message: 'Restoration behavior needs independent verification.', pageKeys: ['entity:atlasstore'], evidenceIds: [evidenceId], repairs: [
        draft('concept:restore-verification', 'concept', 'Restoration verification', 'Snapshot restoration performance remains unverified; keep this as a research question.', ['entity:atlasstore']),
      ] }] };
      else throw new Error('Unexpected Wiki provider operation');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"Wiki adapter fixture failed"}}');
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await action({ AMEM_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AMEM_LLM_API_KEY: 'local-test-key', AMEM_LLM_MODEL: 'wiki-fixture', AMEM_LLM_MAX_RETRIES: '0' }, operations);
  } finally { await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); }
}

function assertStructuralLint(value: unknown): void {
  const lint = value as WikiLintResult;
  assert.ok(Array.isArray(lint.issues));
  assert.equal(lint.semantic, 'not-requested');
  assert.deepEqual(lint.plans, []);
}

function mcpValue(result: { isError?: unknown; content?: unknown }): unknown {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const content = result.content as Array<{ type: string; text?: string }>;
  assert.equal(content[0]?.type, 'text');
  return JSON.parse(content[0]!.text!) as unknown;
}

async function withVault(action: (vault: MemoryVault, env: Record<string, string>) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-wiki-adapters-'));
  try {
    const vault = new MemoryVault(root);
    await vault.initialize('Wiki adapter fixture');
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('AMEM_') && entry[0] !== 'OPENAI_API_KEY'));
    Object.assign(env, { AMEM_PERMISSIONS: 'read,write,review,maintain', AMEM_ACTOR_ID: 'wiki-adapter', AMEM_ALLOWED_SCOPES: 'user,project', AMEM_MAX_SENSITIVITY: 'internal', AMEM_TENANT_ID: (await vault.config()).tenantId });
    await action(vault, env);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function withHarness(root: string, env: Record<string, string>, action: (tools: ToolRuntime, dispose: () => Promise<void>) => Promise<void>): Promise<void> {
  const saved = { ...process.env };
  let ctx: Context | undefined;
  let disposing: Promise<void> | undefined;
  const dispose = () => disposing ??= Promise.resolve(ctx?.fiber.dispose()).then(() => {});
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
    Object.assign(process.env, env);
    ctx = new Context();
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root, defaultScope: 'user', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000 });
    await action(ctx.tools, dispose);
  } finally {
    await dispose();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

let invocation = 0;
function call(tools: ToolRuntime, name: string, args: ToolExecutionInput['arguments'], signal = new AbortController().signal): Promise<ToolExecutionResult> {
  return tools.execute({ callId: `wiki-adapter-${invocation++}` as ToolExecutionInput['callId'], name, arguments: args, signal });
}

function success(result: ToolExecutionResult): unknown {
  assert.equal(result.isError, false, JSON.stringify(result));
  return result.value;
}

function assertToolError(result: ToolExecutionResult, code: string): void {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.ok(result.error);
  assert.equal((JSON.parse(result.error.message) as { error: { code: string } }).error.code, code);
}

function cliFailure(code: string): (error: unknown) => boolean {
  return (error) => {
    const failure = error as { code?: number; stderr?: string };
    assert.notEqual(failure.code, 0);
    assert.equal((JSON.parse(failure.stderr ?? '{}') as { error?: { code?: string } }).error?.code, code);
    return true;
  };
}

async function canonicalSnapshot(vault: MemoryVault): Promise<unknown> {
  const files: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.amem' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(vault.root, path)] = await readFile(path, 'utf8');
    }
  };
  await visit(vault.root);
  return { head: await vault.git.run(['rev-parse', 'HEAD']), files };
}
