import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import type { Principal } from '../src/policy.js';
import type { ProposedMemory } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];
const masterKey = 'a7'.repeat(32);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<MemoryVault> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-diagnostic-provenance-'));
  roots.push(root);
  const vault = new MemoryVault(root, { masterKey });
  await vault.initialize('diagnostic provenance regression');
  return vault;
}

async function restricted(admin: MemoryVault, overrides: Partial<Principal> = {}): Promise<MemoryVault> {
  return new MemoryVault(admin.root, { masterKey, principal: {
    id: 'restricted', name: 'Restricted', permissions: ['maintain'], scopes: ['user'],
    maxSensitivity: 'internal', tenantId: (await admin.config()).tenantId, ...overrides,
  } });
}

test('doctor authorizes evidence before decryption or body-derived diagnostics', async t => {
  const admin = await fixture();
  await admin.capture({ content: '[private](SECRET_DIAGNOSTIC_LINK.md)', scope: 'user', sensitivity: 'secret', extract: false });
  await admin.capture({ content: '[project](PROJECT_DIAGNOSTIC_LINK.md)', scope: 'project', sensitivity: 'internal', extract: false });
  await admin.capture({ content: '[allowed](ALLOWED_DIAGNOSTIC_LINK.md)', scope: 'user', sensitivity: 'public', extract: false });
  const limited = await restricted(admin);
  const decrypt = t.mock.method(limited.encryption, 'decrypt', async () => { throw new Error('unauthorized decryption attempted'); });
  const report = await limited.doctor();
  assert.equal(decrypt.mock.callCount(), 0);
  assert.equal(report.counts.evidence, 1);
  assert.equal(report.evidence?.healthy, true);
  assert.deepEqual(report.deadLinks.map(link => link.target), ['ALLOWED_DIAGNOSTIC_LINK.md']);
  assert.doesNotMatch(JSON.stringify(report), /SECRET_DIAGNOSTIC_LINK|PROJECT_DIAGNOSTIC_LINK/);
  const elevated = await restricted(admin, { scopes: ['user', 'project'], maxSensitivity: 'secret' });
  assert.equal((await elevated.doctor()).counts.evidence, 3, 'maintenance-only retains authorized evidence visibility');
  const wrongTenant = await restricted(admin, { tenantId: 'wrong-tenant' });
  await assert.rejects(wrongTenant.doctor(), denied);
});

function proposal(overrides: Partial<ProposedMemory> = {}): ProposedMemory {
  return { key: 'shared deployment fact', statement: 'Use the approved deployment workflow.', kind: 'fact',
    scope: 'user', sensitivity: 'public', confidence: 1, explicit: true, conditions: [], tags: [], ...overrides };
}

for (const operation of ['approve', 'consolidate'] as const) {
  test(`${operation} merges provenance with strongest classification, earliest expiry and regenerated body`, async () => {
    const admin = await fixture();
    const first = await admin.propose(proposal({ conditions: ['original condition'], expiresAt: '2098-01-01T00:00:00.000Z' }));
    const original = await admin.approve(first.id);
    const secret = await admin.capture({ content: 'SECRET_DERIVATION_CONTENT', scope: 'user', sensitivity: 'secret', extract: false });
    const next = await admin.propose(proposal({ conditions: ['SECRET_DERIVATION_CONDITION'], tags: ['SECRET_DERIVATION_TAG'],
      expiresAt: '2097-01-01T00:00:00.000Z' }), [secret.evidencePath]);
    const reviewer = await restricted(admin, { permissions: ['review'], maxSensitivity: 'secret' });
    if (operation === 'approve') await reviewer.approve(next.id);
    else assert.deepEqual((await reviewer.consolidate()).merged, [next.id]);
    let memory = await admin.get(original.memoryId);
    assert.equal(memory.meta.sensitivity, 'secret');
    assert.deepEqual(memory.meta.evidence, [secret.evidencePath]);
    assert.deepEqual(memory.meta.conditions, ['original condition', 'SECRET_DERIVATION_CONDITION']);
    assert.equal(memory.meta.expiresAt, '2097-01-01T00:00:00.000Z');
    assert.match(memory.body, /SECRET_DERIVATION_CONDITION/);
    assert.ok(memory.body.includes(secret.evidencePath.split('/').at(-1)!));
    assert.doesNotMatch(memory.body, /Approved explicitly without attached evidence/);
    assert.doesNotMatch(await readFile(join(admin.root, original.memoryPath), 'utf8'), /SECRET_DERIVATION|evidence\//);
    const publicReader = await restricted(admin, { permissions: ['read'], maxSensitivity: 'public' });
    await assert.rejects(publicReader.get(original.memoryId), (error: unknown) => denied(error) || error instanceof AgentMemoryError && error.code === 'NOT_FOUND');
    assert.equal((await publicReader.search('approved deployment workflow')).length, 0);

    const publicEvidence = await admin.capture({ content: 'Public supplementary derivation.', scope: 'user', sensitivity: 'public', extract: false });
    const later = await admin.propose(proposal({ expiresAt: '2099-01-01T00:00:00.000Z' }), [publicEvidence.evidencePath]);
    if (operation === 'approve') await reviewer.approve(later.id);
    else await reviewer.consolidate();
    memory = await admin.get(original.memoryId);
    assert.equal(memory.meta.sensitivity, 'secret', 'a public derivation cannot downgrade a secret memory');
    assert.equal(memory.meta.expiresAt, '2097-01-01T00:00:00.000Z', 'a later expiry cannot extend the existing lifetime');
    assert.deepEqual(memory.meta.evidence, [secret.evidencePath, publicEvidence.evidencePath]);
  });
}

function denied(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED';
}
