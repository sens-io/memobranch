import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'memobranch-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const packed = await exec(npm, ['pack', '--json', '--pack-destination', temporary], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const [{ filename, files }] = JSON.parse(packed.stdout);
  for (const expected of ['dist/index.js', 'dist/deepseek-harness.js', 'dist/deepseek-harness.d.ts', 'cordis.patch.yml']) {
    assert.ok(files.some(file => file.path === expected), `package is missing ${expected}`);
  }
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const sdk = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt']
    .map(name => `${name}@${lock.packages[`node_modules/${name}`].version}`);
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'memobranch-package-consumer', private: true, type: 'module' }));
  await exec(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, filename), ...sdk], {
    cwd: consumer, maxBuffer: 4 * 1024 * 1024,
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  const result = await exec(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { Context } from '@deepseek-ai/cordis';
    import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
    import { ToolRuntime } from '@deepseek-ai/dsh-tools';
    import { MemoryVault } from 'memobranch';
    import * as plugin from 'memobranch/deepseek-harness';
    const vaultRoot = join(process.cwd(), 'vault');
    const admin = new MemoryVault(vaultRoot);
    await admin.initialize('installed package smoke');
    const metadata = JSON.parse(await readFile('node_modules/memobranch/package.json', 'utf8'));
    const patch = await readFile(join('node_modules/memobranch', metadata.dsh.bundle.patch), 'utf8');
    assert.match(patch, /name: memobranch\\/deepseek-harness/);
    Object.assign(process.env, { AMEM_PERMISSIONS: 'write', AMEM_ALLOWED_SCOPES: 'user',
      AMEM_MAX_SENSITIVITY: 'internal', AMEM_TENANT_ID: (await admin.config()).tenantId });
    const ctx = new Context();
    try {
      await ctx.plugin(SystemPrompt, {});
      await ctx.plugin(ToolRuntime, {});
      await ctx.plugin(plugin, { vaultRoot });
      const names = ctx.tools.schemas().map(tool => tool.name);
      assert.ok(names.includes('memory_capture'));
      assert.ok(!names.includes('memory_get'));
      const result = await ctx.tools.execute({ name: 'memory_capture', callId: 'installed-smoke',
        arguments: { content: 'Installed plugin records durable evidence.', extract: false }, signal: new AbortController().signal });
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.ok(result.value.evidenceId);
      assert.match((await admin.get(result.value.evidenceId)).body, /Installed plugin records durable evidence/);
      console.log('Installed package: exports, bundle patch, real Harness capture and permission visibility passed.');
    } finally { await ctx.fiber.dispose(); }
  `], { cwd: consumer, env, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  await exec(process.execPath, [join(consumer, 'node_modules/memobranch/dist/cli.js'), '--help'], { cwd: consumer, env });
  console.log(`Package verification passed (${files.length} packed entries).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
