import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { principalFromEnv } from '../src/policy.js';
import { MemoryVault } from '../src/vault.js';

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `memobranch-sync-recovery-${name}-`));
  roots.push(root);
  return root;
}

async function fixture() {
  const vault = new MemoryVault(await temporary('vault'));
  await vault.initialize('original sync recovery configuration');
  const remote = await temporary('remote');
  await exec('git', ['init', '--bare', '--initial-branch=main', remote]);
  await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  await vault.sync({ push: true });
  await writeFile(join(vault.root, '.amem', 'sync-state.json'), '{ "lastSuccessfulSync": "2001-02-03T04:05:06.000Z" }\n');
  const clone = join(await temporary('clone'), 'checkout');
  await exec('git', ['clone', '--branch', 'main', remote, clone]);
  await exec('git', ['config', 'user.name', 'Sync recovery fixture'], { cwd: clone });
  await exec('git', ['config', 'user.email', 'sync-recovery@example.invalid'], { cwd: clone });
  const config = await vault.config();
  return { vault, remote, clone, config, original: await snapshot(vault) };
}

async function optionalFile(path: string): Promise<string | null> {
  return existsSync(path) ? readFile(path, 'utf8') : null;
}

async function journals(vault: MemoryVault): Promise<Record<string, string>> {
  const directory = join(vault.root, '.amem', 'transactions');
  if (!existsSync(directory)) return {};
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async (name) =>
    [name, await readFile(join(directory, name), 'utf8')])));
}

async function snapshot(vault: MemoryVault) {
  return {
    head: await vault.git.run(['rev-parse', 'HEAD']),
    config: await readFile(join(vault.root, 'agent-memory.json'), 'utf8'),
    syncState: await optionalFile(join(vault.root, '.amem', 'sync-state.json')),
    backup: await optionalFile(join(vault.root, 'agent-memory.json.v1.bak')),
    journals: await journals(vault),
  };
}

function limited(vault: MemoryVault, tenantId: string, permissions: string): MemoryVault {
  return new MemoryVault(vault.root, {
    principal: principalFromEnv({
      AMEM_TENANT_ID: tenantId,
      AMEM_PERMISSIONS: permissions,
      AMEM_ALLOWED_SCOPES: 'user,project,public',
      AMEM_MAX_SENSITIVITY: 'secret',
    }),
  });
}

