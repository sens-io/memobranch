import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { LlmClient } from '../src/llm.js';
import { MemoryVault } from '../src/vault.js';
import { AgentMemoryError } from '../src/errors.js';
import { legacyEvidenceDigest } from '../src/evidence.js';
import { serializeMarkdown } from '../src/markdown.js';
import type { Principal } from '../src/policy.js';
import type { WikiPageDraft, WikiPageMeta } from '../src/wiki-types.js';

const roots: string[] = [];
const masterKey = 'c5'.repeat(32);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
class GovernanceClient extends LlmClient {
  calls: Array<{ operation: string; input: object }> = [];
  conflict = false;
  categories: Array<'contradiction' | 'stale' | 'missing-concept' | 'gap'> = [];
  constructor() { super({ apiKey: 'fixture', model: 'governance-fixture', embeddingModel: '' }); }
  override async wiki<T = unknown>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    this.calls.push({ operation, input });
    const dto = input as { catalog: Array<{ key: string }>; sources: Array<{ id: string; body: string }>; pages: Array<WikiPageMeta & { body: string }>; evidence: Array<{ id: string }> };
    if (operation === 'navigate') return { keys: dto.catalog.map((page) => page.key) } as T;
    if (operation === 'query') return { answer: this.conflict ? 'Both 24-hour and 48-hour claims need verification.' : 'Atlas snapshots are supported.', citations: dto.pages.map((page) => page.key), uncertainty: this.conflict ? ['Cadence needs human verification.'] : [] } as T;
    if (operation === 'lint') return { suggestions: this.categories.map((kind) => ({ kind, message: `Review ${kind} with evidence.`, pageKeys: dto.pages.filter((page) => page.key === 'entity:atlas').map((page) => page.key), evidenceIds: dto.evidence.map((source) => source.id) })) } as T;
    const previous = dto.pages?.find((page) => page.key === 'entity:atlas')?.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0] ?? '';
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string, links: string[]): WikiPageDraft => ({ key, pageType, title: 'Atlas snapshots', summary: 'Snapshot cadence and conditions', body,
      evidenceIds: dto.sources.map((source) => source.id), links, status: this.conflict ? 'conflicted' : 'active', conditions: ['Project deployments only'], uncertainty: this.conflict ? ['Cadence needs human verification.'] : [] });
    return { pages: [
      ...dto.sources.map((source) => draft(`source:${source.id}`, 'source', source.body, ['entity:atlas'])),
      draft('entity:atlas', 'entity', `${previous}\n${dto.sources.map((source) => source.body).join('\n')}`, [...dto.sources.map((source) => `source:${source.id}`), ...dto.pages.filter((page) => page.key.startsWith('legacy:')).map((page) => page.key)]),
    ] } as T;
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wiki-governance-')); roots.push(root);
  const llm = new GovernanceClient(); const vault = new MemoryVault(root, { llm, masterKey });
  await vault.initialize('wiki-governance'); return { vault, llm };
}
async function checkpoint(vault: MemoryVault): Promise<string> { return `${await vault.git.run(['rev-parse', 'HEAD'])}\n${await vault.git.run(['status', '--porcelain=v1'])}\n${await readFile(join(vault.root, 'log.md'), 'utf8')}`; }
const denied = (error: unknown): boolean => error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED';

