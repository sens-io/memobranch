import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { GitStore, type GitRunOptions } from '../src/git-store.js';
import { cancellationError, recordCommit, withOperation } from '../src/operation.js';
import { withFileLock } from '../src/utils.js';

const exec = promisify(execFile);
const roots: string[] = [];
const fixture = fileURLToPath(new URL('./fixtures/slow-git-helper.cjs', import.meta.url));
const actor = { id: 'test', name: 'Git cancellation test' };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function freshGit(): Promise<GitStore> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-git-cancel-'));
  roots.push(root);
  const git = new GitStore(root);
  await git.initialize();
  await writeFile(join(root, 'MEMORY.md'), 'initial\n');
  await git.commit('initial', actor);
  return git;
}

function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function helperCommand(root: string): string { return `${quote(process.execPath)} ${quote(fixture)} parent ${quote(root)}`; }
function slowArgs(root: string): string[] { return ['-c', `alias.pause=!${helperCommand(root)}`, 'pause']; }
function cancelled(error: unknown): boolean { return error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED'; }

async function waitForHelper(root: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!existsSync(join(root, 'helper.pid'))) {
    if (Date.now() > deadline) throw new Error('Git helper did not become ready');
    await delay(10);
  }
}

async function assertHelperStopped(root: string): Promise<void> {
  const pid = Number(await readFile(join(root, 'helper.pid'), 'utf8'));
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw error;
  }
  // On Linux an orphan can remain a zombie until init reaps it. It cannot run.
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      assert.match(stat, /\) Z /, 'helper must have stopped before releasing the vault lock');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
  assert.fail('helper must have stopped before releasing the vault lock');
}

test('pre-cancelled Git calls and initialization do no work, including allowFailure probes', async () => {
  const git = await freshGit();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(git.run(['config', 'cancelled.was-run', 'yes'], { signal: controller.signal, allowFailure: true }), cancelled);
  assert.equal(await git.run(['config', '--get', 'cancelled.was-run'], { allowFailure: true }), '');
  const emptyRoot = await mkdtemp(join(tmpdir(), 'memobranch-git-preabort-'));
  roots.push(emptyRoot);
  await assert.rejects(withOperation(controller.signal, () => new GitStore(emptyRoot).initialize()), cancelled);
  assert.equal(existsSync(join(emptyRoot, '.amem')), false);
});

test('cancellation stops Git and a TERM-resistant helper before releasing the writer lock', { skip: process.platform === 'win32' }, async () => {
  const git = await freshGit();
  const controller = new AbortController();
  const lock = join(git.root, '.amem', 'write.lock');
  const pending = withOperation(controller.signal, () => {
    recordCommit('capture', 'already-committed');
    return withFileLock(lock, () => git.run(slowArgs(git.root), { allowFailure: true }));
  });
  const rejection = assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof AgentMemoryError);
    assert.equal(error.code, 'OPERATION_CANCELLED');
    assert.deepEqual(error.safeDetails?.committed, [{ operation: 'capture', commit: 'already-committed' }]);
    return true;
  });
  await waitForHelper(git.root);
  const started = Date.now();
  controller.abort();
  await rejection;
  assert.ok(Date.now() - started < 1_500, 'cancellation must finish promptly');
  await withFileLock(lock, () => assertHelperStopped(git.root));
  assert.equal(await readFile(join(git.root, 'prompt-setting'), 'utf8'), '0');
  // The child ignored TERM and closed stdio; killing only Git would fail here.
  await delay(750);
  assert.equal(existsSync(join(git.root, 'late-write')), false);
  await writeFile(join(git.root, 'MEMORY.md'), 'after cancellation\n');
  assert.ok(await git.commit('healthy after cancellation', actor));
  assert.equal((await git.integrity()).healthy, true);
});

