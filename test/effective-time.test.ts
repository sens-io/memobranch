import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { MemoryVault } from '../src/vault.js';
import { localAdminPrincipal } from '../src/policy.js';
import { effectiveTimestamp, factEffectiveAt } from '../src/effective-time.js';
import { assertManagedDocument } from '../src/document-schema.js';
import { withOperation } from '../src/operation.js';
import type { ProposedMemory } from '../src/types.js';
import { LlmClient } from '../src/llm.js';

const proposal: ProposedMemory = { key: 'Atlas retention', kind: 'fact', statement: 'Atlas retains backups for seven days.',
  scope: 'public', sensitivity: 'public', confidence: 1, explicit: true, conditions: [], tags: [] };
const from = '2026-09-01T00:00:00.000Z', until = '2026-10-01T00:00:00.000Z';
async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/effective-time-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '49'.repeat(32) });
  await vault.initialize('effective time');
  const add = async (delta: Partial<ProposedMemory> = {}) => {
    const input = { ...proposal, ...delta };
    const source = await vault.capture({ content: input.statement, scope: input.scope, sensitivity: input.sensitivity });
    const candidate = await vault.propose(input, [source.evidencePath]);
    const approved = await vault.approve(candidate.id);
    return { ...approved, source };
  };
  return { vault, root, add };
}

test('effective time: strict timestamps and half-open boundaries are independent of recorded dates', async t => {
  const { vault, add, root } = await fixture(t), { memoryId, source } = await add();
  const original = await vault.get(memoryId), evidence = await readFile(join(root, source.evidencePath), 'utf8');
  const changed = await vault.setMemoryValidity(memoryId, { validFrom: '2026-09-01T08:00:00+08:00', validUntil: until, expectedRevision: 1 });
  assert.ok(changed.commit); assert.equal(changed.revision, 2); assert.equal(changed.validFrom, from);
  const memory = await vault.get(memoryId);
  assert.equal(memory.body, original.body); assert.equal(memory.meta.createdAt, original.meta.createdAt);
  assert.equal(memory.meta.validatedAt, original.meta.validatedAt); assert.equal(memory.meta.status, 'active');
  assert.equal(await readFile(join(root, source.evidencePath), 'utf8'), evidence);
  assert.equal((await vault.memoriesAt('2026-08-31T23:59:59.999Z')).total, 0);
  const atStart = await vault.memoriesAt(from); assert.equal(atStart.total, 1);
  assert.equal(atStart.items[0]!.recordedAt, original.meta.createdAt);
  assert.equal(atStart.items[0]!.validFrom, from); assert.equal(atStart.items[0]!.revision, 2);
  assert.equal((await vault.memoriesAt('2026-09-30T23:59:59.999Z')).total, 1);
  assert.equal((await vault.memoriesAt(until)).total, 0);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await vault.setMemoryValidity(memoryId, { validFrom: from, validUntil: until, expectedRevision: 2 })).commit, null);
  await vault.memoriesAt(from); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('effective time: unknown intervals are explicit and pagination follows filtering', async t => {
  const { vault, add } = await fixture(t);
  const a = await add({ key: 'A' }), b = await add({ key: 'B' });
  assert.equal((await vault.memoriesAt(from)).total, 0);
  const unknown = await vault.memoriesAt(from, { includeUnknown: true });
  assert.equal(unknown.total, 2); assert.equal(unknown.reconstruction, false);
  assert.ok(unknown.items.every(item => item.validFrom === null && item.uncertainty.length === 2));
  await vault.setMemoryValidity(a.memoryId, { validFrom: from, validUntil: null, expectedRevision: 1 });
  await vault.setMemoryValidity(b.memoryId, { validFrom: null, validUntil: until, expectedRevision: 1 });
  const result = await vault.memoriesAt(from, { offset: 1, limit: 1 });
  assert.equal(result.total, 2); assert.equal(result.items.length, 1);
  assert.equal((await vault.memoriesAt(from, { key: ' a ' })).items[0]!.id, a.memoryId);
  await vault.setMemoryValidity(a.memoryId, { validFrom: null, validUntil: null, expectedRevision: 2 });
  assert.equal((await vault.memoriesAt(from, { key: 'A' })).total, 0);
  assert.ok(factEffectiveAt({}));
});

