import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { operationSignal, withOperation } from '../src/operation.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPagePath } from '../src/wiki-schema.js';
import type { WikiPageDraft, WikiPageMeta, WikiPlan, WikiReceiptMeta } from '../src/wiki-types.js';

const exec = promisify(execFile);
const roots: string[] = [];
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const firstFact = 'AtlasStore supports daily snapshots for project deployments, verified 2026-09-01.';
const secondFact = 'AtlasStore restores to a separate instance; in-place restoration is unsupported, verified 2026-09-02.';

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class RecoveryCompiler extends LlmClient {
  calls = 0;
  marker = '';
  constructor() { super({ apiKey: 'fixture', model: 'wiki-recovery-fixture', embeddingModel: '' }); }
  override async wiki<T = unknown>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    this.calls += 1;
    const dto = input as {
      catalog: Array<{ key: string }>;
      sources: Array<{ id: string; body: string }>;
      pages: Array<WikiPageMeta & { body: string }>;
    };
    if (operation === 'navigate') return { keys: dto.catalog.map((page) => page.key) } as T;
    if (operation === 'query') return { answer: `${firstFact}\n${secondFact}`, citations: ['entity:atlas'], uncertainty: ['Restoration speed is unverified.'] } as T;
    if (operation === 'lint') return { suggestions: [] } as T;
    const ids = dto.sources.map((source) => source.id);
    const old = dto.pages.find((page) => page.key === 'entity:atlas');
    const sourceKeys = [...new Set([...dto.pages.filter((page) => page.pageType === 'source').map((page) => page.key), ...ids.map((id) => `source:${id}`)])];
    const draft = (key: string, pageType: WikiPageDraft['pageType'], title: string, body: string, links: string[]): WikiPageDraft => ({
      key, pageType, title, summary: title, body: `# ${title}\n\n${body}`, evidenceIds: ids, links,
      status: 'active', conditions: ['For project deployments.'], uncertainty: [],
    });
    return { pages: [
      ...dto.sources.map((source) => draft(`source:${source.id}`, 'source', 'AtlasStore source', source.body, [])),
      draft('entity:atlas', 'entity', 'AtlasStore', `${old?.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0] ?? ''}\n${dto.sources.map((source) => source.body).join('\n')}\n${this.marker}`, sourceKeys),
      draft('synthesis:backup', 'synthesis', 'AtlasStore backup workflow', `Snapshots and separate-instance restoration form a recoverable backup workflow. ${this.marker}`, ['entity:atlas']),
    ] } as T;
  }
}

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `memobranch-wiki-recovery-${name}-`));
  roots.push(root);
  return root;
}

function reopen(root: string, llm = new RecoveryCompiler()): MemoryVault { return new MemoryVault(root, { llm }); }

async function fixture() {
  const llm = new RecoveryCompiler();
  const vault = reopen(await temporary('vault'), llm);
  await vault.initialize('Wiki recovery acceptance');
  await vault.wikiSetRules({ purpose: 'Preserve scoped backup knowledge.', instructions: 'Keep source conditions and verification dates.', scope: 'public', sensitivity: 'public' });
  const first = await vault.capture({ content: firstFact, scope: 'public', sensitivity: 'public', extract: false });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  return { vault, llm, first };
}

async function pendingFixture() {
  const base = await fixture();
  const second = await base.vault.capture({ content: secondFact, scope: 'public', sensitivity: 'public', extract: false });
  const plan = (await base.vault.wikiIngest({ evidenceIds: [second.evidenceId] })).plan!;
  assert.equal(plan.pages.length, 3, 'one new source and two existing pages form the atomic change');
  return { ...base, second, plan, before: await canonical(base.vault), evidence: await fileBytes(join(base.vault.root, 'evidence')) };
}

async function fileBytes(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!relative && (entry.name === '.amem' || entry.name === '.git')) continue;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await fileBytes(root, path));
    else result[path] = entry.isSymbolicLink() ? `symlink:${await readlink(join(root, path))}` : (await readFile(join(root, path))).toString('base64');
  }
  return result;
}