test('SSH fetch timeout kills transport descendants and cannot be swallowed by allowFailure', { skip: process.platform === 'win32' }, async () => {
  const git = await freshGit();
  await git.configureRemote('origin', 'ssh://example.invalid/memory.git');
  const originalCommand = process.env.GIT_SSH_COMMAND;
  const originalVariant = process.env.GIT_SSH_VARIANT;
  process.env.GIT_SSH_COMMAND = helperCommand(git.root);
  process.env.GIT_SSH_VARIANT = 'ssh';
  try {
    const started = Date.now();
    const pending = git.run(['fetch', 'origin'], { timeoutMs: 400, allowFailure: true });
    const rejection = assert.rejects(pending, (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_TRANSPORT' && error.safeDetails?.timedOut === true);
    await waitForHelper(git.root);
    await rejection;
    assert.ok(Date.now() - started < 1_500, 'timeout must bound transport execution');
    await assertHelperStopped(git.root);
    await delay(750);
    assert.equal(existsSync(join(git.root, 'late-write')), false);
    assert.equal((await git.integrity()).healthy, true);
  } finally {
    if (originalCommand === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = originalCommand;
    if (originalVariant === undefined) delete process.env.GIT_SSH_VARIANT; else process.env.GIT_SSH_VARIANT = originalVariant;
  }
});

test('Git timeout configuration validates finite bounds and honors the environment', { skip: process.platform === 'win32' }, async () => {
  const git = await freshGit();
  for (const timeoutMs of [0, -1, NaN, Infinity, 300_001, 1.1]) {
    await assert.rejects(git.run(['status'], { timeoutMs, allowFailure: true }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'CONFIG_INVALID');
  }
  const previous = process.env.AMEM_GIT_TIMEOUT_MS;
  process.env.AMEM_GIT_TIMEOUT_MS = '200';
  try {
    await assert.rejects(git.run(slowArgs(git.root), { allowFailure: true }), (error: unknown) => error instanceof AgentMemoryError && error.safeDetails?.timeoutMs === 200);
  } finally {
    if (previous === undefined) delete process.env.AMEM_GIT_TIMEOUT_MS; else process.env.AMEM_GIT_TIMEOUT_MS = previous;
  }
});

test('cancellation after merging restores the original local commit and worktree', async () => {
  const local = await freshGit();
  const remote = await freshGit();
  // GitStore uses a separate metadata directory: point local transports at it.
  await remote.configureRemote('source', local.gitDir);
  await remote.run(['fetch', 'source']);
  await remote.run(['reset', '--hard', 'source/main']);
  await writeFile(join(remote.root, 'MEMORY.md'), 'remote update\n');
  await remote.commit('remote update', actor);
  await local.configureRemote('origin', remote.gitDir);
  const originalHead = await local.run(['rev-parse', 'HEAD']);
  const controller = new AbortController();
  await assert.rejects(withOperation(controller.signal, () => local.sync('origin', 'main', {
    reconcile: async () => { controller.abort(); },
  })), cancelled);
  assert.equal(await local.run(['rev-parse', 'HEAD']), originalHead);
  assert.equal(await readFile(join(local.root, 'MEMORY.md'), 'utf8'), 'initial\n');
  assert.equal((await local.integrity()).dirty, false);
  assert.equal(existsSync(join(local.root, '.amem', 'sync-state.json')), false);
});

test('a successful push followed by cancellation retains HEAD and returns pushed success', async () => {
  const base = await freshGit();
  const remoteRoot = await mkdtemp(join(tmpdir(), 'memobranch-push-target-'));
  roots.push(remoteRoot);
  await exec('git', ['init', '--bare', remoteRoot]);
  await base.configureRemote('origin', remoteRoot);
  const controller = new AbortController();
  class AbortAfterPushGit extends GitStore {
    override async run(args: string[], options: GitRunOptions = {}): Promise<string> {
      const result = await super.run(args, options);
      if (args[0] === 'push') controller.abort();
      return result;
    }
  }
  const git = new AbortAfterPushGit(base.root);
  const originalHead = await git.run(['rev-parse', 'HEAD']);
  const result = await withOperation(controller.signal, () => git.sync('origin', 'main', { push: true }));
  assert.equal(result.pushed, true);
  assert.equal(result.head, originalHead);
  assert.equal(result.ahead, 0);
  assert.equal(await git.run(['rev-parse', 'HEAD']), originalHead);
  assert.equal((await exec('git', ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/main'])).stdout.trim(), originalHead);
  assert.ok(result.lastSuccessfulSync);
});

test('a successful push stays committed when a retained helper pipe reaches the Git timeout', { skip: process.platform === 'win32' }, async () => {
  const base = await freshGit();
  const other = await freshGit();
  const remoteRoot = await mkdtemp(join(tmpdir(), 'memobranch-completed-push-'));
  const shimRoot = await mkdtemp(join(tmpdir(), 'memobranch-git-shim-'));
  roots.push(remoteRoot, shimRoot);
  await exec('git', ['init', '--bare', remoteRoot]);
  await base.configureRemote('origin', remoteRoot);
  await base.sync('origin', 'main', { push: true });
  const originalHead = await base.run(['rev-parse', 'HEAD']);
  await other.configureRemote('origin', remoteRoot);
  await other.run(['fetch', 'origin']);
  await other.run(['reset', '--hard', 'origin/main']);
  await writeFile(join(other.root, 'MEMORY.md'), 'remote change\n');
  await other.commit('remote change', actor);
  await other.sync('origin', 'main', { push: true });

  const realGit = (await exec('/bin/sh', ['-c', 'command -v git'])).stdout.trim();
  const retainedHelper = fileURLToPath(new URL('./fixtures/completed-git-helper.cjs', import.meta.url));
  await writeFile(join(shimRoot, 'git'), [
    '#!/bin/sh',
    `${quote(realGit)} "$@"`,
    'status=$?',
    'if [ "$1" = push ] && [ "$status" = 0 ]; then',
    `  ${quote(process.execPath)} ${quote(retainedHelper)} parent ${quote(shimRoot)}`,
    'fi',
    'exit "$status"',
    '',
  ].join('\n'), { mode: 0o755 });
  class ShortPushDeadlineGit extends GitStore {
    override async run(args: string[], options: GitRunOptions = {}): Promise<string> {
      return super.run(args, args[0] === 'push' ? { ...options, timeoutMs: 2_000 } : options);
    }
  }
  const git = new ShortPushDeadlineGit(base.root);
  const previousPath = process.env.PATH;
  let pushedHead: string | null = null;
  let result: Awaited<ReturnType<GitStore['sync']>> | undefined;
  let receipts: unknown;
  let failure: unknown;
  process.env.PATH = `${shimRoot}:${previousPath ?? ''}`;
  try {
    result = await withOperation(new AbortController().signal, async () => {
      const status = await git.sync('origin', 'main', {
        push: true,
        reconcile: async () => {
          await writeFile(join(git.root, 'MEMORY.md'), 'reconciled remote change\n');
          pushedHead = await git.commit('reconcile remote', actor);
        },
      });
      receipts = cancellationError().safeDetails?.committed;
      return status;
    });
  } catch (error) {
    failure = error;
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
  }
  assert.ok(pushedHead);
  assert.notEqual(pushedHead, originalHead);
  const remoteHead = (await exec(realGit, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/main'])).stdout.trim();
  assert.equal(remoteHead, pushedHead, 'the real remote must have accepted the reconciled commit');
  assert.equal(await git.run(['rev-parse', 'HEAD']), pushedHead, 'cleanup timeout must not roll local HEAD back after a confirmed push');
  assert.equal(failure, undefined);
  assert.equal(result?.pushed, true);
  assert.equal(result?.merged, true);
  assert.equal(result?.head, pushedHead);
  assert.deepEqual(receipts, [{ operation: 'remote_sync', commit: pushedHead }]);
  await assertHelperStopped(shimRoot);
  await delay(1_100);
  assert.equal(existsSync(join(shimRoot, 'late-write')), false);
  assert.equal((await git.integrity()).dirty, false);
});