test('effective time: invalid annotations and stale concurrent review fail without partial writes', async t => {
  const { vault, add } = await fixture(t), { memoryId } = await add();
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const date of ['yesterday', '2026-09-01', '2026-02-30T00:00:00Z', '2026-09-01T00:00:00', '2026-09-01T00:00:00.0001Z', '']) {
    await assert.rejects(vault.setMemoryValidity(memoryId, { validFrom: date, validUntil: null, expectedRevision: 1 }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(vault.memoriesAt(date), { code: 'VALIDATION_FAILED' });
  }
  for (const end of [from, '2026-08-31T23:59:59Z']) {
    await assert.rejects(vault.setMemoryValidity(memoryId, { validFrom: from, validUntil: end, expectedRevision: 1 }), { code: 'VALIDATION_FAILED' });
  }
  for (const options of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 0.5 }, { includeUnknown: 'yes' }, { unexpected: true }]) {
    await assert.rejects(vault.memoriesAt(from, options as never), { code: 'VALIDATION_FAILED' });
  }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const second = new MemoryVault(vault.root, { masterKey: '49'.repeat(32) });
  const results = await Promise.allSettled([vault.setMemoryValidity(memoryId, { validFrom: from, validUntil: until, expectedRevision: 1 }),
    second.setMemoryValidity(memoryId, { validFrom: from, validUntil: null, expectedRevision: 1 })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(failed.reason.code, 'VALIDATION_FAILED'); assert.equal((await vault.get(memoryId)).meta.revision, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withOperation(controller.signal, () => vault.memoriesAt(from)), { code: 'OPERATION_CANCELLED' });
});

test('effective time: current retrieval excludes future/ended records, keeps dates and rebuilds the derived cache', async t => {
  const { vault, add, root } = await fixture(t), record = await add();
  await vault.search('Atlas');
  await vault.setMemoryValidity(record.memoryId, { validFrom: '2999-01-01T00:00:00Z', validUntil: null, expectedRevision: 1 });
  assert.deepEqual(await vault.search('Atlas'), []); assert.equal((await vault.recall('Atlas')).text, '');
  assert.equal((await vault.contextDetailed('Atlas')).text, '');
  assert.doesNotMatch(await readFile(join(root, 'MEMORY.md'), 'utf8'), /seven days/);
  await vault.setMemoryValidity(record.memoryId, { validFrom: '2000-01-01T00:00:00Z', validUntil: '2001-01-01T00:00:00Z', expectedRevision: 2 });
  assert.equal((await vault.memoriesAt('2000-06-01T00:00:00Z')).total, 1);
  assert.deepEqual(await vault.search('Atlas'), []); assert.equal(await vault.context('Atlas'), '');
  await vault.setMemoryValidity(record.memoryId, { validFrom: from, validUntil: '2999-01-01T00:00:00Z', expectedRevision: 3 });
  const current = await vault.recall('Atlas'); assert.ok(current.text.includes('validFrom'));
  assert.equal(current.memories[0]!.validFrom, from); assert.match(current.text, /exclusive/);
  assert.match(await readFile(join(root, 'MEMORY.md'), 'utf8'), /Fact effective from/);
  assert.equal(JSON.parse(await readFile(join(root, '.amem/search-index.json'), 'utf8')).version, 6);
  const schema = await vault.get(record.memoryId);
  assert.throws(() => assertManagedDocument({ ...schema, meta: { ...schema.meta, validFrom: until, validUntil: from } }), { code: 'VALIDATION_FAILED' });
  assert.equal(effectiveTimestamp('2026-09-01T08:00:00+08:00'), from);
});

test('effective time: current tenant, permissions and confidential selection precede filtering/counting', async t => {
  const { vault, add } = await fixture(t), secret = await add({ key: 'PRIVATE_TIME_CANARY', scope: 'user', sensitivity: 'secret' });
  await vault.setMemoryValidity(secret.memoryId, { validFrom: from, validUntil: until, expectedRevision: 1 });
  const tenantId = (await vault.config()).tenantId;
  const reader = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId, permissions: ['read'], scopes: ['public'], maxSensitivity: 'public' } });
  const hidden = await reader.memoriesAt(from, { includeSecret: true, includeUnknown: true });
  assert.equal(hidden.total, 0); assert.doesNotMatch(JSON.stringify(hidden), /PRIVATE_TIME_CANARY/);
  await assert.rejects(reader.setMemoryValidity(secret.memoryId, { validFrom: null, validUntil: null, expectedRevision: 2 }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal((await vault.memoriesAt(from)).total, 0);
  assert.equal((await vault.memoriesAt(from, { includeSecret: true })).total, 1);
  const foreign = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId: 'foreign' } });
  await assert.rejects(foreign.memoriesAt(from), { code: 'AUTHORIZATION_DENIED' });
});