for (const version of [1, 2]) test(`W02 W06: version ${version} atomic migration preserves artifacts and feeds public Wiki navigation`, async () => {
  const { vault, llm } = await fixture();
  const evidence = await vault.capture({ content: 'Atlas snapshots every 24 hours.', scope: 'public', sensitivity: 'public' });
  const candidate = await vault.propose({ key: 'Atlas cadence', statement: 'Atlas snapshots every 24 hours.', kind: 'fact', scope: 'public', sensitivity: 'public', confidence: 1, explicit: true, conditions: ['Project deployments only'], tags: [] }, [evidence.evidencePath]);
  const memory = await vault.approve(candidate.id);
  const originalMemory = await readFile(join(vault.root, memory.memoryPath), 'utf8');
  const originalEvidence = await readFile(join(vault.root, evidence.evidencePath), 'utf8');
  const settings = { ...(await vault.config()), residentBudget: 12, minimumConfidence: 0.81, minimumProcedureEvidence: 3, version };
  await writeFile(join(vault.root, 'agent-memory.json'), `${JSON.stringify(settings, null, 2)}\n`);
  await vault.git.commit('fixture: legacy configuration', { id: 'fixture', name: 'Fixture' }, ['agent-memory.json']);
  const beforeRead = await checkpoint(vault);
  assert.ok((await vault.wikiCatalog()).some((page) => page.key === `legacy:${memory.memoryId}`));
  assert.equal(await checkpoint(vault), beforeRead);
  assert.equal((await vault.migrate()).migrated, version === 1);
  if (version === 1) assert.deepEqual(JSON.parse(await readFile(join(vault.root, 'agent-memory.json.v1.bak'), 'utf8')), settings);
  const config = await vault.config();
  assert.equal(config.residentBudget, 12); assert.equal(config.minimumConfidence, 0.81); assert.equal(config.minimumProcedureEvidence, 3);
  assert.equal((await vault.wikiMigrate()).created, true);
  assert.deepEqual(await vault.wikiMigrate(), { created: false, commit: null });
  await vault.wikiIngest({ evidenceIds: [evidence.evidenceId], apply: true });
  assert.equal(await readFile(join(vault.root, memory.memoryPath), 'utf8'), originalMemory);
  assert.equal(await readFile(join(vault.root, evidence.evidencePath), 'utf8'), originalEvidence);
  assert.ok(llm.calls.some((call) => call.operation === 'compile' && JSON.stringify(call.input).includes(`legacy:${memory.memoryId}`)));
  const restarted = new MemoryVault(vault.root, { llm });
  for (const page of (await restarted.wikiCatalog()).filter((entry) => !entry.legacy)) assert.ok((await readFile(join(vault.root, 'WIKI.md'), 'utf8')).includes(`./${page.path}`), 'public Wiki with legacy support remains navigable');
  assert.ok((await restarted.wikiQuery('Atlas cadence?')).citations.some((citation) => citation.key.startsWith('legacy:')));
  assert.equal((await restarted.wikiLint({ semantic: true })).semantic, 'available');
  const beforeRevoke = await checkpoint(vault);
  await assert.rejects(vault.wikiRevoke(`legacy:${memory.memoryId}`, 'Use legacy API'), /existing memory revocation API/);
  assert.equal(await checkpoint(vault), beforeRevoke);
  await vault.forget(memory.memoryId, 'Legacy support withdrawn');
  assert.deepEqual(await vault.wikiCatalog(), []);
  assert.doesNotMatch(await readFile(join(vault.root, 'WIKI.md'), 'utf8'), /\]\(\.\/wiki\/pages\//);
});

test('W02: explicitly migrated legacy evidence retains its identity and becomes a Wiki source', async () => {
  const { vault } = await fixture(); const text = 'Legacy Atlas evidence.';
  const digest = legacyEvidenceDigest('public', '', text); const id = `ev-${digest.slice(0, 12)}`; const path = `evidence/2026/01/01/${id}.md`;
  await mkdir(join(vault.root, 'evidence/2026/01/01'), { recursive: true });
  const body = `# Evidence ${id}\n\n${text}`;
  await writeFile(join(vault.root, path), serializeMarkdown({ id, type: 'evidence', createdAt: new Date().toISOString(), actor: 'legacy', scope: 'public', sensitivity: 'public', sha256: digest, immutable: true }, body));
  await vault.git.commit('fixture: legacy evidence', { id: 'fixture', name: 'Fixture' }, ['evidence']);
  await assert.rejects(vault.wikiIngest({ evidenceIds: [id] }), /migration/i);
  assert.equal((await vault.migrate()).evidenceDigests, 1);
  const migratedBytes = await readFile(join(vault.root, path), 'utf8');
  await vault.wikiMigrate(); await vault.wikiIngest({ evidenceIds: [id], apply: true });
  assert.equal(await readFile(join(vault.root, path), 'utf8'), migratedBytes); assert.equal((await vault.get(id)).body, body);
  assert.ok((await vault.wikiCatalog()).some((page) => page.key === `source:${id}`));
});

test('I03 L02 Q04 W07: contradictory sources stay reviewable and four lint categories retain actual versions', async () => {
  const { vault, llm } = await fixture();
  const first = await vault.capture({ content: 'Atlas snapshots every 24 hours.', scope: 'public', sensitivity: 'public' });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const second = await vault.capture({ content: 'Atlas snapshots every 48 hours; needs review.', scope: 'public', sensitivity: 'public' });
  llm.conflict = true; const before = await checkpoint(vault);
  const plan = (await vault.wikiIngest({ evidenceIds: [second.evidenceId] })).plan!;
  assert.equal(await checkpoint(vault), before);
  assert.equal((await vault.wikiCatalog()).find((page) => page.key === 'entity:atlas')?.status, 'active');
  assert.equal(plan.pages.find((page) => page.key === 'entity:atlas')?.status, 'conflicted');
  const logBefore = await readFile(join(vault.root, 'log.md'), 'utf8'); const applied = await vault.wikiApply(plan);
  const logAfter = await readFile(join(vault.root, 'log.md'), 'utf8'); assert.ok(logAfter.startsWith(logBefore));
  const last = [...logAfter.matchAll(/<!-- wiki-event (.+?) -->/g)].map((match) => JSON.parse(match[1]!)).at(-1)!;
  assert.equal(last.operation, 'wiki-compile'); assert.equal(last.parentCommit, (await vault.git.run(['rev-parse', `${applied.commit}^`])).trim());
  assert.deepEqual(new Set(last.pageIds), new Set(applied.pageIds));
  const page = (await vault.wikiCatalog()).find((item) => item.key === 'entity:atlas')!; const persisted = await vault.get(page.id);
  assert.match(persisted.body, /24 hours/); assert.match(persisted.body, /48 hours/);
  assert.deepEqual(new Set(persisted.meta.evidence as string[]), new Set([first.evidencePath, second.evidencePath])); assert.equal(page.status, 'conflicted');
  assert.ok(!(await vault.search('Atlas')).some((hit) => hit.id === page.id));
  const answer = await vault.wikiQuery('Which cadence is verified?'); assert.ok(answer.uncertainty.includes('Cadence needs human verification.'));
  const unchanged = await checkpoint(vault); llm.categories = ['contradiction', 'stale', 'missing-concept', 'gap'];
  const report = await vault.wikiLint({ semantic: true }); assert.equal(report.semantic, 'available'); assert.deepEqual(report.plans, []);
  for (const kind of llm.categories) {
    const issue = report.issues.find((item) => item.kind === kind && item.message.startsWith('Review'))!;
    assert.deepEqual(issue.pageVersions, { [page.key]: page.revision }); assert.deepEqual(new Set(issue.evidenceIds), new Set([first.evidenceId, second.evidenceId]));
  }
  assert.equal(await checkpoint(vault), unchanged);
  const filed = await vault.wikiFile(answer, { title: 'Cadence dispute', apply: true });
  assert.equal((await vault.wikiCatalog()).find((item) => item.key === filed.plan.query!.key)?.status, 'conflicted');
});

test('W04 I08: operational rule changes reach each workflow and invalidate prior completed ingest', async () => {
  const { vault, llm } = await fixture(); const source = await vault.capture({ content: 'Atlas cadence.', scope: 'public', sensitivity: 'public' });
  const first = await vault.wikiSetRules({ scope: 'public', sensitivity: 'public', purpose: 'Rules v1', instructions: 'Retain scoped claims.' });
  await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
  const second = await vault.wikiSetRules({ scope: 'public', sensitivity: 'public', purpose: 'Rules v2', instructions: 'Mark unverified throughput.', expectedRevision: first.revision });
  const count = llm.calls.length; assert.equal((await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true })).duplicate, false);
  const answer = await vault.wikiQuery('Atlas?'); const lint = await vault.wikiLint({ semantic: true });
  assert.deepEqual(answer.ruleVersions, { [second.id]: 2 }); assert.deepEqual(lint.ruleVersions, answer.ruleVersions);
  for (const operation of ['compile', 'query', 'lint']) assert.ok(llm.calls.slice(count).some((call) => call.operation === operation && JSON.stringify(call.input).includes('Rules v2') && JSON.stringify(call.input).includes('Mark unverified throughput.')));
  assert.equal((await vault.wikiIngest({ evidenceIds: [source.evidenceId] })).duplicate, true);
});

