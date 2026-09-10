import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { VaultTransaction, recoverTransactions } from '../src/transaction.js';
import { MemoryVault } from '../src/vault.js';

const exec = promisify(execFile);
const roots: string[] = [];
const actor = { id: 'regression', name: 'Transaction regression' };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `memobranch-boundary-${name}-`));
  roots.push(root);
  return root;
}

async function freshVault(): Promise<MemoryVault> {
  const vault = new MemoryVault(await temporary('vault'));
  await vault.initialize('boundary regression');
  return vault;
}

async function precommit(vault: MemoryVault, fail: boolean): Promise<void> {
  const hook = join(vault.git.gitDir, 'hooks', 'pre-commit');
  await writeFile(hook, `#!/bin/sh\nexit ${fail ? 1 : 0}\n`);
  await chmod(hook, 0o755);
}

test('capture commits only its paths and preserves unrelated staged and unstaged content', async () => {
  const vault = await freshVault();
  const original = await vault.git.run(['show', 'HEAD:AGENTS.md']);
  await writeFile(join(vault.root, 'AGENTS.md'), 'unrelated staged instructions\n');
  await vault.git.run(['add', '--', 'AGENTS.md']);
  await writeFile(join(vault.root, 'AGENTS.md'), 'unrelated unstaged instructions\n');
  const capture = await vault.capture({ content: 'Evidence with a scoped commit', extract: false });
  assert.ok(capture.commit);
  assert.equal(await vault.git.run(['show', `${capture.commit}:AGENTS.md`]), original);
  assert.equal(await vault.git.run(['show', ':AGENTS.md']), 'unrelated staged instructions');
  assert.equal(await readFile(join(vault.root, 'AGENTS.md'), 'utf8'), 'unrelated unstaged instructions\n');
  assert.equal(await vault.git.run(['diff', '--cached', '--name-only']), 'AGENTS.md');
  assert.equal(await vault.git.commit('scoped no-op', actor, ['MEMORY.md']), null);
});

test('failed scoped commits retry without consuming unrelated additions or deletions', async () => {
  const vault = await freshVault();
  await writeFile(join(vault.root, 'external.txt'), 'unrelated addition\n');
  await vault.git.run(['add', '--', 'external.txt']);
  await vault.git.run(['rm', '--', 'AGENTS.md']);
  const stagedBefore = await vault.git.run(['diff', '--cached', '--binary']);
  await precommit(vault, true);
  await assert.rejects(vault.capture({ content: 'Recover this capture', extract: false }));
  await precommit(vault, false);
  const recovery = await vault.recover();
  assert.equal(recovery.replayed.length, 1);
  assert.equal(await vault.git.run(['diff', '--cached', '--binary']), stagedBefore);
  assert.equal(await vault.git.run(['ls-tree', '--name-only', 'HEAD', '--', 'external.txt']), '');
  assert.equal(await vault.git.run(['ls-tree', '--name-only', 'HEAD', '--', 'AGENTS.md']), 'AGENTS.md');
});

test('default Git commits tolerate empty managed directories and scoped deletions', async () => {
  const vault = await freshVault();
  await writeFile(join(vault.root, 'log.md'), 'default commit\n');
  assert.ok(await vault.git.commit('default paths include empty directories', actor));
  await writeFile(join(vault.root, 'external.txt'), 'leave staged\n');
  await vault.git.run(['add', '--', 'external.txt']);
  await rm(join(vault.root, 'AGENTS.md'));
  assert.ok(await vault.git.commit('scoped deletion', actor, ['AGENTS.md']));
  assert.equal(await vault.git.run(['ls-tree', '--name-only', 'HEAD', '--', 'AGENTS.md']), '');
  assert.equal(await vault.git.run(['diff', '--cached', '--name-only']), 'external.txt');
});

test('failed sync reconciliation cannot replay a rejected legacy remote config during recovery', async () => {
  const vault = await freshVault();
  const remote = await temporary('remote');
  await exec('git', ['init', '--bare', '--initial-branch=main', remote]);
  await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  await vault.sync({ push: true });
  const clone = join(await temporary('clone'), 'checkout');
  await exec('git', ['clone', remote, clone]);
  await exec('git', ['config', 'user.name', actor.name], { cwd: clone });
  await exec('git', ['config', 'user.email', 'regression@example.invalid'], { cwd: clone });
  const original = await vault.config();
  const legacy = { version: 1, vaultId: original.vaultId, name: 'REJECTED_REMOTE_CONFIG', createdAt: original.createdAt, residentBudget: 9, minimumConfidence: 0.2, minimumProcedureEvidence: 2 };
  await writeFile(join(clone, 'agent-memory.json'), JSON.stringify(legacy));
  await exec('git', ['add', '--', 'agent-memory.json'], { cwd: clone });
  await exec('git', ['commit', '-m', 'legacy remote config needs migration'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  const originalHead = await vault.git.run(['rev-parse', 'HEAD']);
  await precommit(vault, true);
  await assert.rejects(vault.sync({ push: false }), /canonical reconciliation/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), originalHead);
  assert.deepEqual(await vault.config(), original);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'transactions')), []);
  await precommit(vault, false);
  assert.deepEqual(await vault.recover(), { rolledBack: [], replayed: [], commits: [] });
  assert.deepEqual(await vault.config(), original);
  assert.equal((await vault.git.integrity()).dirty, false);
  // A later intentional retry may accept and migrate the same remote revision.
  await vault.sync({ push: false });
  assert.equal((await vault.config()).name, legacy.name);
});

