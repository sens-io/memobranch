import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { MaintenanceService } from '../src/maintenance.js';
import { principalFromEnv, type Permission, type Principal } from '../src/policy.js';
import { pendingTransactionCount, VaultTransaction } from '../src/transaction.js';
import type { ProposedMemory } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];
const masterKey = '69'.repeat(32);
const exec = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshVault(): Promise<MemoryVault> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-permissions-'));
  roots.push(root);
  const vault = new MemoryVault(root, { masterKey });
  await vault.initialize('permission-operations');
  return vault;
}

async function limitedVault(admin: MemoryVault, permission: Permission, overrides: Partial<Principal> = {}, llm?: LlmClient): Promise<MemoryVault> {
  const principal = principalFromEnv({
    AMEM_PERMISSIONS: permission,
    AMEM_ALLOWED_SCOPES: 'user',
    AMEM_MAX_SENSITIVITY: 'internal',
    AMEM_TENANT_ID: (await admin.config()).tenantId,
  });
  return new MemoryVault(admin.root, { principal: { ...principal, ...overrides }, masterKey, ...(llm ? { llm } : {}) });
}

function proposal(key: string, overrides: Partial<ProposedMemory> = {}): ProposedMemory {
  return { kind: 'fact', key, statement: `${key} is recorded.`, scope: 'user', sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [], ...overrides };
}

function denied(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED';
}

function hidden(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'NOT_FOUND';
}

class RecordingExtractor extends LlmClient {
  readonly inputs: string[] = [];

  override async extractMemories(content: string): Promise<ProposedMemory[]> {
    this.inputs.push(content);
    return [proposal('extracted preference', { scope: 'public', sensitivity: 'public' })];
  }
}

test('write-only capture deduplicates three retries and can extract and attach provenance', async () => {
  const admin = await freshVault();
  const llm = new RecordingExtractor();
  const writer = await limitedVault(admin, 'write', {}, llm);
  const first = await writer.capture({ content: 'Remember my preferred language.' });
  const second = await writer.capture({ content: 'Remember my preferred language.' });
  const third = await writer.capture({ content: 'Remember my preferred language.' });
  assert.deepEqual([first.duplicate, second.duplicate, third.duplicate], [false, true, true]);
  assert.equal(second.evidenceId, first.evidenceId);
  assert.equal(third.evidencePath, first.evidencePath);
  assert.equal(second.commit, null);
  assert.equal(third.commit, null);

  const extracted = await writer.extract(first.evidenceId);
  const candidate = await admin.get(extracted.candidates[0]!.id);
  assert.equal(llm.inputs.length, 1);
  assert.equal(candidate.meta.scope, 'user');
  assert.equal(candidate.meta.sensitivity, 'internal');
  assert.deepEqual(candidate.meta.evidence, [first.evidencePath]);
  const manual = await writer.propose(proposal('manual provenance'), [first.evidencePath]);
  assert.deepEqual((await admin.get(manual.id)).meta.evidence, [first.evidencePath]);
  const report = await admin.doctor();
  assert.equal(report.counts.evidence, 1);
  assert.deepEqual(report.documents?.errors, []);
  await assert.rejects(writer.get(first.evidenceId), denied);
  await assert.rejects(writer.search('preferred language', { includeEvidence: true, includeCandidates: true }), denied);
  await assert.rejects(writer.context('preferred language'), denied);
});

test('review-only approval, consolidation, conflict rejection, and revocation use review access', async () => {
  const admin = await freshVault();
  const evidence = await admin.capture({ content: 'The original deployment location is recorded.' });
  const original = await admin.propose(proposal('deployment location'), [evidence.evidencePath]);
  const reviewer = await limitedVault(admin, 'review');
  const approved = await reviewer.approve(original.id);
  const repeated = await reviewer.approve(original.id);
  assert.equal(repeated.memoryId, approved.memoryId);
  assert.equal(repeated.commit, null);

  const replacement = await admin.propose(proposal('deployment location', { statement: 'The deployment location changed.' }), [evidence.evidencePath]);
  const independent = await admin.propose(proposal('independent fact'), [evidence.evidencePath]);
  const consolidated = await reviewer.consolidate();
  assert.deepEqual(consolidated.conflicts, [replacement.id]);
  assert.deepEqual(consolidated.promoted, [independent.id]);
  assert.equal((await admin.get(approved.memoryId)).meta.status, 'conflicted');
  await reviewer.reject(replacement.id, 'Keep the original location');
  assert.equal((await admin.get(approved.memoryId)).meta.status, 'active');
  assert.equal((await admin.get(replacement.id)).meta.status, 'rejected');
  await reviewer.forget(approved.memoryId, 'The location was retired');
  assert.equal((await admin.get(approved.memoryId)).meta.status, 'revoked');
  await assert.rejects(reviewer.get(approved.memoryId), denied);
  await assert.rejects(reviewer.search('independent fact'), denied);
  await assert.rejects(reviewer.propose(proposal('unauthorized write')), denied);
});