async function canonical(vault: MemoryVault) {
  return { head: await vault.git.run(['rev-parse', 'HEAD']), files: await fileBytes(vault.root), staged: await vault.git.run(['diff', '--cached', '--binary']) };
}

async function journals(root: string) {
  const directory = join(root, '.amem', 'transactions');
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async (name) => [name, JSON.parse(await readFile(join(directory, name), 'utf8')) as { phase: string; writes: Record<string, unknown> }] as const)));
}

async function assertUnlocked(root: string): Promise<void> {
  assert.equal(existsSync(join(root, '.amem', 'write.lock')), false);
  assert.deepEqual(await readdir(join(root, '.amem', 'write.lock.queue')), []);
  assert.deepEqual(await journals(root), {});
}

async function until(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!await condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Hooks observe completed real writes/Git commands. SIGKILL prevents catch/finally
// cleanup, so the next vault instance must consume the actual durable journal.
const workerSource = `
import { MemoryVault } from ${JSON.stringify(new URL('../src/vault.ts', import.meta.url).href)};
import { LlmClient } from ${JSON.stringify(new URL('../src/llm.ts', import.meta.url).href)};
import { VaultTransaction } from ${JSON.stringify(new URL('../src/transaction.ts', import.meta.url).href)};
const [root, encodedPlan, encodedSettings] = process.argv.slice(1);
const plan = JSON.parse(encodedPlan), settings = JSON.parse(encodedSettings);
const vault = new MemoryVault(root, { llm: new LlmClient({ apiKey: 'fixture', model: 'wiki-recovery-fixture', embeddingModel: '' }) });
const message = (value) => new Promise((resolve) => process.send(value, resolve));
const resume = () => new Promise((resolve) => process.once('message', resolve));
const stop = async (boundary) => { if (settings.boundary === boundary) { await message({ boundary }); process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); } };
let pageWrites = 0;
const write = VaultTransaction.prototype.write;
VaultTransaction.prototype.write = async function(path, content) {
  await write.call(this, path, content);
  if (path.startsWith('wiki/pages/')) {
    pageWrites += 1;
    await stop('page-' + pageWrites);
    if (settings.pauseFirst && pageWrites === 1) { const wait = resume(); await message({ paused: true }); await wait; }
  }
  if (path.startsWith('wiki/.meta/wi-')) await stop('receipt');
  if (path === 'log.md') await stop('log');
  if (path === 'WIKI.md') await stop('catalog');
};
const commit = vault.git.commit.bind(vault.git);
vault.git.commit = async (...args) => { await stop('ready'); return commit(...args); };
const run = vault.git.run.bind(vault.git);
vault.git.run = async (...args) => { const result = await run(...args); if (args[0][0] === 'commit') await stop('commit'); return result; };
const reindex = vault.reindex.bind(vault);
vault.reindex = async (...args) => { await stop('index-start'); const result = await reindex(...args); await stop('index-done'); return result; };
if (settings.waitStart) { const wait = resume(); await message({ started: true }); await wait; }
try { const result = await vault.wikiApply(plan); await message({ result }); }
catch (error) { await message({ error: { code: error.code, message: error.message, details: error.safeDetails } }); }
process.disconnect();
`;

function worker(root: string, plan: WikiPlan, settings: { boundary?: string; pauseFirst?: boolean; waitStart?: boolean }) {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', workerSource, root, JSON.stringify(plan), JSON.stringify(settings)], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages: Array<{ boundary?: string; paused?: boolean; started?: boolean; result?: { pageIds: string[]; commit: string | null }; error?: { code: string; message: string } }> = [];
  let stderr = '';
  child.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });
  child.stdout!.resume();
  child.on('message', (value) => { messages.push(value as typeof messages[number]); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  return { child, messages, completed, diagnostic: () => stderr };
}

async function crash(root: string, plan: WikiPlan, boundary: string): Promise<void> {
  const running = worker(root, plan, { boundary });
  assert.deepEqual(await running.completed, { code: null, signal: 'SIGKILL' }, running.diagnostic());
  assert.deepEqual(running.messages, [{ boundary }], `the requested boundary must be reached: ${running.diagnostic()}`);
}

async function assertComplete(fixture: Awaited<ReturnType<typeof pendingFixture>>): Promise<void> {
  const { vault, before, evidence, first, second, plan } = fixture;
  const fresh = reopen(vault.root);
  const catalog = await fresh.wikiCatalog();
  assert.equal(catalog.length, 4);
  assert.equal(await fresh.git.run(['rev-list', '--count', `${before.head}..HEAD`]), '1', 'exactly one semantic commit survives recovery');
  const head = await fresh.git.run(['rev-parse', 'HEAD']);
  assert.equal(await fresh.git.run(['rev-parse', `${head}^`]), before.head);
  assert.equal(await fresh.git.run(['show', '-s', '--format=%s', head]), 'wiki: wiki-apply');
  assert.equal(await fresh.git.run(['show', '-s', '--format=%an', head]), fresh.principal.name);
  const paths = new Set((await fresh.git.run(['diff-tree', '--no-commit-id', '--name-only', '-r', head])).split('\n'));
  for (const path of [...plan.pages.map((page) => wikiPagePath(page.key)), `wiki/.meta/${plan.receiptId}.md`, 'log.md', 'WIKI.md']) assert.ok(paths.has(path), `commit contains ${path}`);
  const entity = catalog.find((page) => page.key === 'entity:atlas')!;
  assert.equal(entity.revision, 2);
  const document = await fresh.get(entity.id);
  assert.ok(document.body.includes(firstFact));
  assert.ok(document.body.includes(secondFact));
  assert.deepEqual(new Set(document.meta.evidence as string[]), new Set([first.evidencePath, second.evidencePath]));
  for (const entry of catalog) {
    const page = await fresh.get(entry.id);
    assert.equal(page.meta.revision, entry.revision);
    assert.equal(page.meta.scope, 'public');
    assert.equal(page.meta.sensitivity, 'public');
    for (const key of entry.links) assert.ok(catalog.some((target) => target.key === key));
    assert.ok((await readFile(join(vault.root, 'WIKI.md'), 'utf8')).includes(entry.path));
  }
  const log = await readFile(join(vault.root, 'log.md'), 'utf8');
  const originalLog = Buffer.from(before.files['log.md']!, 'base64').toString();
  assert.ok(log.startsWith(originalLog));
  const events = [...log.slice(originalLog.length).matchAll(/<!-- wiki-event (.*?) -->/g)].map((match) => JSON.parse(match[1]!));
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'wiki-compile');
  assert.equal(events[0].parentCommit, before.head);
  assert.deepEqual(new Set(events[0].pageIds), new Set(plan.pages.map((page) => catalog.find((entry) => entry.key === page.key)!.id)));
  assert.deepEqual(await fileBytes(join(vault.root, 'evidence')), evidence);
  assert.ok((await fresh.search('AtlasStore')).some((hit) => hit.id === entity.id));
  await assertUnlocked(vault.root);
  assert.equal((await fresh.git.integrity()).dirty, false);
}

