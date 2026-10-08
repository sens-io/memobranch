import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { MemoryVault } from '../src/vault.js';

const exec = promisify(execFile);
for (const path of ['.amem/remote-marker.txt', 'unmanaged.txt', 'wiki/attachment.bin', 'wiki/link.md']) {
  test(`sync refuses unsupported remote path before materialization: ${path}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'memobranch-sync-tree-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const vault = new MemoryVault(join(root, 'vault'));
    await vault.initialize('tree boundary');
    const remote = join(root, 'remote.git');
    await exec('git', ['init', '--bare', '--initial-branch=main', remote]);
    await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
    await vault.sync({ push: true });
    const clone = join(root, 'clone');
    await exec('git', ['clone', '--branch', 'main', remote, clone]);
    const target = join(clone, path);
    await mkdir(dirname(target), { recursive: true });
    if (path === 'wiki/link.md') await symlink('../INDEX.md', target);
    else await writeFile(target, 'inert remote fixture\n');
    await exec('git', ['add', '-f', '--', path], { cwd: clone });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'unsupported tree fixture'], { cwd: clone });
    await exec('git', ['push', 'origin', 'main'], { cwd: clone });
    const before = { head: await vault.git.run(['rev-parse', 'HEAD']), config: await readFile(join(vault.root, 'agent-memory.json'), 'utf8') };
    const run = vault.git.run.bind(vault.git);
    let imported = false;
    t.mock.method(vault.git, 'run', async (...[args, options]: Parameters<typeof run>) => {
      if (args[0] === 'merge' && !args.includes('--abort')) imported = true;
      return run(args, options);
    });
    await assert.rejects(vault.sync({ push: false }), error => error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
    assert.equal(imported, false);
    assert.equal(existsSync(join(vault.root, path)), false);
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before.head);
    assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), before.config);
    assert.equal(existsSync(join(vault.root, '.amem', 'sync-intent.json')), false);
  });
}