test('an ongoing write cannot authorize concurrent external reads', async () => {
  const admin = await freshVault();
  const candidate = await admin.propose(proposal('private existing fact', { sensitivity: 'secret' }));
  const memory = await admin.approve(candidate.id);
  const writer = await limitedVault(admin, 'write', { maxSensitivity: 'secret' });
  let entered!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const encrypt = writer.encryption.encrypt.bind(writer.encryption);
  writer.encryption.encrypt = async (...args) => {
    entered();
    await released;
    return encrypt(...args);
  };
  const capture = writer.capture({ content: 'CONCURRENT_SECRET_CAPTURE', sensitivity: 'secret' });
  try {
    await writing;
    await assert.rejects(writer.get(memory.memoryId), denied);
    await assert.rejects(writer.search('private existing fact', { includeSecret: true }), denied);
    await assert.rejects(writer.context('private existing fact', { includeSecret: true }), denied);
  } finally {
    release();
    await capture;
  }
  assert.equal((await admin.doctor()).counts.evidence, 1);
});

test('operation reads enforce scope, sensitivity, and tenant before exposing evidence to extraction', async () => {
  const admin = await freshVault();
  const project = await admin.capture({ content: 'PROJECT_PRIVATE_EVIDENCE', scope: 'project' });
  const secret = await admin.capture({ content: 'SECRET_PRIVATE_EVIDENCE', sensitivity: 'secret' });
  const projectCandidate = await admin.propose(proposal('project candidate', { scope: 'project' }), [project.evidencePath]);
  const secretCandidate = await admin.propose(proposal('secret candidate', { sensitivity: 'secret' }), [secret.evidencePath]);
  const allowed = await admin.propose(proposal('allowed candidate'));
  const llm = new RecordingExtractor();
  const writer = await limitedVault(admin, 'write', {}, llm);
  const reviewer = await limitedVault(admin, 'review');
  const before = await admin.git.run(['rev-parse', 'HEAD']);

  for (const evidence of [project, secret]) {
    await assert.rejects(writer.extract(evidence.evidenceId), hidden);
    await assert.rejects(writer.propose(proposal('denied provenance'), [evidence.evidencePath]), denied);
  }
  for (const candidate of [projectCandidate, secretCandidate]) {
    await assert.rejects(reviewer.approve(candidate.id), hidden);
    await assert.rejects(reviewer.reject(candidate.id, 'must not change'), hidden);
  }
  assert.equal(llm.inputs.length, 0);
  assert.equal(await admin.git.run(['rev-parse', 'HEAD']), before);
  assert.equal((await readdir(join(admin.root, 'candidates'))).length, 3);
  const otherTenant = await limitedVault(admin, 'write', { tenantId: 'different-tenant' }, llm);
  await assert.rejects(otherTenant.extract(project.evidenceId), denied);
  await assert.rejects(otherTenant.capture({ content: 'must not be captured' }), denied);
  assert.equal(llm.inputs.length, 0);

  const consolidated = await reviewer.consolidate();
  assert.deepEqual(consolidated.promoted, [allowed.id]);
  assert.equal((await admin.get(projectCandidate.id)).meta.status, 'pending');
  assert.equal((await admin.get(secretCandidate.id)).meta.status, 'pending');
});

test('maintain-only health checks and expiry operate on authorized memories without read access', async () => {
  const admin = await freshVault();
  const user = await admin.propose(proposal('expired user fact', { expiresAt: '2000-01-01T00:00:00.000Z' }));
  const project = await admin.propose(proposal('expired project fact', { scope: 'project', expiresAt: '2000-01-01T00:00:00.000Z' }));
  const userMemory = await admin.approve(user.id);
  const projectMemory = await admin.approve(project.id);
  const maintainer = await limitedVault(admin, 'maintain');
  const report = await maintainer.doctor();
  assert.deepEqual(report.expired, [userMemory.memoryId]);
  assert.equal(report.counts.activeMemories, 1);
  assert.deepEqual((await maintainer.expireDue()).expired, [userMemory.memoryId]);
  assert.equal((await admin.get(userMemory.memoryId)).meta.status, 'revoked');
  assert.equal((await admin.get(projectMemory.memoryId)).meta.status, 'active');
  await maintainer.reindex();
  await assert.rejects(maintainer.get(userMemory.memoryId), denied);
  await assert.rejects(maintainer.search('expired'), denied);
});

