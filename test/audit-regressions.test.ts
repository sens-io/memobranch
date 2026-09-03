import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { MaintenanceService } from '../src/maintenance.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import type { Principal } from '../src/policy.js';
import type { ProposedMemory, Scope, Sensitivity } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';
import { sha256, withFileLock } from '../src/utils.js';

const roots: string[] = [];
const masterKey = '51'.repeat(32);
const exec = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshVault(options: ConstructorParameters<typeof MemoryVault>[1] = {}): Promise<MemoryVault> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-audit-'));
  roots.push(root);
  const vault = new MemoryVault(root, options);
  await vault.initialize('audit-regression');
  return vault;
}

function principal(tenantId: string, overrides: Partial<Principal> = {}): Principal {
  return {
    id: 'limited',
    name: 'Limited principal',
    permissions: ['read'],
    scopes: ['user'],
    maxSensitivity: 'public',
    tenantId,
    ...overrides,
  };
}

test('context, get, and history enforce principal scope, sensitivity, and tenant', async () => {
  const admin = await freshVault();
  const config = await admin.config();
  const proposed = await admin.propose({
    kind: 'fact', key: 'restricted context', statement: 'CONTEXT_SCOPE_LEAK_CANARY', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await admin.consolidate();

  const limited = new MemoryVault(admin.root, { principal: principal(config.tenantId) });
  assert.doesNotMatch(await limited.context('CONTEXT_SCOPE_LEAK_CANARY'), /CONTEXT_SCOPE_LEAK_CANARY/);

  const otherTenant = new MemoryVault(admin.root, {
    principal: principal('another-tenant', { scopes: ['user', 'project', 'team', 'public'], maxSensitivity: 'secret' }),
  });
  const memory = await admin.get((await admin.search('CONTEXT_SCOPE_LEAK_CANARY'))[0]!.id);
  await assert.rejects(otherTenant.get(String(memory.meta.id)), authorizationDenied);
  await assert.rejects(otherTenant.history(), authorizationDenied);
  assert.ok(proposed.id);
});

test('non-admin principals without a tenant fail closed while local admins remain usable', async () => {
  const admin = await freshVault();
  const unbound: Principal = {
    id: 'unbound', name: 'Unbound reader', permissions: ['read'], scopes: ['user', 'project', 'team', 'public'], maxSensitivity: 'secret',
  };
  const limited = new MemoryVault(admin.root, { principal: unbound });
  await assert.rejects(limited.config(), authorizationDenied);
  await assert.rejects(limited.search('anything'), authorizationDenied);
  await assert.rejects(limited.history(), authorizationDenied);
  assert.equal((await admin.config()).version, 2);

  const newRoot = await mkdtemp(join(tmpdir(), 'memobranch-unbound-init-'));
  roots.push(newRoot);
  const unboundMaintainer = new MemoryVault(newRoot, { principal: { ...unbound, permissions: ['maintain'] } });
  await assert.rejects(unboundMaintainer.initialize('denied'), authorizationDenied);
  assert.equal(existsSync(join(newRoot, 'agent-memory.json')), false);
});

class DowngradingLlm extends LlmClient {
  override async extractMemories(_content: string, _defaults: { scope: Scope; sensitivity: Sensitivity }): Promise<ProposedMemory[]> {
    return [{
      kind: 'fact', key: 'classified', statement: 'CLASSIFIED_PAYLOAD_91C2', scope: 'public', sensitivity: 'public',
      confidence: 1, explicit: true, conditions: [], tags: [],
    }];
  }
}

test('evidence provenance prevents an LLM from broadening scope or lowering sensitivity', async () => {
  const vault = await freshVault({ masterKey, llm: new DowngradingLlm() });
  const result = await vault.capture({
    content: 'CLASSIFIED_PAYLOAD_91C2', scope: 'team', sensitivity: 'secret', extract: true,
  });
  const candidate = await vault.get(result.candidates[0]!.id);
  assert.equal(candidate.meta.scope, 'team');
  assert.equal(candidate.meta.sensitivity, 'secret');
  const raw = await readFile(join(vault.root, result.candidates[0]!.path), 'utf8');
  assert.doesNotMatch(raw, /CLASSIFIED_PAYLOAD_91C2/);
  const gitMatch = await vault.git.run(['grep', '-n', 'CLASSIFIED_PAYLOAD_91C2', 'HEAD'], { allowFailure: true });
  assert.equal(gitMatch, '');
});

test('limited writers cannot erase other scopes from generated projections', async () => {
  const admin = await freshVault();
  const config = await admin.config();
  await admin.propose({
    kind: 'fact', key: 'project resident', statement: 'PROJECT_RESIDENT_CANARY', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await admin.consolidate();
  assert.match(await readFile(join(admin.root, 'MEMORY.md'), 'utf8'), /PROJECT_RESIDENT_CANARY/);

  const writer = new MemoryVault(admin.root, {
    principal: principal(config.tenantId, { permissions: ['read', 'write'], maxSensitivity: 'internal' }),
  });
  await writer.capture({ content: 'ordinary user evidence', scope: 'user', sensitivity: 'internal' });
  assert.match(await readFile(join(admin.root, 'MEMORY.md'), 'utf8'), /PROJECT_RESIDENT_CANARY/);
  assert.equal(existsSync(join(admin.root, 'agent-memory.json')), true);
});

test('an old lock owned by a live process is never stolen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-lock-audit-'));
  roots.push(root);
  const lock = join(root, 'write.lock');
  const handle = await open(lock, 'wx');
  await handle.writeFile(`${process.pid}\n2000-01-01T00:00:00.000Z\n`);
  await handle.close();
  await assert.rejects(withFileLock(lock, async () => undefined, 75), (error: unknown) =>
    error instanceof AgentMemoryError && error.code === 'LOCK_TIMEOUT');
});

test('concurrent stale-lock observers never overlap critical sections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-lock-race-audit-'));
  roots.push(root);
  const lock = join(root, 'write.lock');
  const critical = join(root, 'critical');
  const violations = join(root, 'violations');
  await writeFile(lock, `${JSON.stringify({ version: 1, pid: 2147483647, ownerToken: 'dead', createdAt: '2000-01-01T00:00:00.000Z' })}\n`);
  const worker = fileURLToPath(new URL('./fixtures/lock-worker.ts', import.meta.url));
  const start = String(Date.now() + 750);
  await Promise.all(Array.from({ length: 12 }, () => exec(process.execPath, ['--import', 'tsx', worker, lock, critical, violations, start])));
  assert.equal(existsSync(violations), false);
});