for (const boundary of ['page-1', 'page-2', 'page-3', 'receipt', 'log', 'catalog', 'ready', 'commit', 'index-start', 'index-done']) {
  test(`S08: child termination after Wiki ${boundary} restores or completes the entire canonical set`, { timeout: 30_000 }, async () => {
    const f = await pendingFixture();
    await crash(f.vault.root, f.plan, boundary);
    const pending = Object.values(await journals(f.vault.root));
    const durable = ['ready', 'commit', 'index-start', 'index-done'].includes(boundary);
    assert.equal(pending.length, boundary.startsWith('index-') ? 0 : 1);
    if (pending.length) assert.equal(pending[0]!.phase, durable ? 'ready' : 'writing');
    assert.deepEqual(await fileBytes(join(f.vault.root, 'evidence')), f.evidence);
    const fresh = reopen(f.vault.root);
    const result = await fresh.recover();
    if (!durable) {
      assert.equal(result.rolledBack.length, 1);
      assert.deepEqual(await canonical(fresh), f.before, 'old page bytes, new-file absence, catalog, log, HEAD and index are restored');
      assert.equal((await fresh.wikiCatalog()).length, 3);
      await assertUnlocked(f.vault.root);
      assert.ok((await fresh.wikiApply(f.plan)).commit, 'a later session can finish the interrupted operation');
    } else {
      assert.equal(result.rolledBack.length, 0);
      assert.equal(result.replayed.length, boundary.startsWith('index-') ? 0 : 1);
    }
    await assertComplete(f);
    const settled = await canonical(fresh);
    assert.deepEqual(await reopen(f.vault.root).recover(), { rolledBack: [], replayed: [], commits: [] });
    assert.deepEqual(await reopen(f.vault.root).wikiApply(f.plan), { pageIds: [], commit: null });
    assert.deepEqual(await canonical(reopen(f.vault.root)), settled, 'recovery and completed-plan retries are canonical no-ops');
  });
}

