import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { LlmClient } from '../src/llm.js';
import { MemoryVault } from '../src/vault.js';
import { AgentMemoryError } from '../src/errors.js';
import { withOperation } from '../src/operation.js';
import { VaultTransaction } from '../src/transaction.js';
import type { WikiPageDraft, WikiPageMeta } from '../src/wiki-types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class CompilerFixture extends LlmClient {
  readonly calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  respond?: (operation: string, input: Record<string, unknown>) => unknown;
  constructor() { super({ apiKey: 'fixture', model: 'test-wiki', embeddingModel: '' }); }
  override async wiki<T = unknown>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    const dto = input as Record<string, unknown>;
    this.calls.push({ operation, input: dto });
    if (this.respond) return this.respond(operation, dto) as T;
    const pages = (dto.pages ?? []) as Array<WikiPageMeta & { body: string }>;
    if (operation === 'navigate') return { keys: (dto.catalog as Array<{ key: string }>).map((entry) => entry.key) } as T;
    if (operation === 'query') return { answer: 'AtlasStore combines daily snapshots with separate-instance restoration.', citations: pages.filter((page) => page.pageType === 'entity').map((page) => page.key), uncertainty: ['Restoration performance is not yet measured.'] } as T;
    if (operation === 'lint') return { suggestions: [] } as T;
    const sources = dto.sources as Array<{ id: string; body: string }>;
    const ids = sources.map((source) => source.id);
    const draft = (key: string, pageType: WikiPageDraft['pageType'], title: string, body: string, links: string[]): WikiPageDraft => ({
      key, pageType, title, summary: title, body: `# ${title}\n\n${body}`, evidenceIds: ids, links, status: 'active', conditions: ['For project deployments.'], uncertainty: [],
    });
    const previous = pages.find((page) => page.key === 'entity:atlas');
    return { pages: [
      ...sources.map((source) => draft(`source:${source.id}`, 'source', 'Source summary', source.body, ['entity:atlas'])),
      draft('entity:atlas', 'entity', 'AtlasStore', `${previous?.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0] ?? ''}\n${sources.map((source) => source.body).join('\n')}`, sources.map((source) => `source:${source.id}`)),
      draft('synthesis:backup', 'synthesis', 'Backup and restoration', 'Snapshots and restoration form a recoverable backup workflow.', ['entity:atlas']),
      draft('concept:snapshot', 'concept', 'Snapshot concept', 'A snapshot is a recoverable point-in-time view.', ['entity:atlas']),
      draft('comparison:backup', 'comparison', 'Backup comparison', 'Daily snapshots differ from separate-instance restoration.', ['entity:atlas']),
    ] } as T;
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-wiki-'));
  roots.push(root);
  const llm = new CompilerFixture();
  const vault = new MemoryVault(root, { llm, masterKey: '76'.repeat(32) });
  await vault.initialize('wiki-test');
  return { vault, llm };
}

async function snapshot(vault: MemoryVault): Promise<string> {
  return vault.git.run(['status', '--porcelain=v1']).then(async (dirty) => `${await vault.git.run(['rev-parse', 'HEAD'])}\n${dirty}\n${await readFile(join(vault.root, 'log.md'), 'utf8')}`);
}

