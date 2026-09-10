import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { withOperation } from '../src/operation.js';
import { MemoryVault } from '../src/vault.js';

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `memobranch-push-rejection-${name}-`));
  roots.push(root);
  return root;
}

async function fileBytes(root: string, relative = ''): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!relative && entry.name === '.amem') continue;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await fileBytes(root, path));
    else files[path] = await readFile(join(root, path));
  }
  return files;
}

async function snapshot(vault: MemoryVault) {
  const journals = join(vault.root, '.amem', 'transactions');
  return {
    head: await vault.git.run(['rev-parse', 'HEAD']),
    managedFiles: await fileBytes(vault.root),
    syncState: await readFile(join(vault.root, '.amem', 'sync-state.json')),
    journals: existsSync(journals) ? await fileBytes(journals) : {},
  };
}

async function fixture() {
  const vault = new MemoryVault(await temporary('vault'));
  await vault.initialize('original push rejection configuration');
  const remote = await temporary('remote');
  await exec('git', ['init', '--bare', remote]);
  await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  await vault.sync({ push: true });
  await writeFile(join(vault.root, '.amem', 'sync-state.json'), '{ "lastSuccessfulSync": "2001-02-03T04:05:06.000Z" }\n');
  const clone = join(await temporary('clone'), 'checkout');
  await exec('git', ['clone', '--branch', 'main', remote, clone]);
  await exec('git', ['config', 'user.name', 'Push rejection fixture'], { cwd: clone });
  await exec('git', ['config', 'user.email', 'push-rejection@example.invalid'], { cwd: clone });
  const remoteConfig = { ...await vault.config(), name: 'remote configuration pulled before rejected push' };
  await writeFile(join(clone, 'agent-memory.json'), JSON.stringify(remoteConfig));
  await exec('git', ['add', '--', 'agent-memory.json'], { cwd: clone });
  await exec('git', ['commit', '-m', 'remote configuration update'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  const local = await vault.capture({ content: 'Local evidence committed before the rejected synchronization', extract: false });
  assert.ok(local.commit);
  const original = await snapshot(vault);
  const remoteHead = (await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim();
  assert.notEqual(original.head, remoteHead, 'both sides must contain an independent new commit');
  return { vault, remote, remoteConfig, remoteHead, local, original };
}

async function assertRestored(vault: MemoryVault, original: Awaited<ReturnType<typeof snapshot>>): Promise<void> {
  assert.deepEqual(await snapshot(vault), original, 'failure must restore exact pre-sync HEAD, managed bytes, sync state, and journals');
  assert.equal(existsSync(join(vault.root, '.amem', 'sync-intent.json')), false, 'a confirmed failed push retires its recovery intent');
  assert.equal(existsSync(join(vault.root, '.amem', 'write.lock')), false);
  assert.equal((await vault.git.integrity()).dirty, false);
}

async function assertRetryWorks(vault: MemoryVault, remote: string, remoteName: string, localPath: string): Promise<void> {
  const captured = await vault.capture({ content: 'New evidence captured after the failed synchronization', extract: false });
  assert.ok(captured.commit, 'the next writer must succeed without manual recovery');
  const result = await vault.sync({ push: true });
  assert.equal(result.merged, true);
  assert.equal(result.pushed, true);
  assert.equal((await vault.config()).name, remoteName);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), head);
  assert.match((await exec('git', ['--git-dir', remote, 'show', `refs/heads/main:${localPath}`])).stdout, /Local evidence committed before/);
  assert.match((await exec('git', ['--git-dir', remote, 'show', `refs/heads/main:${captured.evidencePath}`])).stdout, /New evidence captured after/);
  assert.equal(existsSync(join(vault.root, '.amem', 'sync-intent.json')), false);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'transactions')), []);
  assert.equal((await vault.git.integrity()).dirty, false);
}

test('a real pre-receive rejection restores pre-sync local state and permits the next capture and sync', async () => {
  const { vault, remote, remoteConfig, remoteHead, local, original } = await fixture();
  const hook = join(remote, 'hooks', 'pre-receive');
  await writeFile(hook, '#!/bin/sh\nprintf rejected > push-rejected\nexit 1\n');
  await chmod(hook, 0o755);
  const run = vault.git.run.bind(vault.git);
  let nameAtPush: string | undefined;
  vault.git.run = async (args, options) => {
    if (args[0] === 'push') nameAtPush = JSON.parse(await readFile(join(vault.root, 'agent-memory.json'), 'utf8')).name;
    return run(args, options);
  };
  try {
    await assert.rejects(vault.sync({ push: true }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_TRANSPORT');
  } finally {
    vault.git.run = run;
  }
  assert.equal(nameAtPush, remoteConfig.name, 'the remote configuration must have been pulled before pushing');
  assert.equal(await readFile(join(remote, 'push-rejected'), 'utf8'), 'rejected', 'the actual remote hook rejected the push');
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), remoteHead, 'the rejected remote ref must not advance');
  await assertRestored(vault, original);
  await rm(hook);
  await assertRetryWorks(vault, remote, remoteConfig.name, local.evidencePath);
});

test('cancellation before push dispatch restores pre-sync state without leaving unknown push recovery', async () => {
  const { vault, remote, remoteConfig, remoteHead, local, original } = await fixture();
  const run = vault.git.run.bind(vault.git);
  const controller = new AbortController();
  let reachedPush = false;
  vault.git.run = async (args, options) => {
    if (args[0] === 'push') {
      assert.equal((await vault.config()).name, remoteConfig.name);
      reachedPush = true;
      // The real runner receives an already-aborted signal and cannot spawn Git.
      controller.abort();
    }
    return run(args, options);
  };
  try {
    await assert.rejects(withOperation(controller.signal, () => vault.sync({ push: true })),
      (error: unknown) => error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED');
  } finally {
    vault.git.run = run;
  }
  assert.equal(reachedPush, true);
  assert.equal((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim(), remoteHead);
  await assertRestored(vault, original);
  await assertRetryWorks(vault, remote, remoteConfig.name, local.evidencePath);
});