async function publishConfig(clone: string, content: string): Promise<void> {
  await writeFile(join(clone, 'agent-memory.json'), content);
  await exec('git', ['add', '--', 'agent-memory.json'], { cwd: clone });
  await exec('git', ['commit', '-m', 'remote configuration fixture'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
}

function blockRollbackWithRealIndexLock(vault: MemoryVault): string {
  const lock = join(vault.git.gitDir, 'index.lock');
  const run = vault.git.run.bind(vault.git);
  vault.git.run = async (args, options) => {
    // Let merge and reconciliation execute in Git. Only the compensating reset
    // acquires a real conflicting lock, then actual Git reports the failure.
    if (args[0] === 'reset' && !existsSync(lock)) await writeFile(lock, 'held by sync recovery regression\n');
    return run(args, options);
  };
  return lock;
}

function forbidTransport(vault: MemoryVault): () => number {
  const run = vault.git.run.bind(vault.git);
  let attempts = 0;
  vault.git.run = async (args, options) => {
    if (['fetch', 'push', 'ls-remote'].includes(args[0] ?? '')) {
      attempts += 1;
      throw new Error('network is unavailable during local recovery');
    }
    return run(args, options);
  };
  return () => attempts;
}

function denied(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED';
}

test('a rejected legacy reconciliation survives a real reset lock and restores the exact snapshot after restart', async () => {
  const { vault, clone, config, original } = await fixture();
  const legacy = {
    version: 1, vaultId: config.vaultId, name: 'remote legacy accepted only on retry',
    createdAt: config.createdAt, residentBudget: 9, minimumConfidence: 0.2, minimumProcedureEvidence: 2,
  };
  await publishConfig(clone, JSON.stringify(legacy));
  const hook = join(vault.git.gitDir, 'hooks', 'pre-commit');
  const marker = join(vault.git.gitDir, 'pre-commit-rejected');
  await writeFile(hook, '#!/bin/sh\nprintf rejected > "$GIT_DIR/pre-commit-rejected"\nexit 1\n');
  await chmod(hook, 0o755);
  const lock = blockRollbackWithRealIndexLock(vault);
  await assert.rejects(vault.sync({ push: false }));
  assert.equal(await readFile(marker, 'utf8'), 'rejected', 'the actual pre-commit hook rejected reconciliation');
  assert.equal(existsSync(lock), true, 'the actual Git index lock blocks compensation');
  const intent = join(vault.root, '.amem', 'sync-intent.json');
  assert.equal(existsSync(intent), true, 'failed compensation retains durable recovery intent');
  assert.notEqual(await vault.git.run(['rev-parse', 'HEAD']), original.head);
  await rm(lock);
  await rm(hook);

  const restarted = limited(vault, config.tenantId, 'maintain');
  const transportAttempts = forbidTransport(restarted);
  await restarted.recover();
  assert.deepEqual(await snapshot(restarted), original);
  assert.equal(existsSync(intent), false);
  assert.equal(transportAttempts(), 0, 'prepared recovery needs no remote permission or connection');
  assert.equal((await restarted.git.integrity()).dirty, false);
  await restarted.recover();
  assert.deepEqual(await snapshot(restarted), original, 'recovery is idempotent');

  const retry = new MemoryVault(vault.root);
  assert.equal((await retry.sync({ push: false })).merged, true);
  assert.equal((await retry.config()).name, legacy.name);
  assert.equal((await retry.config()).version, 2);
  assert.equal(JSON.parse(await readFile(join(vault.root, 'agent-memory.json.v1.bak'), 'utf8')).version, 1);
  assert.deepEqual(await journals(retry), {});
  assert.equal(existsSync(intent), false);
});

for (const invalid of ['malformed JSON', 'future schema', 'changed tenant'] as const) {
  test(`original-tenant maintain-only recovery restores a pulled ${invalid} configuration offline`, async () => {
    const { vault, clone, config, original } = await fixture();
    const remoteConfig = invalid === 'malformed JSON' ? '{invalid remote configuration'
      : JSON.stringify({ ...config, ...(invalid === 'future schema' ? { version: 999 } : { tenantId: 'untrusted-remote-tenant' }) });
    await publishConfig(clone, remoteConfig);
    const syncer = limited(vault, config.tenantId, 'sync');
    const lock = blockRollbackWithRealIndexLock(syncer);
    await assert.rejects(syncer.sync({ push: false }));
    assert.equal(existsSync(lock), true);
    const intent = join(vault.root, '.amem', 'sync-intent.json');
    assert.equal(existsSync(intent), true);
    assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), remoteConfig);
    await rm(lock);

    const rejectedSnapshot = await snapshot(vault);
    const intentBefore = await readFile(intent, 'utf8');
    const wrongTenant = limited(vault, 'untrusted-remote-tenant', 'maintain');
    const wrongTransportAttempts = forbidTransport(wrongTenant);
    await assert.rejects(wrongTenant.recover(), denied);
    assert.deepEqual(await snapshot(vault), rejectedSnapshot, 'denied recovery leaves partial state untouched');
    assert.equal(await readFile(intent, 'utf8'), intentBefore);
    assert.equal(wrongTransportAttempts(), 0);

    const restarted = limited(vault, config.tenantId, 'maintain');
    const transportAttempts = forbidTransport(restarted);
    await restarted.recover();
    assert.deepEqual(await snapshot(restarted), original);
    assert.equal(existsSync(intent), false);
    assert.equal(transportAttempts(), 0);
    assert.equal((await restarted.git.integrity()).dirty, false);
  });
}

test('accepted push bookkeeping failure retains the pushed revision and can recover offline', async () => {
  const { vault, clone, remote, config, original } = await fixture();
  await publishConfig(clone, JSON.stringify({ ...config, name: 'accepted remote configuration' }));
  const run = vault.git.run.bind(vault.git);
  const status = vault.git.remoteStatus.bind(vault.git);
  let pushed = false;
  vault.git.run = async (args, options) => {
    const result = await run(args, options);
    if (args[0] === 'push') pushed = true;
    return result;
  };
  vault.git.remoteStatus = async (...args) => {
    if (pushed) throw new Error('local bookkeeping failed after the remote accepted the push');
    return status(...args);
  };
  await assert.rejects(vault.sync({ push: true }));
  assert.equal(pushed, true);
  const accepted = await snapshot(vault);
  assert.notEqual(accepted.head, original.head);
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), accepted.head);
  const intent = join(vault.root, '.amem', 'sync-intent.json');
  assert.equal(existsSync(intent), true);

  const restarted = limited(vault, config.tenantId, 'maintain');
  const transportAttempts = forbidTransport(restarted);
  await restarted.recover();
  assert.equal(await restarted.git.run(['rev-parse', 'HEAD']), accepted.head);
  assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), accepted.config);
  assert.equal((await restarted.config()).name, 'accepted remote configuration');
  const recoveredSyncState = await readFile(join(vault.root, '.amem', 'sync-state.json'), 'utf8');
  assert.ok(JSON.parse(recoveredSyncState).lastSuccessfulSync);
  assert.notEqual(recoveredSyncState, original.syncState);
  assert.equal(existsSync(intent), false);
  assert.deepEqual(await journals(restarted), {});
  assert.equal(transportAttempts(), 0);
  assert.equal((await restarted.git.integrity()).dirty, false);
});

