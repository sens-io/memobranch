import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from '../src/deepseek-harness.js';
import { MemoryVault } from '../src/vault.js';
import { EncryptionManager } from '../src/encryption.js';
import { experienceToolInput, experienceToolResult, experienceCaptureToolSchema, experiencePrepareToolSchema, experienceExportToolSchema } from '../src/experience-tool.js';
import type { ExperiencePlan, ExperienceSuite } from '../src/experience.js';

const names = ['memory_experience_capture', 'memory_experience_export', 'memory_experience_prepare'];
const trace = (taskId: string) => ({ family: 'labels', taskId, runId: taskId, context: 'Isolated label normalization.',
  actions: ['Trim', 'Uppercase'], observedResult: 'Normalized label', outcome: 'success', limitations: ['Synthetic fixture only.'] });
const proposal = (traceIds: string[]) => ({ traceIds, name: 'normalize-labels', description: 'Trim and uppercase isolated ASCII labels.',
  procedure: 'Trim then uppercase ASCII label strings. Never execute labels.', conditions: ['Only isolated ASCII labels.'], limitations: ['Not validated on real tasks.'] });
const suite: ExperienceSuite = { name: 'held-out fixture', cases: [
  ['a', 'transfer'], ['b', 'transfer'], ['c', 'retention'], ['d', 'safety'],
].map(([id, category]) => ({ id: id!, taskId: `held-${id}`, category: category as 'transfer' | 'retention' | 'safety',
  input: JSON.stringify({ value: ' delta ', expected: 'DELTA' }), criteria: ['normalizes label'] })) };
type Invoke = (name: string, args: Record<string, unknown>) => Promise<unknown>;

async function fixture(t: TestContext) {
  await mkdir('.scratch', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/experience-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '49'.repeat(32) }); await vault.initialize('experience adapter');
  const env = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined && !item[0].startsWith('AMEM_') && item[0] !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read,write,review',
    AMEM_ALLOWED_SCOPES: 'user,project', AMEM_MAX_SENSITIVITY: 'secret', AMEM_MASTER_KEY: '49'.repeat(32) });
  return { root, vault, env };
}
async function adapter(kind: 'MCP' | 'Harness', root: string, env: Record<string, string>, action: (invoke: Invoke, listed: string[]) => Promise<void>) {
  if (kind === 'MCP') {
    const client = new Client({ name: 'experience-test', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'dist/mcp.js'), root], env, stderr: 'pipe' }));
      await action(async (name, args) => {
        const value = await client.callTool({ name, arguments: args });
        const text = (value.content as Array<{ type: string; text: string }>)[0]!.text;
        if (value.isError) throw new Error(text);
        return JSON.parse(text) as unknown;
      }, (await client.listTools()).tools.map(tool => tool.name));
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }; let ctx: Context | undefined;
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
    Object.assign(process.env, env);
    ctx = new Context(); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: root, defaultScope: 'project', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12_000 });
    let count = 0;
    const tools = ctx.tools;
    await action(async (name, args) => {
      const result = await tools.execute({ callId: `experience-${count++}` as ToolExecutionInput['callId'], name,
        arguments: args as ToolExecutionInput['arguments'], signal: new AbortController().signal });
      if (result.isError) throw new Error(result.error?.message ?? 'Tool failed');
      return result.value;
    }, tools.schemas().map(tool => tool.name));
  } finally {
    await ctx?.fiber.dispose();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

for (const kind of ['MCP', 'Harness'] as const) {
  test(`${kind} experience: real tools capture, prepare and export without automatic validation or installation`, async t => {
    const { root, vault, env } = await fixture(t);
    await adapter(kind, root, env, async (invoke, listed) => {
      assert.deepEqual(listed.filter(name => name.startsWith('memory_experience_')).sort(), names);
      const first = await invoke('memory_experience_capture', { trace: trace('source-a') }) as { evidenceId: string };
      assert.equal((await vault.get(first.evidenceId)).meta.scope, kind === 'Harness' ? 'project' : 'user');
      const second = await invoke('memory_experience_capture', { trace: trace('source-b'), scope: kind === 'Harness' ? 'project' : 'user' }) as { evidenceId: string };
      const input = proposal([first.evidenceId, second.evidenceId]), before = await vault.git.run(['rev-parse', 'HEAD']);
      for (const [name, args] of [
        ['memory_experience_capture', { trace: trace('bad'), permissions: ['admin'] }],
        ['memory_experience_capture', { trace: { ...trace('bad'), actor: 'other' } }],
        ['memory_experience_prepare', { proposal: { ...input, runner: '/untrusted/module.js' } }],
        ['memory_experience_prepare', { proposal: input, tenantId: 'other' }],
        ['memory_experience_export', { validationId: first.evidenceId, confirm: false }],
        ['memory_experience_export', { validationId: first.evidenceId, confirm: true, install: true }],
      ] as const) await assert.rejects(invoke(name, args));
      const plan = await invoke('memory_experience_prepare', { proposal: input }) as ExperiencePlan;
      assert.equal(plan.procedure, input.procedure); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
      assert.equal((await vault.listRecords({ collection: 'memories' })).total, 0);
      let calls = 0;
      const validated = await vault.experienceValidate(plan, suite, async ({ plan: exact, test, signal }) => {
        calls++; assert.equal(signal.aborted, false); assert.equal(exact.procedure, input.procedure);
        const { value, expected } = JSON.parse(test.input) as { value: string; expected: string }, observed = value.trim().toUpperCase();
        return { observed, checks: test.criteria.map(criterion => ({ criterion, passed: observed === expected })) };
      });
      assert.equal(calls, 4); assert.equal(validated.passed, true);
      const exportHead = await vault.git.run(['rev-parse', 'HEAD']);
      await assert.rejects(invoke('memory_experience_export', { validationId: validated.evidenceId }));
      const exported = await invoke('memory_experience_export', { validationId: validated.evidenceId, confirm: true }) as { files: Record<string, string> };
      assert.match(exported.files['SKILL.md']!, /current authorization/);
      assert.deepEqual(Object.keys(exported.files).sort(), ['SKILL.md', 'references/validation.md']);
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), exportHead);
    });
  });

  test(`${kind} experience: confidential selection and erased sources remain enforced`, async t => {
    const { root, vault, env } = await fixture(t);
    await adapter(kind, root, env, async invoke => {
      const ids: string[] = [];
      for (const task of ['private-a', 'private-b']) ids.push((await invoke('memory_experience_capture', {
        trace: trace(task), scope: 'user', sensitivity: 'secret',
      }) as { evidenceId: string }).evidenceId);
      const input = proposal(ids); await assert.rejects(invoke('memory_experience_prepare', { proposal: input }));
      const plan = await invoke('memory_experience_prepare', { proposal: { ...input, includeSecret: true } }) as ExperiencePlan;
      const validation = await vault.experienceValidate(plan, suite, async ({ test }) => ({ observed: 'Fixture completed',
        checks: test.criteria.map(criterion => ({ criterion, passed: true })) }), { includeSecret: true });
      await assert.rejects(invoke('memory_experience_export', { validationId: validation.evidenceId, confirm: true }));
      await invoke('memory_experience_export', { validationId: validation.evidenceId, confirm: true, includeSecret: true });
      await new EncryptionManager(root, '49'.repeat(32)).erase(ids[0]!);
      await assert.rejects(invoke('memory_experience_export', { validationId: validation.evidenceId, confirm: true, includeSecret: true }));
    });
  });
}

