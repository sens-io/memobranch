import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function snapshot(vault: MemoryVault) {
  return {
    head: await vault.git.run(['rev-parse', 'HEAD']),
    config: await readFile(join(vault.root, 'agent-memory.json'), 'utf8'),
    log: await readFile(join(vault.root, 'log.md'), 'utf8'),
    remotes: await vault.git.run(['remote', '-v']),
    staged: await vault.git.run(['diff', '--cached', '--binary']),
    unstaged: await vault.git.run(['diff', '--binary']),
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-remote-recovery-'));
  roots.push(root);
  const vault = new MemoryVault(root);
  await vault.initialize('remote configuration recovery');
  const old = { name: 'origin', url: join(root, 'original-remote'), branch: 'main', push: false };
  await vault.configureRemote(old);
  await writeFile(join(root, 'AGENTS.md'), 'unrelated staged instructions\n');
  await vault.git.run(['add', '--', 'AGENTS.md']);
  await writeFile(join(root, 'AGENTS.md'), 'unrelated unstaged instructions\n');
  return { vault, old, original: await snapshot(vault), journals: join(root, '.amem', 'transactions') };
}

async function rejectCommit(vault: MemoryVault): Promise<string> {
  const hook = join(vault.git.gitDir, 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  return hook;
}

for (const mode of ['change URL', 'rename remote', 'remove remote'] as const) {
  test(`a real reset lock during rejected ${mode} retains complete recovery work across restart`, async () => {
    const { vault, old, original, journals } = await fixture();
    const hook = await rejectCommit(vault);
    const lock = join(vault.git.gitDir, 'index.lock');
    const run = vault.git.run.bind(vault.git);
    vault.git.run = async (args, options) => {
      if (args[0] === 'reset' && !existsSync(lock)) await writeFile(lock, 'real conflicting index lock\n');
      return run(args, options);
    };
    const next = mode === 'remove remote' ? null
      : { ...old, name: mode === 'rename remote' ? 'upstream' : old.name, url: join(vault.root, 'rejected-remote') };
    await assert.rejects(vault.configureRemote(next));
    assert.equal(existsSync(lock), true, 'actual Git must encounter the conflicting index lock');
    assert.equal((await readdir(journals)).length, 1, 'unfinished rollback must keep its durable journal');
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), original.head);
    await rm(lock);
    await rm(hook);

    const restarted = new MemoryVault(vault.root);
    const recovered = await restarted.recover();
    assert.equal(recovered.rolledBack.length, 1);
    assert.deepEqual(await snapshot(restarted), original, 'HEAD, JSON, Git remotes and unrelated staging must all be restored');
    assert.deepEqual(await readdir(journals), []);
    assert.deepEqual(await restarted.recover(), { rolledBack: [], replayed: [], commits: [] });
    assert.deepEqual(await snapshot(restarted), original);
    const winner = { ...old, url: join(vault.root, 'later-successful-remote') };
    await restarted.configureRemote(winner);
    assert.deepEqual((await restarted.config()).remote, winner);
    assert.equal(await restarted.git.getRemoteUrl(old.name), winner.url);
    assert.equal(await restarted.git.run(['diff', '--cached', '--binary']), original.staged);
  });
}

for (const phase of ['after remote mutation', 'during commit rollback'] as const) {
  test(`a real Git config lock ${phase} cannot lose remote compensation on restart`, async () => {
    const { vault, old, original, journals } = await fixture();
    const lock = join(vault.git.gitDir, 'config.lock');
    const hook = phase === 'during commit rollback' ? await rejectCommit(vault) : null;
    const next = { ...old, url: join(vault.root, 'rejected-remote') };
    const run = vault.git.run.bind(vault.git);
    let changed = false;
    vault.git.run = async (args, options) => {
      const result = await run(args, options);
      if (!changed && args[0] === 'remote' && args[1] === 'set-url' && args.at(-1) === next.url) {
        changed = true;
        await writeFile(lock, 'real conflicting Git config lock\n');
        if (phase === 'after remote mutation') throw new Error('interruption after Git remote mutation');
      }
      return result;
    };
    await assert.rejects(vault.configureRemote(next));
    assert.equal(changed, true);
    assert.equal((await readdir(journals)).length, 1, 'remote compensation must be part of durable recovery');
    const pending = new MemoryVault(vault.root);
    await assert.rejects(pending.capture({ content: 'blocked until compensation succeeds', extract: false }));
    assert.equal(await pending.git.run(['rev-parse', 'HEAD']), original.head);
    assert.equal((await readdir(journals)).length, 1);
    await rm(lock);
    if (hook) await rm(hook);

    const restarted = new MemoryVault(vault.root);
    await restarted.recover();
    assert.deepEqual(await snapshot(restarted), original);
    assert.deepEqual(await readdir(journals), []);
    await restarted.configureRemote({ ...old, url: join(vault.root, 'successful-retry') });
    assert.equal(await restarted.git.getRemoteUrl(old.name), join(vault.root, 'successful-retry'));
    assert.equal(await restarted.git.run(['diff', '--cached', '--binary']), original.staged);
  });
}
