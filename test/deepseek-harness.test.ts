import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { apply, inject, name, type Config } from '../src/deepseek-harness.js';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];
const environmentKeys = ['AMEM_VAULT', 'AMEM_ACTOR_ID', 'AMEM_ACTOR_NAME', 'AMEM_PERMISSIONS', 'AMEM_ALLOWED_SCOPES', 'AMEM_MAX_SENSITIVITY', 'AMEM_TENANT_ID'] as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('DeepSeek Harness plugin exports lifecycle metadata and bundle packaging', async () => {
  assert.equal(name, 'memobranch-deepseek-harness');
  assert.deepEqual(inject, ['tools']);
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual((packageJson.dsh as { bundle: { patch: string } }).bundle, { patch: './cordis.patch.yml' });
  assert.match(await readFile(join(process.cwd(), 'cordis.patch.yml'), 'utf8'), /memobranch\/deepseek-harness/);
  assert.ok((packageJson.files as string[]).includes('cordis.patch.yml'));
});

test('plugin exposes only principal-granted categories and executes real vault calls', async () => {
  const root = await freshVault();
  const tenantId = (await new MemoryVault(root).config()).tenantId;
  await withEnvironment({
    AMEM_VAULT: root,
    AMEM_ACTOR_ID: 'harness-agent',
    AMEM_ACTOR_NAME: 'Harness Agent',
    AMEM_PERMISSIONS: 'read,write,review,maintain',
    AMEM_ALLOWED_SCOPES: 'user,project',
    AMEM_MAX_SENSITIVITY: 'internal',
    AMEM_TENANT_ID: tenantId,
  }, async () => {
    const disposers: Array<() => unknown> = [];
    const tools = loadPlugin(defaultConfig(''), disposers);
    assert.deepEqual([...tools.keys()].sort(), [
      'memory_capture', 'memory_config', 'memory_consolidate', 'memory_context', 'memory_doctor',
      'memory_forget', 'memory_get', 'memory_history', 'memory_maintenance', 'memory_policy',
      'memory_propose', 'memory_recover', 'memory_reindex', 'memory_review', 'memory_search', 'memory_version',
    ]);
    assert.equal(tools.has('memory_erase'), false);
    assert.equal(tools.has('memory_remote_sync'), false);
    assert.equal(disposers.length, 1, 'provider cancellation cleanup must be lifecycle-owned');
    for (const definition of tools.values()) {
      assert.equal(definition.isConcurrencySafe, undefined, `${definition.name} must remain exclusive`);
      assert.doesNotMatch(JSON.stringify(definition.parameters), /actorId|actorName|permissions|tenantId|masterKey|apiKey/i);
    }

    const captured = await execute(tools, 'memory_capture', { content: 'DeepSeek Harness remembers native plugins.', scope: 'project', sensitivity: 'internal' }) as { evidenceId: string };
    assert.match(captured.evidenceId, /^ev-/);
    const proposed = await execute(tools, 'memory_propose', {
      statement: 'DeepSeek Harness uses native Cordis plugins.',
      key: 'harness integration',
      kind: 'fact',
      scope: 'project',
      sensitivity: 'internal',
      confidence: 1,
      explicit: true,
      evidence: [],
    }) as { id: string };
    assert.match(proposed.id, /^cand-/);
    await execute(tools, 'memory_consolidate', {});
    const context = await execute(tools, 'memory_context', { query: 'Cordis plugins' });
    assert.match(String(context), /native Cordis plugins/);
    const history = await new MemoryVault(root).history();
    assert.equal(history[0]?.author, 'Harness Agent');
  });
});

test('read-only visibility, argument bounds, and pre-dispatch cancellation fail closed', async () => {
  const root = await freshVault();
  const config = await new MemoryVault(root).config();
  await withEnvironment({
    AMEM_ACTOR_ID: 'reader',
    AMEM_PERMISSIONS: 'read',
    AMEM_ALLOWED_SCOPES: 'user',
    AMEM_MAX_SENSITIVITY: 'internal',
    AMEM_TENANT_ID: config.tenantId,
  }, async () => {
    const tools = loadPlugin(defaultConfig(root));
    assert.deepEqual([...tools.keys()].sort(), [
      'memory_config', 'memory_context', 'memory_get', 'memory_history', 'memory_policy', 'memory_search', 'memory_version',
    ]);
    await assert.rejects(execute(tools, 'memory_search', { query: 'x', limit: 51 }), /VALIDATION_FAILED/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(execute(tools, 'memory_context', { query: 'x' }, controller.signal), /OPERATION_CANCELLED/);
  });
});

test('invalid direct config fails before registering a tool', () => {
  const definitions = new Map<string, ToolDefinition>();
  const ctx = mockContext(definitions);
  assert.throws(() => apply(ctx, { ...defaultConfig('.'), defaultSearchLimit: 0 }), /VALIDATION_FAILED/);
  assert.equal(definitions.size, 0);
});

async function freshVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-dsh-'));
  roots.push(root);
  await new MemoryVault(root).initialize('deepseek-harness-test');
  return root;
}

function defaultConfig(vaultRoot: string): Config {
  return { vaultRoot, defaultScope: 'user', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000 };
}

function loadPlugin(config: Config, disposers: Array<() => unknown> = []): Map<string, ToolDefinition> {
  const definitions = new Map<string, ToolDefinition>();
  apply(mockContext(definitions, disposers), config);
  return definitions;
}

function mockContext(definitions: Map<string, ToolDefinition>, disposers: Array<() => unknown> = []): Context {
  return {
    effect(executeEffect: () => unknown) {
      const disposer = executeEffect();
      if (typeof disposer === 'function') disposers.push(disposer as () => unknown);
      return undefined;
    },
    tools: { register(definition: ToolDefinition) {
      assert.equal(definitions.has(definition.name), false, `duplicate tool ${definition.name}`);
      definitions.set(definition.name, definition);
      return () => { definitions.delete(definition.name); };
    } },
  } as unknown as Context;
}

async function execute(definitions: Map<string, ToolDefinition>, toolName: string, args: unknown, signal = new AbortController().signal): Promise<unknown> {
  const definition = definitions.get(toolName);
  assert.ok(definition, `missing tool ${toolName}`);
  return definition.execute(args, { signal } as ToolRunContext);
}

async function withEnvironment(values: Partial<Record<(typeof environmentKeys)[number], string>>, action: () => Promise<void>): Promise<void> {
  const original = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) delete process.env[key];
    Object.assign(process.env, values);
    await action();
  } finally {
    for (const key of environmentKeys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
