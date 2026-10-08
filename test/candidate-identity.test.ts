import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MemoryVault } from '../src/vault.js';
import type { ProposedMemory } from '../src/types.js';
import { serializeMarkdown } from '../src/markdown.js';
import { shortId } from '../src/utils.js';

const proposal: ProposedMemory = { kind: 'fact', key: 'identity', statement: 'Shared fact', scope: 'user',
  sensitivity: 'public', confidence: 1, explicit: true, conditions: [], tags: [] };

test('candidate retries preserve all derivation metadata and approval retains increased restrictions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-candidate-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '48'.repeat(32) });
  await vault.initialize('candidate identity');
  const first = await vault.propose(proposal);
  await vault.approve(first.id);
  assert.equal((await vault.propose(proposal)).id, first.id);
  const changed = { ...proposal, sensitivity: 'secret' as const, conditions: ['only in old context'], expiresAt: '2000-01-01T00:00:00.000Z' };
  const second = await vault.propose(changed);
  assert.equal(second.duplicate, false);
  assert.notEqual(second.id, first.id);
  assert.equal((await vault.propose(changed)).id, second.id);
  const approved = await vault.approve(second.id);
  const memory = await vault.get(approved.memoryId);
  assert.equal(memory.meta.sensitivity, 'secret');
  assert.deepEqual(memory.meta.conditions, changed.conditions);
  assert.equal(memory.meta.expiresAt, changed.expiresAt);
  assert.deepEqual(await vault.search('Shared fact'), []);
});

test('NUL-delimited fields no longer conflate candidates or canonical identities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-candidate-nul-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root);
  await vault.initialize('candidate NUL');
  const first = await vault.propose({ ...proposal, key: 'a\0b', statement: 'c' });
  const second = await vault.propose({ ...proposal, key: 'a', statement: 'b\0c' });
  assert.notEqual(first.id, second.id);
  const a = await vault.approve(first.id);
  const b = await vault.approve(second.id);
  assert.notEqual(a.memoryId, b.memoryId);
  assert.equal((await vault.doctor()).healthy, true);
});

test('a public writer cannot infer a secret candidate through deduplication', async t => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-candidate-clearance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '48'.repeat(32) });
  await vault.initialize('candidate clearance');
  const secret = await vault.propose({ ...proposal, sensitivity: 'secret' });
  const writer = new MemoryVault(root, { principal: { id: 'writer', name: 'writer', permissions: ['write'],
    scopes: ['user'], maxSensitivity: 'public', tenantId: (await vault.config()).tenantId } });
  const result = await writer.propose(proposal);
  assert.equal(result.duplicate, false);
  assert.notEqual(result.id, secret.id);
  assert.equal((await writer.propose(proposal)).duplicate, true);
});

test('each derivation field participates in identity and exact legacy retries retain their IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-candidate-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '48'.repeat(32) });
  await vault.initialize('legacy retries');
  const first = await vault.propose(proposal);
  const document = await vault.get(first.id);
  const legacyId = `cand-${shortId(`${proposal.scope}\0${proposal.kind}\0${proposal.key}\0${proposal.statement}\0`)}`;
  await rm(join(root, first.path));
  await writeFile(join(root, 'candidates', `${legacyId}.md`), serializeMarkdown({ ...document.meta, id: legacyId }, document.body));
  await vault.git.commit('fixture: legacy candidate identity', vault.principal);
  const retry = await vault.propose(proposal);
  assert.equal(retry.id, legacyId);
  assert.equal(retry.duplicate, true);
  const identities = new Set([legacyId]);
  for (const delta of [{ sensitivity: 'secret' }, { confidence: 0.5 }, { explicit: false },
    { conditions: ['conditional'] }, { tags: ['tagged'] }, { expiresAt: '2099-01-01T00:00:00.000Z' }] as Partial<ProposedMemory>[]) {
    const changed = await vault.propose({ ...proposal, ...delta });
    assert.equal(changed.duplicate, false);
    assert.equal(identities.has(changed.id), false);
    identities.add(changed.id);
    assert.equal((await vault.propose({ ...proposal, ...delta })).id, changed.id);
  }
});