test('cleanup failure after reset retains recovery intent and blocks the next writer until repaired', async () => {
  const { vault, clone, original } = await fixture();
  await publishConfig(clone, '{malformed remote configuration');
  const statePath = join(vault.root, '.amem', 'sync-state.json');
  const intent = join(vault.root, '.amem', 'sync-intent.json');
  const run = vault.git.run.bind(vault.git);
  let injected = false;
  vault.git.run = async (args, options) => {
    const result = await run(args, options);
    if (args[0] === 'clean' && !injected) {
      injected = true;
      await rm(statePath);
      await mkdir(statePath);
    }
    return result;
  };
  await assert.rejects(vault.sync({ push: false }));
  assert.equal(injected, true);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), original.head);
  assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), original.config);
  assert.equal(existsSync(intent), true);

  const restarted = new MemoryVault(vault.root);
  const attempts = forbidTransport(restarted);
  await assert.rejects(restarted.capture({ content: 'must not be captured while recovery cannot finish' }));
  assert.equal(await restarted.git.run(['rev-parse', 'HEAD']), original.head);
  assert.equal(existsSync(intent), true);
  await rm(statePath, { recursive: true });
  await restarted.recover();
  assert.deepEqual(await snapshot(restarted), original);
  assert.equal(existsSync(intent), false);
  assert.equal(attempts(), 0);
  assert.equal((await restarted.git.integrity()).dirty, false);
});

test('an unknown push retains its revision until a sync-authorized recovery confirms the remote', async () => {
  const { vault, clone, remote, config, original } = await fixture();
  await publishConfig(clone, JSON.stringify({ ...config, name: 'remote accepted before transport interruption' }));
  const run = vault.git.run.bind(vault.git);
  let pushed = false;
  vault.git.run = async (args, options) => {
    if (pushed && ['fetch', 'ls-remote'].includes(args[0] ?? '')) throw new Error('remote confirmation is offline');
    const result = await run(args, options);
    if (args[0] === 'push') {
      pushed = true;
      throw new Error('transport interrupted after the real push completed');
    }
    return result;
  };
  await assert.rejects(vault.sync({ push: true }));
  assert.equal(pushed, true);
  const accepted = await snapshot(vault);
  assert.notEqual(accepted.head, original.head);
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), accepted.head);
  const intent = join(vault.root, '.amem', 'sync-intent.json');
  const intentBefore = await readFile(intent, 'utf8');

  const maintainer = limited(vault, config.tenantId, 'maintain');
  const transportAttempts = forbidTransport(maintainer);
  const health = await maintainer.doctor();
  assert.equal(health.healthy, false);
  assert.equal(health.recovery?.pending, 1, 'diagnostics include the outer sync intent');
  await assert.rejects(maintainer.recover(), denied);
  assert.deepEqual(await snapshot(maintainer), accepted);
  assert.equal(await readFile(intent, 'utf8'), intentBefore);
  assert.equal(transportAttempts(), 0, 'maintain permission cannot authorize remote confirmation');

  const restarted = limited(vault, config.tenantId, 'maintain,sync');
  await restarted.recover();
  assert.equal(await restarted.git.run(['rev-parse', 'HEAD']), accepted.head);
  assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), accepted.config);
  assert.equal(existsSync(intent), false);
  assert.deepEqual(await journals(restarted), {});
  assert.equal((await restarted.git.integrity()).dirty, false);
});

test('a later remote descendant confirms an interrupted push without reverting either revision', async () => {
  const { vault, clone, remote, config } = await fixture();
  await publishConfig(clone, JSON.stringify({ ...config, name: 'accepted before interruption' }));
  const run = vault.git.run.bind(vault.git);
  vault.git.run = async (args, options) => {
    const result = await run(args, options);
    if (args[0] === 'push') throw new AgentMemoryError('REMOTE_TRANSPORT', 'interrupted push response', { timedOut: true });
    return result;
  };
  await assert.rejects(vault.sync({ push: true }));
  const accepted = await snapshot(vault);
  await publishConfig(clone, JSON.stringify({ ...config, name: 'later independent remote update' }));
  const remoteHead = (await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim();
  assert.notEqual(remoteHead, accepted.head);
  const restarted = limited(vault, config.tenantId, 'maintain,sync');
  await restarted.recover();
  assert.equal(await restarted.git.run(['rev-parse', 'HEAD']), accepted.head);
  assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), accepted.config);
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), remoteHead);
  assert.equal(existsSync(join(vault.root, '.amem', 'sync-intent.json')), false);
  assert.deepEqual(await journals(restarted), {});
});