test('sync-only principals can validate, push, reconcile, and refresh a pulled vault', async () => {
  const admin = await freshVault();
  const evidence = await admin.capture({ content: 'The remote phrase should be remembered.' });
  const candidate = await admin.propose(proposal('remote phrase'), [evidence.evidencePath]);
  const memory = await admin.approve(candidate.id);
  const remote = await mkdtemp(join(tmpdir(), 'memobranch-permissions-remote-'));
  const clone = await mkdtemp(join(tmpdir(), 'memobranch-permissions-clone-'));
  roots.push(remote, clone);
  await exec('git', ['init', '--bare', remote]);
  const syncer = await limitedVault(admin, 'sync');
  await syncer.configureRemote({ name: 'origin', url: remote, branch: 'main', push: true });
  assert.equal((await syncer.sync()).pushed, true);
  await exec('git', ['clone', '--branch', 'main', remote, clone]);
  await exec('git', ['config', 'user.name', 'Remote fixture'], { cwd: clone });
  await exec('git', ['config', 'user.email', 'remote@example.test'], { cwd: clone });
  const path = join(clone, memory.memoryPath);
  await writeFile(path, (await readFile(path, 'utf8')).replace('remote phrase is recorded.', 'PULLED_REMOTE_PHRASE is recorded.'));
  await exec('git', ['add', memory.memoryPath], { cwd: clone });
  await exec('git', ['commit', '-m', 'Update remote phrase'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  assert.equal((await syncer.sync({ push: false })).merged, true);
  assert.equal((await admin.search('PULLED_REMOTE_PHRASE'))[0]?.id, memory.memoryId);
  await assert.rejects(syncer.get(memory.memoryId), denied);
  await assert.rejects(syncer.doctor(), denied);
  await assert.rejects(syncer.reindex(), denied);
  const outsideScope = await limitedVault(admin, 'sync', { scopes: ['project'] });
  const localHead = await admin.git.run(['rev-parse', 'HEAD']);
  const remoteHead = (await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim();
  await assert.rejects(outsideScope.sync(), (error: unknown) =>
    error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT' && error.safeDetails?.causeCode === 'AUTHORIZATION_DENIED');
  assert.equal(await admin.git.run(['rev-parse', 'HEAD']), localHead);
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), remoteHead);
});

test('maintenance checks auto-sync permission before recovery or expiry can change the vault', async () => {
  const admin = await freshVault();
  const candidate = await admin.propose(proposal('expired before auto-sync', { expiresAt: '2000-01-01T00:00:00.000Z' }));
  const memory = await admin.approve(candidate.id);
  const remote = await mkdtemp(join(tmpdir(), 'memobranch-maintenance-permissions-remote-'));
  roots.push(remote);
  await exec('git', ['init', '--bare', remote]);
  await admin.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  const config = await admin.config();
  config.maintenance.autoSync = true;
  await writeFile(join(admin.root, 'agent-memory.json'), `${JSON.stringify(config, null, 2)}\n`);
  await admin.git.commit('Enable automatic synchronization', { id: 'fixture', name: 'Fixture' });

  const pending = await VaultTransaction.begin(admin.root, admin.git, { id: 'interrupted', name: 'Interrupted writer' }, 'Pending recovery fixture', masterKey, config.policy.requireEncryptionFor);
  await pending.write('MEMORY.md', 'PENDING_RECOVERY_MUST_REMAIN\n');
  const head = await admin.git.run(['rev-parse', 'HEAD']);
  const maintainer = await limitedVault(admin, 'maintain');
  try {
    await assert.rejects(new MaintenanceService(maintainer).runOnce(), (error: unknown) =>
      denied(error) && (error as AgentMemoryError).safeDetails?.permission === 'sync');
    assert.equal(await admin.git.run(['rev-parse', 'HEAD']), head);
    assert.equal((await admin.get(memory.memoryId)).meta.status, 'active');
    assert.equal(await readFile(join(admin.root, 'MEMORY.md'), 'utf8'), 'PENDING_RECOVERY_MUST_REMAIN\n');
    assert.equal(await pendingTransactionCount(admin.root), 1);
  } finally {
    await pending.rollback();
  }
});