test('S01 I09: a public plan cannot overwrite an invisible private page with the same semantic key', async (t) => {
  const { vault, llm } = await fixture();
  const secret = await vault.capture({ content: 'SECRET_BODY_CANARY', scope: 'user', sensitivity: 'secret' });
  await vault.wikiIngest({ evidenceIds: [secret.evidenceId], apply: true });
  const privatePage = (await vault.wikiCatalog()).find((page) => page.key === 'entity:atlas')!;
  const privateBytes = await readFile(join(vault.root, privatePage.path), 'utf8');
  const source = await vault.capture({ content: 'Public Atlas claim.', scope: 'public', sensitivity: 'public' });
  const principal: Principal = { id: 'public-writer', name: 'Public writer', permissions: ['write', 'review'], scopes: ['public'], maxSensitivity: 'public', tenantId: (await vault.config()).tenantId };
  const writer = new MemoryVault(vault.root, { llm, masterKey, principal });
  const decrypt = t.mock.method(writer.encryption, 'decrypt', async () => { throw new Error('Unauthorized decryption'); });
  const before = await checkpoint(vault);
  const plan = (await writer.wikiIngest({ evidenceIds: [source.evidenceId] })).plan!;
  assert.equal(decrypt.mock.callCount(), 0);
  // The transaction separately verifies global immutable evidence. This probe is
  // specifically for operation input access; do not replace that integrity check.
  decrypt.mock.restore();
  await assert.rejects(writer.wikiApply(plan), denied);
  assert.equal(await checkpoint(vault), before); assert.equal(await readFile(join(vault.root, privatePage.path), 'utf8'), privateBytes);
});

