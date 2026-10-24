import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Keep generated packages, consumers and test vaults in the project's ignored scratch area.
await mkdir(join(root, '.scratch'), { recursive: true });
const temporary = await mkdtemp(join(root, '.scratch', 'memobranch-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  if (process.argv.length > 3) throw new Error('Usage: npm run test:package -- [tarball]');
  const supplied = process.argv[2] ? resolve(process.argv[2]) : undefined;
  console.log('Consumer execution configuration:', JSON.stringify({ node: process.version, executable: process.execPath,
    package: supplied ?? 'fresh local pack', gitDefaultBranchOverride: process.env.GIT_CONFIG_VALUE_0 ?? null }));
  const packed = await exec(npm, supplied ? ['pack', supplied, '--dry-run', '--json', '--ignore-scripts']
    : ['pack', '--json', '--pack-destination', temporary], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const [{ filename, files }] = JSON.parse(packed.stdout);
  for (const expected of [
    'README.md', 'README_CN.md',
    'assets/logo.png', 'docs/design/llm-wiki-core.md', 'docs/releasing.md',
    'openspec/changes/align-karpathy-llm-wiki/verification.md',
    'openspec/specs/maintenance-service/spec.md',
    'dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'dist/mcp.js',
    'dist/web.js', 'dist/web.d.ts', 'dist/web-ui.js', 'dist/settings.js',
    'dist/deepseek-harness.js', 'dist/deepseek-harness.d.ts', 'cordis.patch.yml',
    'dist/wiki.js', 'dist/wiki.d.ts', 'dist/wiki-types.js', 'dist/wiki-types.d.ts',
    'dist/wiki-schema.js', 'dist/wiki-schema.d.ts',
    'dist/wiki-proof.js', 'dist/wiki-proof.d.ts',
    'dist/wiki-links.js', 'dist/wiki-links.d.ts', 'docs/wiki.md',
    'dist/review-diff.js', 'dist/onboarding.js', 'dist/integration-cli.js', 'dist/harness-memory.js',
    'docs/memory-adoption.md', 'docs/integrations.md', 'evaluation/README.md', 'evaluation/cases.mjs',
    'dist/context-budget.js', 'dist/directory-import.js', 'dist/source-timeline.js', 'docs/knowledge-workflows.md',
    'dist/web-source.js', 'dist/web-import.js', 'dist/web-import.d.ts', 'docs/public-web-import.md',
    'dist/wiki-jobs.js', 'dist/wiki-jobs.d.ts', 'dist/wiki-job-store.js', 'docs/wiki-jobs.md',
    'dist/effective-time.js', 'dist/effective-time.d.ts', 'docs/effective-time.md',
    'docs/web-effective-time.md',
    'dist/pdf-import.js', 'dist/pdf-import.d.ts', 'dist/pdf-worker.js', 'dist/pdf-evidence.js', 'docs/pdf-import.md',
    'dist/wiki-snapshot.js', 'dist/wiki-snapshot.d.ts', 'docs/wiki-revision-views.md',
    'dist/wiki-merge.js', 'dist/wiki-merge.d.ts', 'docs/manual-wiki-merge.md',
    'docs/web-manual-merge.md', 'dist/wiki-tool.js', 'dist/wiki-tool.d.ts', 'docs/agent-manual-merge.md', 'docs/dated-wiki-views.md', 'docs/web-dated-wiki-views.md',
    'dist/experience.js', 'dist/experience.d.ts', 'docs/validated-experience.md', 'docs/validated-experience_CN.md',
    'dist/experience-tool.js', 'dist/experience-tool.d.ts',
    'dist/web-experience-ui.js', 'dist/web-experience-ui.d.ts',
    'dist/knowledge-availability.js', 'dist/knowledge-availability.d.ts', 'docs/knowledge-availability.md', 'docs/knowledge-availability_CN.md',
    'dist/web-availability-ui.js', 'dist/web-availability-ui.d.ts',
  ]) {
    assert.ok(files.some(file => file.path === expected), `package is missing ${expected}`);
  }
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const sdk = [
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-session',
    '@modelcontextprotocol/client', 'typescript', '@types/node', '@types/semver',
  ]
    .map(name => `${name}@${lock.packages[`node_modules/${name}`].version}`);
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'memobranch-package-consumer', private: true, type: 'module' }));
  await exec(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', supplied ?? join(temporary, filename), ...sdk], {
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
    import { MemoryVault, startWebServer } from 'memobranch';
    import * as plugin from 'memobranch/deepseek-harness';
    const vaultRoot = join(process.cwd(), 'vault');
    const admin = new MemoryVault(vaultRoot);
    await admin.initialize('installed package smoke');
    const web = await startWebServer(vaultRoot);
    try {
      const page = await fetch(web.url);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /app.js/);
      const response = await fetch(web.url + '/api/session', { method: 'POST',
        headers: { Origin: web.url, Authorization: 'Bearer ' + web.token, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).result.name, 'installed package smoke');
      assert.equal((await fetch(web.url + '/app.js')).status, 200);
      const logo = await fetch(web.url + '/assets/logo.png');
      assert.equal(logo.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await logo.arrayBuffer()), await readFile('node_modules/memobranch/assets/logo.png'));
      console.log('Installed package: authenticated Web console and bundled assets passed.');
    } finally { await web.stop(); }
    const metadata = JSON.parse(await readFile('node_modules/memobranch/package.json', 'utf8'));
    assert.equal(plugin.VERSION, metadata.version);
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
  const version = await exec(process.execPath, [join(consumer, 'node_modules/memobranch/dist/cli.js'), '--version'], { cwd: consumer, env });
  const metadata = JSON.parse(await readFile(join(consumer, 'node_modules/memobranch/package.json'), 'utf8'));
  assert.equal(JSON.parse(version.stdout).version, metadata.version);
  await writeFile(join(consumer, 'wiki-public-types.ts'), `
    import { MemoryVault, type WikiCatalogEntry, type WikiCitation, type WikiLintResult,
      type WikiPageDraft, type WikiPageMeta, type WikiPageType, type WikiPlan,
      type WikiQueryResult, type WikiRulesMeta, type WikiPreview, type RecallResult,
      type TokenCounter, type ContextBudgetReport, type DirectoryImportPlan, type DirectoryImportOptions,
      previewDirectoryImport, applyDirectoryImport, type WebImportPlan, type WebImportOptions, type WebPreviewOptions,
      previewWebImport, applyWebImport, readWebImportPlan, serializeWebImportPlan,
      type WikiJobStatus, type WikiJobInput, type WikiJobRunOptions,
      type FactValidity, type MemoryValidityUpdate, type MemoriesAtOptions,
      previewPdfImport, applyPdfImport, readPdfOriginal, type PdfImportPlan, type PdfImportOptions, type PdfOriginal,
      type WikiSnapshot, type WikiSnapshotOptions, type WikiDatedSnapshotOptions, type WikiMergeOptions, type WikiMergeOrigin,
      type ExperienceTraceInput, type ExperiencePrepareOptions, type ExperiencePlan, type ExperienceSuite,
      startWebServer, type WebOptions, type AvailabilityObserveOptions, type AvailabilityAtOptions,
      type ExperienceRunner, type ExperienceSelection, type ExperienceValidation } from 'memobranch';
    export async function publicAvailability(vault: MemoryVault, observe: AvailabilityObserveOptions, query: AvailabilityAtOptions) {
      const recorded = await vault.wikiObserveAvailability(observe);
      const view = await vault.wikiAsKnownAt({ ...query, signal: new AbortController().signal });
      return { recorded, view, coverage: view.coverage.mode };
    }
    export async function publicExperience(vault: MemoryVault, trace: ExperienceTraceInput,
      options: ExperiencePrepareOptions, suite: ExperienceSuite, runner: ExperienceRunner) {
      const selection: ExperienceSelection = { includeSensitive: false, includeSecret: false };
      const webOptions: WebOptions = { port: 0, experienceRunner: runner };
      const web = await startWebServer(vault.root, webOptions); await web.stop();
      const recorded = await vault.experienceCapture(trace, { scope: 'project', sensitivity: 'internal' });
      const plan: ExperiencePlan = await vault.experiencePrepare({ ...options, traceIds: [recorded.evidenceId] });
      const result = await vault.experienceValidate(plan, suite, runner, { ...selection, timeoutMs: 30000, signal: new AbortController().signal });
      const report: ExperienceValidation = result.report;
      const exported = await vault.experienceExport(result.evidenceId, { ...selection, confirm: true });
      return { report, skill: exported.files['SKILL.md'] };
    }
    export async function publicManualMerge(vault: MemoryVault, options: WikiMergeOptions) {
      const prepared = await vault.wikiMergePrepare(options);
      const origin: WikiMergeOrigin | undefined = prepared.plan.merge;
      const preview = await vault.wikiPreview(prepared.plan);
      const approve = (signal: AbortSignal) => vault.wikiApply(prepared.plan, { signal });
      return { prepared, origin, preview, approve };
    }
    export async function publicRevisionView(vault: MemoryVault, commit: string) {
      const options: WikiSnapshotOptions = { commit, pageKeys: ['entity:atlas'], signal: new AbortController().signal };
      const result: WikiSnapshot = await vault.wikiSnapshot(options);
      return result;
    }
    export async function publicDatedRevisionView(vault: MemoryVault, at: string) {
      const options: WikiDatedSnapshotOptions = { at, pageKeys: ['entity:atlas'], signal: new AbortController().signal };
      const result: WikiSnapshot = await vault.wikiSnapshot(options);
      // @ts-expect-error Commit and recorded time are mutually exclusive public inputs.
      const ambiguous: WikiSnapshotOptions | WikiDatedSnapshotOptions = { commit: 'a'.repeat(40), at, pageKeys: ['entity:atlas'] };
      return { result, selection: result.selection, ambiguous };
    }
    export async function publicPdfWorkflow(vault: MemoryVault, path: string) {
      const plan: PdfImportPlan = await previewPdfImport(path);
      const options: PdfImportOptions = { scope: 'project', signal: new AbortController().signal };
      const saved = await applyPdfImport(vault, plan, options);
      const original: Buffer = await readPdfOriginal(vault, saved.evidenceId);
      return { saved, original };
    }
    export async function publicEffectiveTime(vault: MemoryVault, id: string) {
      const interval: FactValidity = { validFrom: '2026-01-01T00:00:00Z' };
      const change: MemoryValidityUpdate = { validFrom: interval.validFrom!, validUntil: null, expectedRevision: 1 };
      const options: MemoriesAtOptions = { key: 'Atlas', includeUnknown: false, limit: 10 };
      return { updated: await vault.setMemoryValidity(id, change), view: await vault.memoriesAt(change.validFrom!, options) };
    }
    export async function publicWikiWorkflow(vault: MemoryVault, evidenceId: string) {
      const prepared = await vault.wikiIngest({ evidenceIds: [evidenceId] });
      const plan: WikiPlan | null = prepared.plan;
      const preview: WikiPreview | null = plan ? await vault.wikiPreview(plan) : null;
      if (plan) await vault.wikiApply(plan);
      const recalled: RecallResult = await vault.recall('What does the source support?');
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
      return { plan, preview, recalled, catalog, citations, pageType, lint, rules, page };
    }
    export async function publicKnowledgeWorkflow(vault: MemoryVault, directory: string) {
      const counter: TokenCounter = { name: 'fixture-bytes', estimated: true, count: text => Buffer.byteLength(text) };
      const packed = await vault.contextDetailed('Atlas', { maxTokens: 100, tokenCounter: counter });
      const budget: ContextBudgetReport = packed.budget;
      const preview: DirectoryImportPlan = await previewDirectoryImport(directory);
      const options: DirectoryImportOptions = { signal: new AbortController().signal, scope: 'project' };
      const imported = await applyDirectoryImport(vault, preview, options);
      return { budget, imported, timeline: await vault.sourceTimeline('fixture:types') };
    }
    export async function publicWebWorkflow(vault: MemoryVault, urls: string[], path: string) {
      const previewOptions: WebPreviewOptions = { timeoutMs: 10000, signal: new AbortController().signal };
      const plan: WebImportPlan = await previewWebImport(urls, previewOptions);
      const options: WebImportOptions = { ...previewOptions, scope: 'project', onProgress: async progress => { void progress.result.evidenceId; } };
      return { result: await applyWebImport(vault, plan, options), saved: await readWebImportPlan(path), json: serializeWebImportPlan(plan) };
    }
    export async function publicJobWorkflow(vault: MemoryVault, evidenceId: string) {
      const input: WikiJobInput = { evidenceIds: [evidenceId], maxPages: 20 };
      const job: WikiJobStatus = await vault.wikiEnqueue(input);
      const options: WikiJobRunOptions = { id: job.id, signal: new AbortController().signal, timeoutMs: 1000 };
      return { run: await vault.wikiRunJob(options), state: await vault.wikiJob(job.id), jobs: await vault.wikiJobs(),
        plan: await vault.wikiJobPlan(job.id), preview: await vault.wikiPreviewJob(job.id), review: await vault.wikiReviewJob(job.id),
        applied: await vault.wikiApplyJob(job.id, (await vault.wikiReviewJob(job.id)).plan.proof), cancelled: await vault.wikiCancelJob(job.id),
        retried: await vault.wikiRetryJob(job.id), removed: await vault.wikiRemoveJob(job.id) };
    }
  `);
  await exec(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'),
    '--ignoreConfig', '--noEmit', '--strict', '--types', 'node', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    'wiki-public-types.ts'], { cwd: consumer, env, maxBuffer: 4 * 1024 * 1024 });
  // Copy only the consumer program: every runtime import resolves from its installed dependencies.
  await writeFile(join(consumer, 'verify-installed-wiki.mjs'), await readFile(join(root, 'scripts/verify-installed-wiki.mjs')));
  const wiki = await exec(process.execPath, ['verify-installed-wiki.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(wiki.stdout);
  await writeFile(join(consumer, 'verify-installed-adoption.mjs'), await readFile(join(root, 'scripts/verify-installed-adoption.mjs')));
  const adoption = await exec(process.execPath, ['verify-installed-adoption.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(adoption.stdout);
  await writeFile(join(consumer, 'verify-installed-knowledge.mjs'), await readFile(join(root, 'scripts/verify-installed-knowledge.mjs')));
  const knowledge = await exec(process.execPath, ['verify-installed-knowledge.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(knowledge.stdout);
  await writeFile(join(consumer, 'verify-installed-web-import.mjs'), await readFile(join(root, 'scripts/verify-installed-web-import.mjs')));
  const webImport = await exec(process.execPath, ['verify-installed-web-import.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(webImport.stdout);
  await writeFile(join(consumer, 'verify-installed-wiki-jobs.mjs'), await readFile(join(root, 'scripts/verify-installed-wiki-jobs.mjs')));
  const wikiJobs = await exec(process.execPath, ['verify-installed-wiki-jobs.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(wikiJobs.stdout);
  await writeFile(join(consumer, 'verify-installed-pdf.mjs'), await readFile(join(root, 'scripts/verify-installed-pdf.mjs')));
  await writeFile(join(consumer, 'pdf-fixture.base64'), await readFile(join(root, 'test/fixtures/pdf-text.base64')));
  const pdf = await exec(process.execPath, ['verify-installed-pdf.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(pdf.stdout);
  await writeFile(join(consumer, 'verify-installed-snapshot.mjs'), await readFile(join(root, 'scripts/verify-installed-snapshot.mjs')));
  const snapshot = await exec(process.execPath, ['verify-installed-snapshot.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(snapshot.stdout);
  await writeFile(join(consumer, 'verify-installed-merge.mjs'), await readFile(join(root, 'scripts/verify-installed-merge.mjs')));
  const merge = await exec(process.execPath, ['verify-installed-merge.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(merge.stdout);
  await writeFile(join(consumer, 'verify-installed-web-dated-wiki.mjs'), await readFile(join(root, 'scripts/verify-installed-web-dated-wiki.mjs')));
  await writeFile(join(consumer, 'verify-installed-dated-wiki.mjs'), await readFile(join(root, 'scripts/verify-installed-dated-wiki.mjs')));
  const datedWiki = await exec(process.execPath, ['verify-installed-dated-wiki.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(datedWiki.stdout);
  await writeFile(join(consumer, 'verify-installed-experience.mjs'), await readFile(join(root, 'scripts/verify-installed-experience.mjs')));
  const experience = await exec(process.execPath, ['verify-installed-experience.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(experience.stdout);
  await writeFile(join(consumer, 'verify-installed-availability.mjs'), await readFile(join(root, 'scripts/verify-installed-availability.mjs')));
  const availability = await exec(process.execPath, ['verify-installed-availability.mjs'], {
    cwd: consumer, env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  });
  process.stdout.write(availability.stdout);
  console.log(`Package verification passed (${files.length} packed entries).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
