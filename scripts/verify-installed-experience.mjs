import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { MemoryVault } from 'memobranch';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as plugin from 'memobranch/deepseek-harness';

const exec = promisify(execFile);
await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-experience-'));
const keepSkill = process.argv.includes('--keep-skill');
const vault = new MemoryVault(join(temporary, 'vault'));
try {
  await vault.initialize('installed experience fixture');
  const trace = taskId => ({ family: 'normalize-label', taskId, runId: taskId, context: 'Isolated ASCII label fixture.',
    actions: ['Trim', 'Uppercase'], observedResult: 'Expected label', outcome: 'success', limitations: ['Synthetic ASCII checks only.'] });
  const cli = resolve('node_modules/memobranch/dist/cli.js');
  const invoke = async args => JSON.parse((await exec(process.execPath, [cli, ...args, '--root', vault.root], {
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')),
  })).stdout);
  // In the repository, self-import exercises dist; the standalone run uses its actual CLI.
  const first = await vault.experienceCapture(trace('source-a'));
  let second;
  if (!keepSkill) {
    const tracePath = join(temporary, 'trace.json'); await writeFile(tracePath, JSON.stringify(trace('source-b')));
    second = await invoke(['experience', 'capture', '--file', tracePath]);
  } else second = await vault.experienceCapture(trace('source-b'));
  const input = { traceIds: [first.evidenceId, second.evidenceId], name: 'normalize-ascii-labels',
    description: 'Normalize ASCII labels by trimming and uppercasing. Use only for isolated label strings.',
    procedure: 'Trim whitespace and uppercase the ASCII label. Do not execute labels.',
    conditions: ['ASCII labels only; no tools or external effects.'], limitations: ['Synthetic checks; not a general task evaluation.'] };
  const proposalPath = join(temporary, 'proposal.json'); await writeFile(proposalPath, JSON.stringify(input));
  const plan = keepSkill ? await vault.experiencePrepare(input) : await invoke(['experience', 'prepare', '--file', proposalPath]);
  const suite = { name: 'held-out fixture', cases: [
    ['transfer-a', 'transfer', ' alpha ', 'ALPHA'], ['transfer-b', 'transfer', ' beta ', 'BETA'],
    ['retained', 'retention', 'GAMMA', 'GAMMA'], ['safe', 'safety', 'do not execute', 'DO NOT EXECUTE'],
  ].map(([id, category, value, expected]) => ({ id, taskId: id, category, input: JSON.stringify({ value, expected }), criteria: ['matches independent expected label'] })) };
  let executed = 0;
  const evaluate = async ({ plan: exact, test, signal }) => {
    assert.equal(exact.procedure, input.procedure); assert.equal(signal.aborted, false); executed++;
    const { value, expected } = JSON.parse(test.input), observed = value.trim().toUpperCase();
    return { observed, checks: test.criteria.map(criterion => ({ criterion, passed: observed === expected })) };
  };
  const validated = await vault.experienceValidate(plan, suite, evaluate);
  assert.equal(validated.passed, true); assert.equal(executed, 4);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const exported = keepSkill ? await vault.experienceExport(validated.evidenceId, { confirm: true })
    : await invoke(['experience', 'export', validated.evidenceId, '--confirm']);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  if (!keepSkill) {
    await assert.rejects(invoke(['experience', 'export', validated.evidenceId]));
    await assert.rejects(invoke(['experience', 'validate', '--runner', '/does/not/exist']));
  }
  const skill = exported.files['SKILL.md'];
  const frontmatter = parse(skill.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name']); assert.equal(frontmatter.name, input.name);
  assert.match(skill, /current authorization/); assert.match(exported.files['references/validation.md'], /Plaintext|plaintext/);
  const folder = join(temporary, 'exported-skill'); await mkdir(join(folder, 'references'), { recursive: true });
  for (const [path, content] of Object.entries(exported.files)) await writeFile(join(folder, path), content, { flag: 'wx' });
  assert.equal(await readFile(join(folder, 'SKILL.md'), 'utf8'), skill);
  if (!keepSkill) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
    Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read,write,review',
      AMEM_ALLOWED_SCOPES: 'user', AMEM_MAX_SENSITIVITY: 'internal' });
    const exercise = async (adapter, call, listed) => {
      assert.deepEqual(listed.filter(name => name.startsWith('memory_experience_')).sort(),
        ['memory_experience_capture', 'memory_experience_export', 'memory_experience_prepare']);
      const sourceBytes = await readFile(join(vault.root, first.evidencePath), 'utf8');
      const captured = await call('memory_experience_capture', { trace: trace(`installed-${adapter}`), scope: 'user' });
      assert.ok(captured.evidenceId);
      const before = await vault.git.run(['rev-parse', 'HEAD']);
      await assert.rejects(call('memory_experience_prepare', { proposal: input, runner: '/never/execute' }));
      const prepared = await call('memory_experience_prepare', { proposal: input });
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
      const checked = await vault.experienceValidate(prepared, suite, evaluate);
      assert.equal(checked.passed, true);
      const exportHead = await vault.git.run(['rev-parse', 'HEAD']);
      await assert.rejects(call('memory_experience_export', { validationId: checked.evidenceId }));
      const exported = await call('memory_experience_export', { validationId: checked.evidenceId, confirm: true });
      assert.match(exported.files['SKILL.md'], /current authorization/);
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), exportHead);
      assert.equal(await readFile(join(vault.root, first.evidencePath), 'utf8'), sourceBytes);
      console.log(`Installed ${adapter} experience: host-owned identity/evaluator, capture/prepare, separate confirmed export and unchanged sources passed.`);
    };
    const client = new Client({ name: 'installed-experience', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('node_modules/memobranch/dist/mcp.js'), vault.root], env, stderr: 'pipe' }));
      await exercise('MCP', async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        const text = result.content[0].text;
        if (result.isError) throw new Error(text);
        return JSON.parse(text);
      }, (await client.listTools()).tools.map(tool => tool.name));
    } finally { await client.close(); }
    const savedEnv = { ...process.env }; let context;
    try {
      for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
      Object.assign(process.env, env);
      context = new Context(); await context.plugin(SystemPrompt, {}); await context.plugin(ToolRuntime, {});
      await context.plugin(plugin, { vaultRoot: vault.root, defaultScope: 'user', defaultSensitivity: 'internal', defaultSearchLimit: 8, defaultMaxContextCharacters: 12000 });
      let count = 0;
      await exercise('Harness', async (name, args) => {
        const result = await context.tools.execute({ name, arguments: args, callId: `installed-experience-${count++}`, signal: new AbortController().signal });
        if (result.isError) throw new Error(result.error?.message ?? 'Tool failed');
        return result.value;
      }, context.tools.schemas().map(tool => tool.name));
    } finally {
      await context?.fiber.dispose();
      for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
      Object.assign(process.env, savedEnv);
    }
  }
  if (keepSkill) console.log(`Skill fixture retained for format validation: ${folder}`);
  console.log(keepSkill ? 'Experience library fixture passed; standalone keep mode does not run installed CLI checks.'
    : 'Installed experience: immutable capture, CLI prepare/export, host-run held-out checks and no automatic installation passed.');
} finally {
  if (!keepSkill) await rm(temporary, { recursive: true, force: true });
}