test('W01 W02 W04 I01 I04 I07: additive rules, six page purposes, incremental compilation and durable no-op retry', async () => {
  const { vault, llm } = await fixture();
  const first = await vault.capture({ content: 'AtlasStore supports daily snapshots.', scope: 'public', sensitivity: 'public' });
  const evidenceBefore = await readFile(join(vault.root, first.evidencePath), 'utf8');
  assert.equal((await vault.wikiMigrate()).created, true);
  assert.deepEqual(await vault.wikiMigrate(), { created: false, commit: null });
  const beforePlan = await snapshot(vault);
  const proposed = await vault.wikiIngest({ evidenceIds: [first.evidenceId] });
  assert.equal(await snapshot(vault), beforePlan, 'planning cannot write canonical knowledge');
  assert.ok(proposed.plan);
  const applied = await vault.wikiApply(proposed.plan);
  assert.equal(applied.pageIds.length, 5);
  assert.ok(applied.commit);
  const restart = new MemoryVault(vault.root, { llm });
  const beforeRetry = await snapshot(vault);
  const requestCount = llm.calls.length;
  assert.deepEqual(await restart.wikiIngest({ evidenceIds: [first.evidenceId], apply: true }), { duplicate: true, plan: null, commit: null });
  assert.equal(llm.calls.length, requestCount);
  assert.equal(await snapshot(vault), beforeRetry);
  const second = await vault.capture({ content: 'AtlasStore restores to a separate instance.', scope: 'public', sensitivity: 'public' });
  const addition = await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  assert.ok(addition.commit);
  const catalog = await vault.wikiCatalog();
  const entity = catalog.find((page) => page.key === 'entity:atlas')!;
  const entityPage = await vault.get(entity.id);
  assert.match(entityPage.body, /daily snapshots/);
  assert.match(entityPage.body, /separate instance/);
  assert.deepEqual(new Set(entityPage.meta.evidence as string[]), new Set([first.evidencePath, second.evidencePath]));
  assert.equal(entity.revision, 2);
  assert.equal(await readFile(join(vault.root, first.evidencePath), 'utf8'), evidenceBefore);
  const answer = await vault.wikiQuery('How does AtlasStore backup work?');
  assert.equal(answer.citations[0]?.revision, 2);
  const saved = await vault.wikiFile(answer, { title: 'Backup answer', apply: true });
  assert.ok(saved.commit);
  assert.deepEqual(new Set((await vault.wikiCatalog()).map((page) => page.pageType)), new Set(['source', 'entity', 'concept', 'synthesis', 'comparison', 'query']));
  assert.equal((await readdir(join(vault.root, 'evidence'), { recursive: true })).filter((path) => path.endsWith('.md')).length, 2, 'analysis is not new evidence');
  assert.ok((await vault.search('AtlasStore')).some((hit) => hit.kind === 'entity'));
  assert.match(await readFile(join(vault.root, 'WIKI.md'), 'utf8'), /AtlasStore/);
  assert.equal((await vault.doctor()).healthy, true);
  for (const call of llm.calls) assert.ok(call.input.rules, `${call.operation} consumed operational rules`);
});

