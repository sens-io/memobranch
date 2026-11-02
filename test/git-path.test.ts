import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { GitStore } from '../src/git-store.js';
import { recordCommit, withOperation } from '../src/operation.js';

const exec = promisify(execFile);
const mac = { skip: process.platform !== 'darwin' };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch git path '));
  roots.push(root);
  return root;
}
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
async function fakeGit(folder: string, label: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'git'), [
    '#!/bin/sh',
    `printf '%s' ${quote(label)} > ${quote(join(folder, 'ran'))}`,
    `printf '%s' "$PATH" > ${quote(join(folder, 'child-path'))}`,
    `printf '%s\\n' ${quote(label)}`,
    '',
  ].join('\n'), { mode: 0o755 });
}
async function withPath<T>(path: string, action: () => Promise<T>): Promise<T> {
  const prior = process.env.PATH;
  process.env.PATH = path;
  try { return await action(); }
  finally { if (prior === undefined) delete process.env.PATH; else process.env.PATH = prior; }
}

test('macOS Git preserves search priority, permissions and child PATH without a stale selection', mac, async () => {
  const root = await temporaryRoot(), first = join(root, 'first bin'), second = join(root, 'second bin');
  const blocked = join(root, 'not executable');
  await fakeGit(first, 'first'); await fakeGit(second, 'second'); await fakeGit(blocked, 'blocked');
  await chmod(join(blocked, 'git'), 0o644);
  const git = new GitStore(root);
  const path = `${join(root, 'missing')}:${blocked}:${first}:${second}`;
  await withPath(path, async () => {
    assert.equal(await git.run(['--version']), 'first');
    assert.equal(await readFile(join(first, 'child-path'), 'utf8'), path);
    assert.equal(existsSync(join(blocked, 'ran')), false);
  });
  await withPath(`${second}:${first}`, async () => { assert.equal(await git.run(['--version']), 'second'); });
  await chmod(join(first, 'git'), 0o644);
  await withPath(`${first}:${second}`, async () => { assert.equal(await git.run(['--version']), 'second'); });
});

test('macOS Git relative, empty and symlink-parent PATH entries use the child working directory', mac, async () => {
  const root = await temporaryRoot(), git = new GitStore(root);
  await fakeGit(join(root, 'bin'), 'relative');
  await withPath('bin', async () => { assert.equal(await git.run(['--version']), 'relative'); });
  await fakeGit(root, 'empty');
  await withPath(':', async () => { assert.equal(await git.run(['--version']), 'empty'); });
  await mkdir(join(root, 'real', 'nested'), { recursive: true });
  await fakeGit(join(root, 'real', 'bin'), 'symlink-parent');
  await symlink(join(root, 'real', 'nested'), join(root, 'alias'));
  await withPath('alias/../bin', async () => { assert.equal(await git.run(['--version']), 'symlink-parent'); });
});

test('macOS Git delegates search after an executable shim cannot start its missing interpreter', mac, async () => {
  const root = await temporaryRoot(), bad = join(root, 'bad');
  const realGit = (await exec('/bin/sh', ['-c', 'command -v git'])).stdout.trim();
  await mkdir(bad);
  await writeFile(join(bad, 'git'), '#!/memobranch-no-such-interpreter\nexit 99\n', { mode: 0o755 });
  await withPath(`${bad}:${dirname(realGit)}`, async () => { assert.match(await new GitStore(root).run(['--version']), /^git version /); });
});

test('macOS absent Git retains the dependency error even for allowFailure probes', mac, async () => {
  const root = await temporaryRoot();
  await withPath(root, async () => {
    await assert.rejects(new GitStore(root).run(['--version'], { allowFailure: true }),
      (error: unknown) => error instanceof AgentMemoryError && error.code === 'DEPENDENCY_UNAVAILABLE');
  });
});

test('macOS cancellation during executable discovery preserves receipts and reports an unstarted push', mac, async () => {
  const root = await temporaryRoot(), bin = join(root, 'bin'); await fakeGit(bin, 'must-not-run');
  await withPath(bin, async () => {
    const controller = new AbortController();
    const pending = withOperation(controller.signal, () => {
      recordCommit('capture', 'already-committed');
      return new GitStore(root).run(['push'], { signal: controller.signal, allowFailure: true });
    });
    queueMicrotask(() => controller.abort());
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof AgentMemoryError);
      assert.equal(error.code, 'OPERATION_CANCELLED');
      assert.equal(error.safeDetails?.pushNotStarted, true);
      assert.deepEqual(error.safeDetails?.committed, [{ operation: 'capture', commit: 'already-committed' }]);
      return true;
    });
    await delay(20);
    assert.equal(existsSync(join(bin, 'ran')), false);
  });
});

test('macOS executable discovery consumes the existing total Git deadline without a late push', mac, async () => {
  const root = await temporaryRoot(), bin = join(root, 'bin'); await fakeGit(bin, 'must-not-run');
  const path = [...Array.from({ length: 1000 }, (_, index) => join(root, `missing-${index}`)), bin].join(':');
  await withPath(path, async () => {
    await assert.rejects(new GitStore(root).run(['push'], { timeoutMs: 1 }), (error: unknown) => {
      assert.ok(error instanceof AgentMemoryError);
      assert.equal(error.safeDetails?.timedOut, true);
      assert.equal(error.safeDetails?.timeoutMs, 1);
      assert.equal(error.safeDetails?.pushNotStarted, true);
      return true;
    });
    await delay(20);
    assert.equal(existsSync(join(bin, 'ran')), false);
  });
});

test('macOS Git never retries an executed command that exits unsuccessfully', mac, async () => {
  const root = await temporaryRoot();
  await writeFile(join(root, 'git'), ['#!/bin/sh', `printf x >> ${quote(join(root, 'calls'))}`, 'echo "ENOENT after execution" >&2', 'exit 2', ''].join('\n'), { mode: 0o755 });
  await withPath(root, async () => {
    await assert.rejects(new GitStore(root).run(['push']),
      (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_TRANSPORT');
    assert.equal(await readFile(join(root, 'calls'), 'utf8'), 'x');
  });
});

test('Git retains invocation arguments when the caller reuses its array', { skip: process.platform === 'win32' }, async () => {
  const root = await temporaryRoot();
  await writeFile(join(root, 'git'), '#!/bin/sh\nprintf "%s\\n" "$1"\n', { mode: 0o755 });
  await withPath(root, async () => {
    const args = ['--version'];
    const pending = new GitStore(root).run(args);
    args[0] = 'push';
    assert.equal(await pending, '--version');
  });
});
