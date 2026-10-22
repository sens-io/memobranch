import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { MemoryVault } from 'memobranch';

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
  const validated = await vault.experienceValidate(plan, suite, async ({ plan: exact, test, signal }) => {
    assert.equal(exact.procedure, input.procedure); assert.equal(signal.aborted, false); executed++;
    const { value, expected } = JSON.parse(test.input), observed = value.trim().toUpperCase();
    return { observed, checks: test.criteria.map(criterion => ({ criterion, passed: observed === expected })) };
  });
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
  if (keepSkill) console.log(`Skill fixture retained for format validation: ${folder}`);
  console.log(keepSkill ? 'Experience library fixture passed; standalone keep mode does not run installed CLI checks.'
    : 'Installed experience: immutable capture, CLI prepare/export, host-run held-out checks and no automatic installation passed.');
} finally {
  if (!keepSkill) await rm(temporary, { recursive: true, force: true });
}