test('I05 I06 Q02 Q04: stale plans and forged citations are rejected without canonical writes', async () => {
  const { vault } = await fixture();
  const evidence = await vault.capture({ content: 'AtlasStore daily snapshots.', scope: 'public', sensitivity: 'public' });
  const plan = (await vault.wikiIngest({ evidenceIds: [evidence.evidenceId] })).plan!;
  await vault.wikiSetRules({ purpose: 'New Wiki purpose', instructions: 'Preserve provenance.', scope: 'public', sensitivity: 'public' });
  const current = await snapshot(vault);
  await assert.rejects(vault.wikiApply(plan), /changed/);
  assert.equal(await snapshot(vault), current);
  const next = (await vault.wikiIngest({ evidenceIds: [evidence.evidenceId] })).plan!;
  const invalid = structuredClone(next);
  invalid.pages.push(invalid.pages[0]!);
  await assert.rejects(vault.wikiApply(invalid), (error) => error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED');
  assert.equal(await snapshot(vault), current);
  await vault.wikiApply(next);
  const beforeQuery = await snapshot(vault);
  const result = await vault.wikiQuery('What is AtlasStore?');
  assert.equal(await snapshot(vault), beforeQuery);
  result.citations[0]!.revision += 1;
  await assert.rejects(vault.wikiFile(result, { title: 'Forged', apply: true }), (error) => error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED');
  assert.equal(await snapshot(vault), beforeQuery);
});

test('Q04 Q05 I09: signed query uncertainty and plans resist tampering; successful filing retries are idempotent', async () => {
  const { vault, llm } = await fixture();
  const evidence = await vault.capture({ content: 'AtlasStore supports snapshots.' });
  await vault.wikiIngest({ evidenceIds: [evidence.evidenceId], apply: true });
  const answer = await vault.wikiQuery('What is verified about AtlasStore?');
  const before = await snapshot(vault);
  const stripped = structuredClone(answer);
  stripped.uncertainty = [];
  await assert.rejects(vault.wikiFile(stripped, { title: 'Stripped answer', apply: true }), (error) => error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED');
  assert.equal(await snapshot(vault), before);
  const filed = await vault.wikiFile(answer, { title: 'Retained uncertainty', apply: true });
  assert.ok(filed.commit);
  const after = await snapshot(vault);
  const calls = llm.calls.length;
  const replay = await new MemoryVault(vault.root, { llm }).wikiFile(answer, { title: 'Retained uncertainty', apply: true });
  assert.equal(replay.commit, null);
  assert.equal(await snapshot(vault), after);
  assert.equal(llm.calls.length, calls);
  assert.deepEqual(await vault.wikiApply(filed.plan), { pageIds: [], commit: null });
  const forgedPlan = structuredClone(filed.plan);
  forgedPlan.pages[0]!.uncertainty = [];
  await assert.rejects(vault.wikiApply(forgedPlan), (error) => error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED');
  assert.equal(await snapshot(vault), after);
});

test('L01 L02 L04: structural lint is model-free, semantic suggestions are read-only and repairs require separate apply', async () => {
  const { vault, llm } = await fixture();
  const evidence = await vault.capture({ content: 'AtlasStore backup support.' });
  await vault.wikiIngest({ evidenceIds: [evidence.evidenceId], apply: true });
  const before = await snapshot(vault);
  const local = new MemoryVault(vault.root, { llm: new LlmClient({ apiKey: '' }) });
  assert.equal((await local.wikiLint({ semantic: true })).semantic, 'unavailable');
  const semantic = await vault.wikiLint({ semantic: true });
  assert.equal(semantic.semantic, 'available');
  assert.deepEqual(semantic.plans, []);
  assert.equal(await snapshot(vault), before);
  llm.respond = (operation) => operation === 'lint' ? { suggestions: [
    { kind: 'contradiction', message: 'Review contradictory backup claims.', pageKeys: ['entity:atlas'], evidenceIds: [evidence.evidenceId], repairs: [{
      key: 'entity:atlas', pageType: 'entity', title: 'AtlasStore', summary: 'Backup claims need review', body: '# AtlasStore\n\nBoth competing claims remain visible.', evidenceIds: [evidence.evidenceId], links: [], status: 'conflicted', conditions: [], uncertainty: ['Needs verification.'],
    }] },
  ] } : {};
  const report = await vault.wikiLint({ semantic: true });
  assert.equal(report.plans.length, 1);
  assert.equal(await snapshot(vault), before);
  const applied = await vault.wikiApply(report.plans[0]);
  assert.ok(applied.commit);
  assert.equal((await vault.wikiCatalog()).find((page) => page.key === 'entity:atlas')?.status, 'conflicted');
});

test('S01 S02 S04 S05: encrypted evidence and transitive withdrawal stay out of unauthorized provider, catalog and search', async () => {
  const { vault, llm } = await fixture();
  const secret = await vault.capture({ content: 'AtlasStore SECRET_CANARY supports private backup.', scope: 'user', sensitivity: 'secret' });
  await vault.wikiIngest({ evidenceIds: [secret.evidenceId], apply: true });
  const raw = await readFile(join(vault.root, (await vault.wikiCatalog())[0]!.path), 'utf8');
  assert.match(raw, /encrypted: aes-256-gcm/);
  assert.doesNotMatch(raw, /AtlasStore|SECRET_CANARY/);
  const config = await vault.config();
  const publicReader = new MemoryVault(vault.root, { llm, principal: { id: 'public', name: 'Public', permissions: ['read'], scopes: ['public'], maxSensitivity: 'public', tenantId: config.tenantId } });
  const count = llm.calls.length;
  assert.deepEqual(await publicReader.wikiCatalog(), []);
  assert.equal((await publicReader.wikiQuery('backup')).citations.length, 0);
  assert.deepEqual(await publicReader.search('SECRET_CANARY'), []);
  assert.equal(llm.calls.length, count);
  await assert.rejects(publicReader.wikiIngest({ evidenceIds: [secret.evidenceId] }), (error) => error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED');
  const source = (await vault.wikiCatalog()).find((page) => page.pageType === 'source')!;
  await vault.wikiRevoke(source.key, 'Source support withdrawn');
  assert.deepEqual(await vault.wikiCatalog(), []);
  assert.deepEqual(await vault.search('backup', { includeSecret: true }), []);
});

test('S06 S08: a pre-ready multi-page write cancellation rolls back every file and restart leaves no partial Wiki', async () => {
  const { vault } = await fixture();
  const evidence = await vault.capture({ content: 'AtlasStore snapshots.' });
  const evidenceBytes = await readFile(join(vault.root, evidence.evidencePath), 'utf8');
  const plan = (await vault.wikiIngest({ evidenceIds: [evidence.evidenceId] })).plan!;
  const before = await snapshot(vault);
  const controller = new AbortController();
  const original = VaultTransaction.prototype.write;
  let writes = 0;
  VaultTransaction.prototype.write = async function(path, content) {
    await original.call(this, path, content);
    if (path.startsWith('wiki/pages/') && ++writes === 1) controller.abort();
  };
  try {
    await assert.rejects(withOperation(controller.signal, () => vault.wikiApply(plan)), (error) => error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED');
  } finally { VaultTransaction.prototype.write = original; }
  assert.equal(await snapshot(vault), before);
  const restart = new MemoryVault(vault.root);
  assert.deepEqual(await restart.wikiCatalog(), []);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'transactions')), []);
  assert.equal((await restart.recover()).replayed.length, 0);
  assert.equal(await readFile(join(vault.root, evidence.evidencePath), 'utf8'), evidenceBytes);
});