test('S01 S02 I09: operation-only roles do not grant read access and wrong-tenant workflows fail before dispatch', async () => {
  const { vault, llm } = await fixture();
  const source = await vault.capture({ content: 'Atlas is available.', scope: 'public', sensitivity: 'public' });
  const tenantId = (await vault.config()).tenantId;
  const role = (permissions: Principal['permissions']) => new MemoryVault(vault.root, { llm, principal: { id: 'restricted', name: 'Restricted', permissions, scopes: ['public'], maxSensitivity: 'public', tenantId } });
  const writer = role(['write']); const reviewer = role(['review']); const maintainer = role(['maintain']); const reader = role(['read']);
  const plan = (await writer.wikiIngest({ evidenceIds: [source.evidenceId] })).plan!;
  await assert.rejects(writer.wikiCatalog(), denied); await assert.rejects(writer.get(source.evidenceId), denied);
  await reviewer.wikiApply(plan); await assert.rejects(reviewer.wikiQuery('Atlas?'), denied);
  assert.equal((await maintainer.wikiLint({ semantic: true })).semantic, 'available');
  await assert.rejects(maintainer.search('Atlas'), denied);
  const answer = await reader.wikiQuery('Atlas?'); assert.ok(answer.citations.length);
  const pending = await writer.wikiFile(answer, { title: 'Read-independent filing plan' });
  assert.ok(pending.plan); await assert.rejects(reader.wikiApply(pending.plan), denied);
  const before = await checkpoint(vault); const count = llm.calls.length;
  for (const bound of [false, true]) {
    const principal: Principal = { id: 'wrong', name: 'Wrong tenant', permissions: ['read', 'write', 'review', 'maintain'], scopes: ['public'], maxSensitivity: 'public', ...(bound ? { tenantId: 'another-tenant' } : {}) };
    const wrong = new MemoryVault(vault.root, { llm, principal });
    for (const action of [() => wrong.wikiCatalog(), () => wrong.wikiRules(), () => wrong.wikiQuery('Atlas?'), () => wrong.wikiLint({ semantic: true }), () => wrong.wikiIngest({ evidenceIds: [source.evidenceId] }), () => wrong.wikiApply(plan), () => wrong.wikiFile(answer, { title: 'Denied' }), () => wrong.wikiMigrate(), () => wrong.wikiSetRules({ purpose: 'Denied', instructions: 'Denied' }), () => wrong.wikiRevoke('entity:atlas', 'Denied')]) await assert.rejects(action(), denied);
  }
  assert.equal(llm.calls.length, count); assert.equal(await checkpoint(vault), before);
  const changedRole = role(['review']); changedRole.principal.permissions = ['read'];
  await assert.rejects(changedRole.wikiApply(pending.plan), denied);
  await reviewer.wikiApply(pending.plan);
});