test('concurrent initialization is serialized and idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-init-audit-'));
  roots.push(root);
  const [first, second] = await Promise.all([new MemoryVault(root).initialize('concurrent'), new MemoryVault(root).initialize('concurrent')]);
  assert.deepEqual([first.created, second.created].sort(), [false, true]);
});

test('erasure failure makes no success commit and a durable intent can recover', async () => {
  const vault = await freshVault({ masterKey });
  await vault.propose({
    kind: 'fact', key: 'erasure target', statement: 'ERASURE_HISTORY_CANARY', scope: 'project',
    sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await vault.consolidate();
  const memory = (await vault.search('ERASURE_HISTORY_CANARY', { includeSecret: true }))[0]!;
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const originalErase = vault.encryption.erase.bind(vault.encryption);
  vault.encryption.erase = async () => { throw new Error('simulated key-store failure'); };
  await assert.rejects(vault.erase(memory.id, 'test failure ordering'), /simulated key-store failure/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(await vault.encryption.hasKey(memory.id), true);
  const audit = await readFile(join(vault.root, '.amem', 'audit.jsonl'), 'utf8');
  const eraseEvents = audit.trim().split('\n').map((line) => JSON.parse(line) as { operation: string; outcome: string }).filter((event) => event.operation === 'erase');
  assert.equal(eraseEvents.at(-1)?.outcome, 'error');

  vault.encryption.erase = originalErase;
  const intentPath = join(vault.root, '.amem', 'erasures', `${memory.id}.json`);
  const legacyIntent = JSON.parse(await readFile(intentPath, 'utf8')) as Record<string, unknown>;
  delete legacyIntent.reasonSha256;
  await writeFile(intentPath, `${JSON.stringify(legacyIntent, null, 2)}\n`);
  await vault.recover();
  assert.equal(await vault.encryption.hasKey(memory.id), false);
  assert.equal((await vault.search('ERASURE_HISTORY_CANARY', { includeSecret: true })).length, 0);
  await assert.rejects(vault.get(memory.id), (error: unknown) => error instanceof AgentMemoryError && error.code === 'NOT_FOUND');
  const tombstone = parseMarkdown<Record<string, unknown>>(await readFile(join(vault.root, memory.path), 'utf8'));
  assert.equal(tombstone.meta.reasonRecorded, false);
  assert.equal(tombstone.meta.reasonSha256, undefined);
});

test('successful erasure commits only a digest of the normalized reason', async () => {
  const vault = await freshVault({ masterKey });
  await vault.propose({
    kind: 'fact', key: 'digest erasure target', statement: 'ERASURE_DIGEST_PAYLOAD_994A', scope: 'project',
    sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await vault.consolidate();
  const memory = (await vault.search('ERASURE_DIGEST_PAYLOAD_994A', { includeSecret: true }))[0]!;
  const reason = '  legal deletion request 2026-09  ';
  await vault.erase('digest erasure target', reason);
  const raw = await readFile(join(vault.root, memory.path), 'utf8');
  const tombstone = parseMarkdown<Record<string, unknown>>(raw);
  assert.equal(tombstone.meta.reasonRecorded, true);
  assert.equal(tombstone.meta.reasonSha256, sha256(reason.trim()));
  assert.doesNotMatch(raw, /legal deletion request 2026-09/);
  const audit = await readFile(join(vault.root, '.amem', 'audit.jsonl'), 'utf8');
  assert.doesNotMatch(audit, /digest erasure target|legal deletion request 2026-09/);
});

test('index metadata tampering is unhealthy and cannot lower canonical authorization', async () => {
  const admin = await freshVault();
  const config = await admin.config();
  await admin.propose({
    kind: 'fact', key: 'indexed restriction', statement: 'INDEX_AUTH_CANARY', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await admin.consolidate();
  const indexPath = join(admin.root, '.amem', 'search-index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as { documents: Array<Record<string, unknown>> };
  index.documents[0]!.scope = 'user';
  index.documents[0]!.sensitivity = 'public';
  await writeFile(indexPath, `${JSON.stringify(index)}\n`);
  assert.equal((await admin.doctor()).index?.healthy, false);

  const limited = new MemoryVault(admin.root, { principal: principal(config.tenantId) });
  assert.equal((await limited.search('INDEX_AUTH_CANARY')).length, 0);
});

test('a long-lived search cache observes revocation completed by another process', async () => {
  const longLived = await freshVault();
  await longLived.propose({
    kind: 'fact', key: 'cross process revocation', statement: 'CROSS_PROCESS_REVOCATION_77C1', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await longLived.consolidate();
  const warmed = await longLived.search('CROSS_PROCESS_REVOCATION_77C1');
  assert.equal(warmed.length, 1);

  const secondProcess = new MemoryVault(longLived.root);
  await secondProcess.forget(warmed[0]!.id, 'revoked by another process');
  assert.equal((await longLived.search('CROSS_PROCESS_REVOCATION_77C1')).length, 0);
});

test('evidence hash changes make health fail and cannot be swept into another commit', async () => {
  const vault = await freshVault();
  const captured = await vault.capture({ content: 'ORIGINAL_EVIDENCE_C82A', scope: 'project', sensitivity: 'internal' });
  const path = join(vault.root, captured.evidencePath);
  await writeFile(path, (await readFile(path, 'utf8')).replace('ORIGINAL_EVIDENCE_C82A', 'TAMPERED_EVIDENCE_C82A'));
  const report = await vault.doctor();
  assert.equal(report.healthy, false);
  assert.equal(report.evidence?.healthy, false);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.propose({
    kind: 'fact', key: 'unrelated', statement: 'unrelated proposal', scope: 'project', sensitivity: 'internal',
    confidence: 1, explicit: true, conditions: [], tags: [],
  }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('evidence sensitivity downgrade fails integrity and cannot become publicly searchable', async () => {
  const admin = await freshVault();
  const config = await admin.config();
  const captured = await admin.capture({ content: 'EVIDENCE_DOWNGRADE_CANARY_38B1', scope: 'user', sensitivity: 'internal' });
  const absolute = join(admin.root, captured.evidencePath);
  await writeFile(absolute, (await readFile(absolute, 'utf8')).replace('sensitivity: internal', 'sensitivity: public'));
  await admin.git.commit('audit: simulate unauthorized evidence downgrade', admin.principal, [captured.evidencePath]);
  const report = await admin.doctor();
  assert.equal(report.healthy, false);
  assert.equal(report.evidence?.healthy, false);

  const publicReader = new MemoryVault(admin.root, { principal: principal(config.tenantId) });
  assert.equal((await publicReader.search('EVIDENCE_DOWNGRADE_CANARY_38B1', { includeEvidence: true })).length, 0);
  await assert.rejects(publicReader.get(captured.evidenceId), (error: unknown) =>
    error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED');
});

test('plaintext confidential documents are unhealthy and rejected during remote synchronization', async () => {
  const local = await freshVault();
  const plaintextPath = 'wiki/project/fact/plaintext-secret.md';
  await mkdir(join(local.root, 'wiki', 'project', 'fact'), { recursive: true });
  await writeFile(join(local.root, plaintextPath), serializeMarkdown({
    id: 'mem-plaintext-secret', type: 'memory', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    validatedAt: new Date().toISOString(), kind: 'fact', key: 'plaintext secret', scope: 'project', sensitivity: 'secret',
    confidence: 1, status: 'active', evidence: [], conditions: [], tags: [], revision: 1,
  }, '# Plaintext secret\n\nPLAINTEXT_SECRET_CANARY_76E4'));
  const localReport = await local.doctor();
  assert.equal(localReport.healthy, false);
  assert.equal(localReport.documents?.healthy, false);

  const { vault, clone } = await remoteFixture();
  const remotePath = join(clone, plaintextPath);
  await mkdir(join(clone, 'wiki', 'project', 'fact'), { recursive: true });
  await writeFile(remotePath, await readFile(join(local.root, plaintextPath), 'utf8'));
  await exec('git', ['add', plaintextPath], { cwd: clone });
  await exec('git', ['commit', '-m', 'remote: add plaintext secret'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.sync({ push: false }), (error: unknown) =>
    error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(existsSync(join(vault.root, plaintextPath)), false);
});

test('remote synchronization cannot modify or delete committed evidence', async () => {
  const { vault, clone } = await remoteFixture();
  const captured = await vault.capture({ content: 'REMOTE_IMMUTABLE_EVIDENCE_922F', scope: 'project', sensitivity: 'internal' });
  await vault.sync({ push: true });
  await exec('git', ['pull', '--ff-only'], { cwd: clone });
  const evidencePath = join(clone, captured.evidencePath);
  await writeFile(evidencePath, (await readFile(evidencePath, 'utf8')).replace('sensitivity: internal', 'sensitivity: public'));
  await exec('git', ['add', captured.evidencePath], { cwd: clone });
  await exec('git', ['commit', '-m', 'remote: rewrite evidence metadata'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.sync({ push: false }), (error: unknown) =>
    error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.match(await readFile(join(vault.root, captured.evidencePath), 'utf8'), /sensitivity: internal/);
});

test('secret logical keys remain absent from Git paths, content, and visible history subjects', async () => {
  const vault = await freshVault({ masterKey });
  const config = await vault.config();
  const secretKey = 'SECRET_KEY_GIT_CANARY_4FD2';
  await vault.propose({
    kind: 'fact', key: secretKey, statement: 'SECRET_GIT_PAYLOAD_1B94', scope: 'project', sensitivity: 'secret',
    confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await vault.consolidate();
  const paths = await vault.git.run(['ls-tree', '-r', '--name-only', 'HEAD']);
  const subjects = await vault.git.run(['log', '--format=%s']);
  const content = await vault.git.run(['grep', '-n', secretKey, 'HEAD'], { allowFailure: true });
  assert.doesNotMatch(paths.toLowerCase(), /secret-key-git-canary-4fd2/);
  assert.doesNotMatch(subjects, new RegExp(secretKey));
  assert.equal(content, '');

  const publicReader = new MemoryVault(vault.root, { principal: principal(config.tenantId) });
  const history = await publicReader.history();
  assert.ok(history.length > 0);
  assert.ok(history.every((entry) => entry.subject === '[redacted]'));
});

test('conflicts are excluded from ordinary retrieval and rejection restores the prior fact', async () => {
  const vault = await freshVault();
  await vault.propose({
    kind: 'fact', key: 'conflict lifecycle', statement: 'ORIGINAL_CONFLICT_VALUE', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await vault.consolidate();
  const replacement = await vault.propose({
    kind: 'fact', key: 'conflict lifecycle', statement: 'REPLACEMENT_CONFLICT_VALUE', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await vault.consolidate();
  assert.equal((await vault.search('ORIGINAL_CONFLICT_VALUE')).length, 0);
  await vault.reject(replacement.id, 'replacement was incorrect');
  assert.equal((await vault.doctor()).conflicts.length, 0);
  assert.equal((await vault.search('ORIGINAL_CONFLICT_VALUE')).length, 1);
});

test('explicit procedures still require the configured evidence threshold', async () => {
  const vault = await freshVault();
  const candidate = await vault.propose({
    kind: 'procedure', key: 'unsafe shortcut', statement: 'Deploy without evidence.', scope: 'team',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  assert.deepEqual((await vault.consolidate()).deferred, [candidate.id]);
});

test('credential-bearing URL variants are rejected before config or Git changes', async () => {
  const vault = await freshVault();
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const url of [
    'https://example.test/repo.git?X-Amz-Signature=SECRET123',
    'https://example.test/repo.git#credential=SECRET123',
    'ghp_SECRET123@example.test:org/repo.git',
  ]) {
    await assert.rejects(vault.configureRemote({ name: 'origin', url, branch: 'main', push: false }), remoteInvalid);
  }
  assert.equal((await vault.config()).remote, null);
  assert.equal(await vault.git.getRemoteUrl('origin'), null);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('failed remote configuration restores Git and tracked configuration together', async () => {
  const vault = await freshVault();
  const remote = await mkdtemp(join(tmpdir(), 'memobranch-config-remote-'));
  roots.push(remote);
  await exec('git', ['init', '--bare', remote]);
  const configure = vault.git.configureRemote.bind(vault.git);
  vault.git.configureRemote = async (name, url) => {
    await configure(name, url);
    throw new Error('simulated post-config failure');
  };
  await assert.rejects(vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false }), /simulated post-config failure/);
  vault.git.configureRemote = configure;
  assert.equal((await vault.config()).remote, null);
  assert.equal(await vault.git.getRemoteUrl('origin'), null);
});

test('invalid remote fast-forward is rolled back to the exact pre-sync revision', async () => {
  const { vault, remote, clone } = await remoteFixture();
  await mkdir(join(clone, 'wiki', 'project', 'fact'), { recursive: true });
  await writeFile(join(clone, 'wiki', 'project', 'fact', 'malformed.md'), '---\nid: malformed\ntype: memory\n---\n# malformed\n');
  await exec('git', ['add', 'wiki/project/fact/malformed.md'], { cwd: clone });
  await exec('git', ['commit', '-m', 'remote: malformed state'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.sync({ push: false }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(existsSync(join(vault.root, 'wiki', 'project', 'fact', 'malformed.md')), false);
  assert.ok(remote);
});

test('push failure after a remote pull restores local history and managed files', async () => {
  const { vault, clone } = await remoteFixture();
  await writeFile(join(clone, 'log.md'), `${await readFile(join(clone, 'log.md'), 'utf8')}\nREMOTE_PUSH_FAILURE_CANARY\n`);
  await exec('git', ['add', 'log.md'], { cwd: clone });
  await exec('git', ['commit', '-m', 'remote: update before push failure'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  await vault.git.run(['remote', 'set-url', '--add', '--push', 'origin', join(tmpdir(), `missing-push-${Date.now()}`)]);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const log = await readFile(join(vault.root, 'log.md'), 'utf8');
  await assert.rejects(vault.sync({ push: true }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_TRANSPORT');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(await readFile(join(vault.root, 'log.md'), 'utf8'), log);
});

test('health endpoint returns unavailable when doctor reports an unhealthy vault', async () => {
  const vault = await freshVault();
  await vault.propose({
    kind: 'fact', key: 'health conflict', statement: 'HEALTH_VALUE_ONE', scope: 'project', sensitivity: 'internal',
    confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await vault.consolidate();
  await vault.propose({
    kind: 'fact', key: 'health conflict', statement: 'HEALTH_VALUE_TWO', scope: 'project', sensitivity: 'internal',
    confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await vault.consolidate();
  const service = new MaintenanceService(vault);
  const handle = await service.start({ port: 0 });
  try {
    const response = await fetch(`http://${handle.host}:${handle.port}/healthz`);
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { status: string }).status, 'unavailable');
  } finally {
    await handle.stop();
  }
});

async function remoteFixture(): Promise<{ vault: MemoryVault; remote: string; clone: string }> {
  const remote = await mkdtemp(join(tmpdir(), 'memobranch-audit-remote-'));
  roots.push(remote);
  await exec('git', ['init', '--bare', remote]);
  const vault = await freshVault();
  await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  await vault.sync({ push: true });
  const cloneParent = await mkdtemp(join(tmpdir(), 'memobranch-audit-clone-'));
  roots.push(cloneParent);
  const clone = join(cloneParent, 'clone');
  await exec('git', ['clone', remote, clone]);
  await exec('git', ['config', 'user.name', 'Audit remote'], { cwd: clone });
  await exec('git', ['config', 'user.email', 'audit@example.test'], { cwd: clone });
  return { vault, remote, clone };
}

function authorizationDenied(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED';
}

function remoteInvalid(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'REMOTE_INVALID';
}
