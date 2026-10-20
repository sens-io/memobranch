import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { MemoryVault } from '../src/vault.js';
import { localAdminPrincipal } from '../src/policy.js';

async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/source-timeline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '68'.repeat(32) });
  await vault.initialize('source-history');
  return { vault, uri: 'https://example.invalid/atlas.md' };
}

test('source: versions preserve evidence and actual current references, newest recorded version suggests review', async t => {
  const { vault, uri } = await fixture(t);
  const old = await vault.capture({ content: 'Atlas keeps seven days.', sourceUri: uri, scope: 'public', sensitivity: 'public' });
  const candidate = await vault.propose({ key: 'Atlas retention', kind: 'fact', statement: 'Atlas keeps seven days.',
    scope: 'public', sensitivity: 'public', confidence: 1, explicit: true, conditions: [], tags: [] }, [old.evidencePath]);
  await vault.approve(candidate.id);
  const recent = await vault.capture({ content: 'Atlas keeps fourteen days.', sourceUri: uri, scope: 'public', sensitivity: 'public' });
  const before = await vault.git.run(['rev-parse', 'HEAD']);
  const result = await vault.sourceTimeline(uri);
  assert.equal(result.timeBasis, 'recorded-time-only'); assert.equal(result.total, 2);
  assert.equal(result.items[0]!.id, recent.evidenceId); assert.equal(result.items[0]!.isLatest, true);
  const prior = result.items.find(item => item.id === old.evidenceId)!;
  assert.equal(prior.latestEvidenceId, recent.evidenceId);
  assert.equal(prior.references[0]!.reviewReason, 'older-source-reference');
  assert.ok((await vault.get(old.evidenceId)).body.includes('seven days'));
  const until = await vault.sourceTimeline(uri, { to: prior.recordedAt });
  assert.equal(until.total, 1); assert.equal(until.items[0]!.isLatest, false);
  assert.equal((await vault.sourceTimeline(uri, { offset: 1, limit: 1 })).items.length, 1);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
  await vault.forget('Atlas retention', 'No longer valid');
  assert.ok((await vault.sourceTimeline(uri)).items.every(item => !item.references.length));
});

test('source: narrower readers do not learn secret versions or their effects on public versions', async t => {
  const { vault, uri } = await fixture(t);
  const publicSource = await vault.capture({ content: 'PUBLIC_VERSION', sourceUri: uri, scope: 'public', sensitivity: 'public' });
  await vault.capture({ content: 'SECRET_VERSION', sourceUri: uri, scope: 'user', sensitivity: 'secret' });
  const reader = new MemoryVault(vault.root, { masterKey: '', principal: { ...localAdminPrincipal(),
    tenantId: (await vault.config()).tenantId, permissions: ['read'], scopes: ['public'], maxSensitivity: 'public' } });
  const result = await reader.sourceTimeline(uri, { includeSecret: true });
  assert.equal(result.total, 1); assert.equal(result.items[0]!.id, publicSource.evidenceId);
  assert.equal(result.items[0]!.isLatest, true);
  assert.equal((await vault.sourceTimeline(uri)).total, 1);
  assert.ok((await vault.sourceTimeline(uri, { includeSecret: true })).items.every(item => item.isLatest));
  const foreign = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId: 'wrong' } });
  await assert.rejects(foreign.sourceTimeline(uri), { code: 'AUTHORIZATION_DENIED' });
});

test('source: invalid recorded-time ranges and paging fail, missing sources reveal no hidden count', async t => {
  const { vault, uri } = await fixture(t);
  for (const options of [{ from: 'yesterday' }, { from: '2026-10-20' }, { from: '2026-02-30T00:00:00Z' },
    { from: '2026-10-20T00:00:00Z', to: '2026-10-19T00:00:00Z' }, { offset: -1 }, { limit: 101 }]) {
    await assert.rejects(vault.sourceTimeline(uri, options), { code: 'VALIDATION_FAILED' });
  }
  assert.equal((await vault.sourceTimeline(uri)).total, 0);
});