test('S06: cancellation while a real writer lock is held removes only the waiting Wiki invocation', { timeout: 20_000 }, async () => {
  const f = await pendingFixture();
  let release!: () => void;
  let reached!: () => void;
  const entered = new Promise<void>((resolve) => { reached = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const holder = withFileLock(join(f.vault.root, '.amem', 'write.lock'), async () => { reached(); await held; });
  await entered;
  const controller = new AbortController();
  const cancelled = assert.rejects(withOperation(controller.signal, () => reopen(f.vault.root).wikiApply(f.plan)), (error) => error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED');
  try {
    await until(async () => (await readdir(join(f.vault.root, '.amem', 'write.lock.queue'))).length === 2, 'Wiki apply to enter the writer queue');
    controller.abort();
    await cancelled;
    assert.deepEqual(await canonical(f.vault), f.before);
    assert.equal((await readdir(join(f.vault.root, '.amem', 'write.lock.queue'))).length, 1, 'the other invocation keeps its own lock ticket');
    assert.equal(existsSync(join(f.vault.root, '.amem', 'write.lock')), true);
  } finally { release(); await holder; }
  assert.ok((await reopen(f.vault.root).wikiApply(f.plan)).commit);
  await assertComplete(f);
});

for (const boundary of ['ready', 'commit'] as const) {
  test(`S07: Wiki cancellation at ${boundary} settles durable work and returns its actual commit receipt`, async () => {
    const f = await pendingFixture();
    const controller = new AbortController();
    const commit = f.vault.git.commit.bind(f.vault.git);
    f.vault.git.commit = async (...args) => {
      assert.equal(operationSignal(), undefined, 'the ready section is shielded from invocation cancellation');
      if (boundary === 'ready') controller.abort();
      const result = await commit(...args);
      if (boundary === 'commit') controller.abort();
      return result;
    };
    let cancelled: AgentMemoryError | undefined;
    await assert.rejects(withOperation(controller.signal, () => f.vault.wikiApply(f.plan)), (error) => {
      if (!(error instanceof AgentMemoryError) || error.code !== 'OPERATION_CANCELLED') return false;
      cancelled = error;
      return true;
    });
    const head = await f.vault.git.run(['rev-parse', 'HEAD']);
    assert.deepEqual(cancelled?.safeDetails?.committed, [{ operation: 'wiki-apply', commit: head }]);
    await assertComplete(f);
  });
}

test('S08: a blocked ready recovery prevents a later Wiki writer until the real Git lock is removed', async () => {
  const f = await pendingFixture();
  await crash(f.vault.root, f.plan, 'ready');
  const pending = await journals(f.vault.root);
  const lock = join(f.vault.git.gitDir, 'index.lock');
  await writeFile(lock, 'held by the recovery acceptance fixture\n');
  await assert.rejects(reopen(f.vault.root).wikiApply(f.plan), (error) => error instanceof AgentMemoryError && error.code === 'GIT_OPERATION_FAILED');
  assert.equal(await f.vault.git.run(['rev-parse', 'HEAD']), f.before.head);
  assert.deepEqual(await journals(f.vault.root), pending);
  assert.deepEqual(await fileBytes(join(f.vault.root, 'evidence')), f.evidence);
  await rm(lock);
  await reopen(f.vault.root).recover();
  await assertComplete(f);
});

test('S08 S09: failed or forged derived index cannot undo a compiled Wiki or become canonical knowledge', async () => {
  const f = await pendingFixture();
  let refreshes = 0;
  f.vault.reindex = async () => { refreshes += 1; throw new Error('injected derived-index refresh failure'); };
  assert.ok((await f.vault.wikiApply(f.plan)).commit);
  assert.equal(refreshes, 1);
  const before = await canonical(f.vault);
  await writeFile(join(f.vault.root, '.amem', 'search-index.json'), JSON.stringify({ version: 5, documents: [{ id: 'forged', body: 'FORGED_INDEX_CANARY', title: 'FORGED_INDEX_CANARY', path: wikiPagePath('entity:atlas') }] }));
  const fresh = reopen(f.vault.root);
  assert.deepEqual(await fresh.search('FORGED_INDEX_CANARY'), []);
  await assertComplete(f);
  assert.deepEqual(await canonical(fresh), before);
});

test('S09: coordinated process writers reject a stale plan and preserve unrelated staged and unstaged bytes', { timeout: 30_000 }, async () => {
  const f = await pendingFixture();
  f.llm.marker = 'LOSING_PLAN_ONLY';
  const loser = (await f.vault.wikiIngest({ evidenceIds: [f.second.evidenceId] })).plan!;
  const originalInstructions = await f.vault.git.run(['show', 'HEAD:AGENTS.md']);
  await writeFile(join(f.vault.root, 'AGENTS.md'), 'UNRELATED_STAGED_BYTES\n');
  await f.vault.git.run(['add', '--', 'AGENTS.md']);
  await writeFile(join(f.vault.root, 'AGENTS.md'), 'UNRELATED_UNSTAGED_BYTES\n');
  const staged = await f.vault.git.run(['diff', '--cached', '--binary']);
  const winner = worker(f.vault.root, f.plan, { pauseFirst: true });
  const contender = worker(f.vault.root, loser, { waitStart: true });
  try {
    await until(() => winner.messages.some((message) => message.paused) && contender.messages.some((message) => message.started), 'independent writer barriers');
    contender.child.send('start');
    await until(async () => (await readdir(join(f.vault.root, '.amem', 'write.lock.queue'))).length === 2, 'the second process to queue behind the first');
    winner.child.send('resume');
    assert.deepEqual(await winner.completed, { code: 0, signal: null }, winner.diagnostic());
    assert.deepEqual(await contender.completed, { code: 0, signal: null }, contender.diagnostic());
    assert.ok(winner.messages.some((message) => message.result?.commit));
    assert.ok(contender.messages.some((message) => message.error?.code === 'VALIDATION_FAILED' && /changed/.test(message.error.message)));
  } finally {
    if (winner.child.exitCode === null && winner.child.signalCode === null) winner.child.kill('SIGKILL');
    if (contender.child.exitCode === null && contender.child.signalCode === null) contender.child.kill('SIGKILL');
    await Promise.all([winner.completed, contender.completed]);
  }
  const fresh = reopen(f.vault.root);
  assert.equal(await fresh.git.run(['rev-list', '--count', `${f.before.head}..HEAD`]), '1');
  assert.equal(await fresh.git.run(['show', 'HEAD:AGENTS.md']), originalInstructions);
  assert.equal(await fresh.git.run(['diff', '--cached', '--binary']), staged);
  assert.equal(await fresh.git.run(['show', ':AGENTS.md']), 'UNRELATED_STAGED_BYTES');
  assert.equal(await readFile(join(f.vault.root, 'AGENTS.md'), 'utf8'), 'UNRELATED_UNSTAGED_BYTES\n');
  assert.doesNotMatch((await fresh.get((await fresh.wikiCatalog()).find((page) => page.key === 'entity:atlas')!.id)).body, /LOSING_PLAN_ONLY/);
  assert.deepEqual(await fileBytes(join(f.vault.root, 'evidence')), f.evidence);
  const settled = await canonical(fresh);
  assert.deepEqual(await fresh.wikiApply(f.plan), { pageIds: [], commit: null });
  assert.deepEqual(await canonical(reopen(f.vault.root)), settled);
  await assertUnlocked(f.vault.root);
});

test('S09: invalid signed compilation bookkeeping triggers fresh planning without promoting forged completion', async () => {
  const f = await pendingFixture();
  await f.vault.wikiApply(f.plan);
  const path = join(f.vault.root, `wiki/.meta/${f.plan.receiptId}.md`);
  const receipt = parseMarkdown<WikiReceiptMeta>(await readFile(path, 'utf8'));
  await writeFile(path, serializeMarkdown({ ...receipt.meta, proof: '0'.repeat(64) }, receipt.body));
  const before = await canonical(f.vault);
  const llm = new RecoveryCompiler();
  const fresh = reopen(f.vault.root, llm);
  const retry = await fresh.wikiIngest({ evidenceIds: [f.second.evidenceId] });
  assert.equal(retry.duplicate, false);
  assert.ok(retry.plan);
  assert.ok(llm.calls > 0, 'invalid bookkeeping cannot bypass compilation');
  assert.deepEqual(await canonical(fresh), before, 'planning does not repair bookkeeping implicitly');
  assert.deepEqual(await fileBytes(join(f.vault.root, 'evidence')), f.evidence);
});

async function remoteFixture() {
  const base = await fixture();
  const remote = await temporary('remote.git');
  await exec('git', ['init', '--bare', '--initial-branch=main', remote]);
  await base.vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  await base.vault.sync({ push: true });
  return { ...base, remote };
}

test('S10: real bare-remote sync imports a multi-page Wiki and changed rules with immutable provenance and queryable navigation', { timeout: 30_000 }, async () => {
  const { vault, remote, first } = await remoteFixture();
  const receiverRoot = await temporary('receiver');
  await cp(vault.root, receiverRoot, { recursive: true });
  const receiver = reopen(receiverRoot);
  await receiver.git.run(['config', 'core.worktree', receiverRoot]);
  const originalEvidence = await fileBytes(join(vault.root, 'evidence'));
  await vault.wikiSetRules({ purpose: 'Compare recovery limits across sources.', instructions: 'Preserve source dates and explicitly retain unsupported in-place restoration.', scope: 'public', sensitivity: 'public', expectedRevision: 1 });
  const second = await vault.capture({ content: secondFact, scope: 'public', sensitivity: 'public', extract: false });
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  await vault.sync({ push: true });
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), await vault.git.run(['rev-parse', 'HEAD']));
  assert.equal((await receiver.sync({ push: false })).merged, true);
  const fresh = reopen(receiverRoot);
  assert.deepEqual(await fileBytes(receiverRoot), await fileBytes(vault.root));
  assert.equal((await fresh.wikiRules())[0]!.meta.revision, 2);
  assert.equal((await fresh.wikiCatalog()).length, 4);
  const answer = await fresh.wikiQuery('How do snapshots and restoration complement each other?');
  assert.equal(answer.citations[0]!.revision, 2);
  assert.deepEqual(new Set(answer.citations[0]!.evidence), new Set([first.evidencePath, second.evidencePath]));
  assert.match(answer.answer, /in-place restoration is unsupported/);
  assert.ok((await fresh.search('AtlasStore')).some((hit) => hit.kind === 'synthesis'));
  for (const [path, bytes] of Object.entries(originalEvidence)) assert.equal((await fileBytes(join(receiverRoot, 'evidence')))[path], bytes);
  assert.equal((await fresh.doctor()).healthy, true);
  await assertUnlocked(receiverRoot);
});

for (const invalid of ['malformed Wiki schema', 'plaintext secret Wiki page', 'rewritten source evidence', 'managed Wiki symlink'] as const) {
  test(`S10: pulling ${invalid} restores the prior Wiki, evidence, log, catalog, Git and sync state`, { timeout: 30_000, skip: invalid === 'managed Wiki symlink' && process.platform === 'win32' }, async () => {
    const { vault, remote, first } = await remoteFixture();
    const clone = join(await temporary('clone'), 'checkout');
    await exec('git', ['clone', '--branch', 'main', remote, clone]);
    await exec('git', ['config', 'user.name', 'Wiki remote fixture'], { cwd: clone });
    await exec('git', ['config', 'user.email', 'wiki-remote@example.invalid'], { cwd: clone });
    const entity = (await vault.wikiCatalog()).find((page) => page.key === 'entity:atlas')!;
    const path = join(clone, entity.path);
    const document = parseMarkdown<WikiPageMeta>(await readFile(path, 'utf8'));
    const outside = join(await temporary('symlink-target'), 'untouched.md');
    await writeFile(outside, 'OUTSIDE_TARGET_REMAINS_UNCHANGED\n');
    if (invalid === 'malformed Wiki schema') await writeFile(path, serializeMarkdown({ ...document.meta, revision: 0 }, document.body));
    else if (invalid === 'plaintext secret Wiki page') await writeFile(path, serializeMarkdown({ ...document.meta, sensitivity: 'secret' }, `${document.body}\nPLAINTEXT_WIKI_SECRET_CANARY`));
    else if (invalid === 'rewritten source evidence') {
      const evidencePath = join(clone, first.evidencePath);
      await writeFile(evidencePath, `${await readFile(evidencePath, 'utf8')}\nREWRITTEN_EVIDENCE_CANARY\n`);
    } else { await rm(path); await symlink(outside, path); }
    await exec('git', ['add', '--', entity.path, first.evidencePath], { cwd: clone });
    await exec('git', ['commit', '-m', `invalid fixture: ${invalid}`], { cwd: clone });
    await exec('git', ['push', 'origin', 'main'], { cwd: clone });
    const before = await canonical(vault);
    const syncBefore = await readFile(join(vault.root, '.amem', 'sync-state.json'), 'utf8');
    const evidenceBefore = await fileBytes(join(vault.root, 'evidence'));
    await assert.rejects(vault.sync({ push: false }), (error) => error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
    const fresh = reopen(vault.root);
    assert.deepEqual(await canonical(fresh), before);
    assert.equal(await readFile(join(vault.root, '.amem', 'sync-state.json'), 'utf8'), syncBefore);
    assert.deepEqual(await fileBytes(join(vault.root, 'evidence')), evidenceBefore);
    assert.equal(await readFile(outside, 'utf8'), 'OUTSIDE_TARGET_REMAINS_UNCHANGED\n');
    assert.equal(existsSync(join(vault.root, '.amem', 'sync-intent.json')), false);
    await assertUnlocked(vault.root);
    assert.equal((await fresh.doctor()).healthy, true);
    assert.deepEqual(await fresh.search('PLAINTEXT_WIKI_SECRET_CANARY'), []);
    assert.deepEqual(await fresh.recover(), { rolledBack: [], replayed: [], commits: [] });
    assert.deepEqual(await canonical(fresh), before);
    assert.ok((await fresh.capture({ content: 'Authorized next session still works.', extract: false })).commit);
  });
}
