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
  for (const expected of [
    'dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'dist/mcp.js',
    'dist/deepseek-harness.js', 'dist/deepseek-harness.d.ts', 'cordis.patch.yml',
    'dist/wiki.js', 'dist/wiki.d.ts', 'dist/wiki-types.js', 'dist/wiki-types.d.ts',
    'dist/wiki-schema.js', 'dist/wiki-schema.d.ts',
    'dist/wiki-proof.js', 'dist/wiki-proof.d.ts',
    'dist/wiki-links.js', 'dist/wiki-links.d.ts', 'docs/wiki.md',
  ]) {
    assert.ok(files.some(file => file.path === expected), `package is missing ${expected}`);
  }
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const sdk = [
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt',
    '@modelcontextprotocol/client', 'typescript', '@types/node', '@types/semver',
  ]
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
  await writeFile(join(consumer, 'wiki-public-types.ts'), `
    import { MemoryVault, type WikiCatalogEntry, type WikiCitation, type WikiLintResult,
      type WikiPageDraft, type WikiPageMeta, type WikiPageType, type WikiPlan,
      type WikiQueryResult, type WikiRulesMeta } from 'memobranch';
    export async function publicWikiWorkflow(vault: MemoryVault, evidenceId: string) {
      const prepared = await vault.wikiIngest({ evidenceIds: [evidenceId] });
      const plan: WikiPlan | null = prepared.plan;
      if (plan) await vault.wikiApply(plan);
      const catalog: WikiCatalogEntry[] = await vault.wikiCatalog();
      const result: WikiQueryResult = await vault.wikiQuery('What does the source support?');
      const citations: WikiCitation[] = result.citations;
      const filed = await vault.wikiFile(result, { title: 'Source comparison', pageType: 'comparison' });
      const draft: WikiPageDraft = filed.plan.pages[0]!;
      const pageType: WikiPageType = draft.pageType;
      const lint: WikiLintResult = await vault.wikiLint({ semantic: true });
      if (lint.plans[0]) await vault.wikiApply(lint.plans[0]);
      const rules: WikiRulesMeta[] = (await vault.wikiRules()).map(rule => rule.meta);
      const page: Pick<WikiPageMeta, 'id' | 'pageType'> | undefined = catalog[0]
        ? { id: catalog[0].id, pageType: catalog[0].pageType } : undefined;
      return { plan, catalog, citations, pageType, lint, rules, page };
    }
  `);
  await exec(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--types', 'node', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    'wiki-public-types.ts'], { cwd: consumer, env, maxBuffer: 4 * 1024 * 1024 });
  // Copy only the consumer program: every runtime import resolves from its installed dependencies.
  await writeFile(join(consumer, 'verify-installed-wiki.mjs'), await readFile(join(root, 'scripts/verify-installed-wiki.mjs')));
  const wiki = await exec(process.execPath, ['verify-installed-wiki.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(wiki.stdout);
  console.log(`Package verification passed (${files.length} packed entries).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