test('a discarded sync journal never restores either remote snapshot during recovery', async () => {
  const vault = await freshVault();
  const original = await readFile(join(vault.root, 'agent-memory.json'), 'utf8');
  const transaction = await VaultTransaction.begin(vault.root, vault.git, actor, 'discarded reconciliation');
  await transaction.write('agent-memory.json', 'rejected desired state');
  const directory = join(vault.root, '.amem', 'transactions');
  const [name] = await readdir(directory);
  const manifest = JSON.parse(await readFile(join(directory, name!), 'utf8'));
  // Retain the durable discard marker to model interruption before unlink.
  manifest.phase = 'discarded';
  manifest.writes['agent-memory.json'].original = 'rejected merged state';
  await writeFile(join(directory, name!), JSON.stringify(manifest));
  await writeFile(join(vault.root, 'agent-memory.json'), original);
  assert.deepEqual(await recoverTransactions(vault.root, vault.git), { rolledBack: [], replayed: [], commits: [] });
  assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), original);
  assert.deepEqual(await readdir(directory), []);
});

test('remote compensation finishes before a later successful writer acquires the lock', async () => {
  const first = await freshVault();
  const old = { name: 'origin', url: join(first.root, 'old'), branch: 'main', push: false };
  await first.configureRemote(old);
  const second = new MemoryVault(first.root);
  let reached!: () => void;
  let release!: () => void;
  const reported = new Promise<void>((resolve) => { reached = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  const record = first.telemetry.record.bind(first.telemetry);
  first.telemetry.record = async (event) => {
    if (event.operation === 'remote_config' && event.outcome === 'error') { reached(); await resume; }
    await record(event);
  };
  const configure = first.git.configureRemote.bind(first.git);
  let fail = true;
  first.git.configureRemote = async (name, url) => {
    await configure(name, url);
    if (fail) { fail = false; throw new Error('failed after updating Git URL'); }
  };
  const failed = assert.rejects(first.configureRemote({ ...old, url: join(first.root, 'first') }), /failed after updating/);
  try {
    await reported;
    assert.equal(await second.git.getRemoteUrl('origin'), old.url);
    const winner = { ...old, name: 'upstream', url: join(first.root, 'winner') };
    await second.configureRemote(winner);
    release();
    await failed;
    assert.deepEqual((await second.config()).remote, winner);
    assert.equal(await second.git.getRemoteUrl('upstream'), winner.url);
    assert.equal(await second.git.getRemoteUrl('origin'), null);
  } finally { release(); }
});

test('remote commit rejection restores config, Git remotes, journal and scoped index', async () => {
  const vault = await freshVault();
  const old = { name: 'origin', url: join(vault.root, 'old'), branch: 'main', push: false };
  await vault.configureRemote(old);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await writeFile(join(vault.root, 'AGENTS.md'), 'unrelated staging\n');
  await vault.git.run(['add', '--', 'AGENTS.md']);
  const staged = await vault.git.run(['diff', '--cached', '--binary']);
  await precommit(vault, true);
  for (const next of [{ ...old, name: 'upstream', url: join(vault.root, 'rejected') }, null]) {
    await assert.rejects(vault.configureRemote(next));
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
    assert.deepEqual((await vault.config()).remote, old);
    assert.equal(await vault.git.getRemoteUrl('origin'), old.url);
    assert.equal(await vault.git.getRemoteUrl('upstream'), null);
    assert.equal(await vault.git.run(['diff', '--cached', '--binary']), staged);
    assert.deepEqual(await readdir(join(vault.root, '.amem', 'transactions')), []);
  }
  await precommit(vault, false);
  await vault.recover();
  assert.deepEqual((await vault.config()).remote, old);
});

test('journal cleanup failure after a remote commit retains the committed configuration', async () => {
  const vault = await freshVault();
  const old = { name: 'origin', url: join(vault.root, 'old'), branch: 'main', push: false };
  await vault.configureRemote(old);
  const next = { ...old, url: join(vault.root, 'committed') };
  const commit = vault.git.commit.bind(vault.git);
  let manifestPath = '';
  let manifest = '';
  vault.git.commit = async (...args) => {
    const result = await commit(...args);
    const directory = join(vault.root, '.amem', 'transactions');
    const [name] = await readdir(directory);
    manifestPath = join(directory, name!);
    manifest = await readFile(manifestPath, 'utf8');
    await rm(manifestPath);
    await mkdir(manifestPath);
    return result;
  };
  await assert.rejects(vault.configureRemote(next));
  assert.deepEqual((await vault.config()).remote, next);
  assert.deepEqual(JSON.parse(await vault.git.run(['show', 'HEAD:agent-memory.json'])).remote, next);
  assert.equal(await vault.git.getRemoteUrl('origin'), next.url);
  vault.git.commit = commit;
  await rm(manifestPath, { recursive: true });
  await writeFile(manifestPath, manifest);
  await vault.recover();
  assert.deepEqual((await vault.config()).remote, next);
  assert.equal(await vault.git.getRemoteUrl('origin'), next.url);
});

test('a failed post-commit HEAD read cannot roll back durable remote configuration', async () => {
  const vault = await freshVault();
  const next = { name: 'origin', url: join(vault.root, 'committed'), branch: 'main', push: false };
  const run = vault.git.run.bind(vault.git);
  let committed = false;
  vault.git.run = async (args, options) => {
    if (committed && args[0] === 'rev-parse') throw new Error('post-commit HEAD read failed');
    const result = await run(args, options);
    if (args[0] === 'commit') committed = true;
    return result;
  };
  await assert.rejects(vault.configureRemote(next), (error: unknown) => error instanceof AgentMemoryError && error.safeDetails?.commitCreated === true);
  vault.git.run = run;
  assert.deepEqual((await vault.config()).remote, next);
  assert.deepEqual(JSON.parse(await vault.git.run(['show', 'HEAD:agent-memory.json'])).remote, next);
  assert.equal(await vault.git.getRemoteUrl('origin'), next.url);
  await vault.recover();
  assert.deepEqual((await vault.config()).remote, next);
});

test('post-commit hook timeout retains the committed remote state', { skip: process.platform === 'win32' }, async () => {
  const vault = await freshVault();
  const next = { name: 'origin', url: join(vault.root, 'committed'), branch: 'main', push: false };
  const hook = join(vault.git.gitDir, 'hooks', 'post-commit');
  await writeFile(hook, '#!/bin/sh\nsleep 2\n');
  await chmod(hook, 0o755);
  const run = vault.git.run.bind(vault.git);
  vault.git.run = (args, options) => run(args, args[0] === 'commit' ? { ...options, timeoutMs: 150 } : options);
  await assert.rejects(vault.configureRemote(next), (error: unknown) => error instanceof AgentMemoryError && error.safeDetails?.commitCreated === true);
  vault.git.run = run;
  await rm(hook);
  assert.deepEqual((await vault.config()).remote, next);
  assert.deepEqual(JSON.parse(await vault.git.run(['show', 'HEAD:agent-memory.json'])).remote, next);
  assert.equal(await vault.git.getRemoteUrl('origin'), next.url);
  await vault.recover();
  assert.deepEqual((await vault.config()).remote, next);
});

test('unknown commit outcome retains aligned configuration and ready recovery without claiming success', async () => {
  const vault = await freshVault();
  const next = { name: 'origin', url: join(vault.root, 'unknown'), branch: 'main', push: false };
  const run = vault.git.run.bind(vault.git);
  let outcomeUnavailable = false;
  vault.git.run = async (args, options) => {
    if (outcomeUnavailable && args[0] === 'rev-parse') throw new Error('outcome probe unavailable');
    const result = await run(args, options);
    if (args[0] === 'commit') {
      outcomeUnavailable = true;
      throw new Error('transport failed after advancing the ref');
    }
    return result;
  };
  await assert.rejects(vault.configureRemote(next), (error: unknown) => error instanceof AgentMemoryError
    && error.safeDetails?.commitOutcomeUnknown === true && error.safeDetails?.commitCreated !== true);
  vault.git.run = run;
  assert.deepEqual((await vault.config()).remote, next);
  assert.deepEqual(JSON.parse(await vault.git.run(['show', 'HEAD:agent-memory.json'])).remote, next);
  assert.equal(await vault.git.getRemoteUrl('origin'), next.url);
  assert.equal((await readdir(join(vault.root, '.amem', 'transactions'))).length, 1);
  await vault.recover();
  assert.deepEqual((await vault.config()).remote, next);
  assert.equal((await readdir(join(vault.root, '.amem', 'transactions'))).length, 0);
});