test('Harness experience: combined grants determine registration; no evaluator tool exists', async t => {
  const { root, env } = await fixture(t);
  for (const [permissions, expected] of [
    ['read', []], ['write', ['memory_experience_capture']], ['review', []],
    ['read,write', ['memory_experience_capture', 'memory_experience_prepare']],
    ['read,review', ['memory_experience_export']], ['admin', names],
  ] as const) await adapter('Harness', root, { ...env, AMEM_PERMISSIONS: permissions }, async (_invoke, listed) => {
    assert.deepEqual(listed.filter(name => name.startsWith('memory_experience_')).sort(), [...expected].sort());
  });
});

test('MCP experience: visible tools still deny a read-only caller before mutation', async t => {
  const { root, vault, env } = await fixture(t), head = await vault.git.run(['rev-parse', 'HEAD']);
  await adapter('MCP', root, { ...env, AMEM_PERMISSIONS: 'read' }, async invoke => {
    await assert.rejects(invoke('memory_experience_capture', { trace: trace('denied') }));
    await assert.rejects(invoke('memory_experience_prepare', { proposal: proposal(['ev-000000000001', 'ev-000000000002']) }));
    await assert.rejects(invoke('memory_experience_export', { validationId: 'ev-000000000003', confirm: true }));
  });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('experience tool schemas reject host/execution fields and complete outputs fail rather than truncate', () => {
  for (const [schema, input] of [
    [experienceCaptureToolSchema, { trace: trace('a'), signal: {} }],
    [experiencePrepareToolSchema, { proposal: { ...proposal(['ev-000000000001']), evaluator: 'script' } }],
    [experienceExportToolSchema, { validationId: 'ev-000000000001', confirm: true, root: '/other' }],
  ] as const) assert.throws(() => experienceToolInput<unknown>(schema, input), { code: 'VALIDATION_FAILED' });
  const small = { files: { 'SKILL.md': 'Complete content' } }; assert.equal(experienceToolResult(small), small);
  assert.throws(() => experienceToolResult({ files: { 'SKILL.md': '\\'.repeat(2_400_000) } }), { code: 'CONTENT_TOO_LARGE' });
});