test('effective time: a warm index follows the clock without changing canonical knowledge', async t => {
  const { vault, add } = await fixture(t), record = await add();
  await vault.setMemoryValidity(record.memoryId, { validFrom: '2030-01-01T00:00:00Z', validUntil: '2040-01-01T00:00:00Z', expectedRevision: 1 });
  await vault.search('Atlas');
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const clock = t.mock.method(Date, 'now', () => Date.parse('2035-01-01T00:00:00Z'));
  assert.equal((await vault.search('Atlas'))[0]!.id, record.memoryId);
  assert.ok((await vault.recall('Atlas')).text.includes(record.memoryId));
  clock.mock.mockImplementation(() => Date.parse('2040-01-01T00:00:00Z'));
  assert.deepEqual(await vault.search('Atlas'), []); assert.equal(await vault.context('Atlas'), '');
  assert.equal((await vault.memoriesAt('2035-01-01T00:00:00Z')).total, 1);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('effective time: superseded context is warned, but revocation, expiry and erasure remain current', async t => {
  const { vault, add } = await fixture(t), old = await add();
  await vault.setMemoryValidity(old.memoryId, { validFrom: from, validUntil: until, expectedRevision: 1 });
  await add({ statement: 'Atlas retains backups for fourteen days.' });
  const retained = await vault.memoriesAt(from); assert.equal(retained.total, 1);
  assert.equal(retained.items[0]!.status, 'superseded'); assert.match(retained.items[0]!.uncertainty.join(' '), /not an active assertion/);
  await vault.forget(old.memoryId, 'Withdraw even historical context');
  assert.equal((await vault.memoriesAt(from)).total, 0);
  await assert.rejects(vault.setMemoryValidity(old.memoryId, { validFrom: from, validUntil: null, expectedRevision: 4 }), { code: 'VALIDATION_FAILED' });
  const secret = await add({ key: 'erased historical', sensitivity: 'secret' });
  await vault.setMemoryValidity(secret.memoryId, { validFrom: from, validUntil: until, expectedRevision: 1 });
  assert.equal((await vault.memoriesAt(from, { includeSecret: true })).total, 1);
  await vault.erase(secret.memoryId, 'Erase even historical context');
  assert.equal((await vault.memoriesAt(from, { includeSecret: true })).total, 0);
  const expired = await add({ key: 'expired historical', expiresAt: '2000-01-01T00:00:00Z' });
  await vault.setMemoryValidity(expired.memoryId, { validFrom: from, validUntil: until, expectedRevision: 1 });
  assert.equal((await vault.memoriesAt(from)).total, 0);
});

test('effective time: dated views cannot expose a memory with currently inaccessible supporting evidence', async t => {
  const { vault, add } = await fixture(t), record = await add({ scope: 'project' });
  // Both scopes are required independently, even though the derived memory is project-local.
  const publicSource = await vault.capture({ content: 'Extra public source', scope: 'public', sensitivity: 'public' });
  const candidate = await vault.propose({ ...proposal, scope: 'project' }, [record.source.evidencePath, publicSource.evidencePath]);
  await vault.approve(candidate.id);
  await vault.setMemoryValidity(record.memoryId, { validFrom: from, validUntil: until, expectedRevision: 2 });
  const reader = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), permissions: ['read'],
    scopes: ['project'], maxSensitivity: 'public', tenantId: (await vault.config()).tenantId } });
  assert.equal((await reader.memoriesAt(from)).total, 0);
  assert.equal((await vault.memoriesAt(from)).total, 1);
});

test('effective time: Wiki legacy navigation and dependent pages preserve dates and become unavailable together', async t => {
  const { vault, add } = await fixture(t), record = await add();
  await vault.setMemoryValidity(record.memoryId, { validFrom: from, validUntil: '2999-01-01T00:00:00Z', expectedRevision: 1 });
  class Compiler extends LlmClient {
    override async wiki<T>(operation: string, raw: object): Promise<T> {
      const input = raw as { catalog: Array<{ key: string }>; sources: Array<{ id: string }>;
        pages: Array<{ key: string; conditions: string[]; expiresAt?: string }> };
      if (operation === 'navigate') return { keys: input.catalog.map(item => item.key) } as T;
      const legacy = input.pages.find(item => item.key === `legacy:${record.memoryId}`)!;
      assert.ok(legacy.conditions.includes(`Fact effective from ${from} (inclusive).`));
      return { pages: input.sources.map(source => ({ key: `source:${source.id}`, pageType: 'source', title: 'Temporal summary', summary: 'Temporal source',
        body: 'TEMPORAL_DERIVED_CANARY', evidenceIds: [source.id], links: [legacy.key], status: 'active',
        conditions: legacy.conditions, uncertainty: [], expiresAt: legacy.expiresAt })) } as T;
    }
  }
  const compiler = new MemoryVault(vault.root, { llm: new Compiler({ apiKey: 'fixture', model: 'effective-fixture' }) });
  const planned = await compiler.wikiIngest({ evidenceIds: [record.source.evidenceId] });
  await compiler.wikiApply(planned.plan);
  assert.equal((await vault.wikiCatalog()).length, 2);
  const derivedId = (await vault.wikiCatalog()).find(item => !item.legacy)!.id;
  await vault.setMemoryValidity(record.memoryId, { validFrom: '2999-01-01T00:00:00Z', validUntil: null, expectedRevision: 2 });
  assert.deepEqual(await vault.wikiCatalog(), []);
  await assert.rejects(vault.get(derivedId));
  assert.equal((await vault.search('TEMPORAL_DERIVED_CANARY')).length, 0);
  assert.equal((await vault.recall('TEMPORAL_DERIVED_CANARY')).text, '');
  await assert.rejects(compiler.wikiApply(planned.plan), { code: 'VALIDATION_FAILED' });
});
