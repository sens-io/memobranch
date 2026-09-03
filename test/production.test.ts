import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import type { EncryptedEnvelopeMeta } from '../src/encryption.js';
import { MaintenanceService } from '../src/maintenance.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import type { Principal } from '../src/policy.js';
import { VaultTransaction } from '../src/transaction.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';

const exec = promisify(execFile);
const roots: string[] = [];
const masterKey = '42'.repeat(32);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshVault(options: ConstructorParameters<typeof MemoryVault>[1] = {}): Promise<MemoryVault> {
  const root = await mkdtemp(join(tmpdir(), 'amem-production-'));
  roots.push(root);
  const vault = new MemoryVault(root, options);
  await vault.initialize('production-test');
  return vault;
}

test('version 1 config migrates transactionally and future versions fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amem-migration-'));
  roots.push(root);
  await mkdir(join(root, 'wiki'), { recursive: true });
  await Promise.all(['evidence', 'candidates'].map((name) => mkdir(join(root, name), { recursive: true })));
  const legacy = { version: 1, vaultId: 'legacy-vault', name: 'legacy', createdAt: new Date().toISOString(), residentBudget: 12, minimumConfidence: 0.8, minimumProcedureEvidence: 3 };
  await writeFile(join(root, 'agent-memory.json'), `${JSON.stringify(legacy, null, 2)}\n`);
  const vault = new MemoryVault(root);
  const migrated = await vault.migrate();
  assert.equal(migrated.migrated, true);
  assert.equal((await vault.config()).version, 2);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'agent-memory.json.v1.bak'), 'utf8')), legacy);
  assert.match((await vault.history())[0]?.subject ?? '', /migrate/);

  const config = await vault.config() as unknown as Record<string, unknown>;
  config.version = 99;
  await writeFile(join(root, 'agent-memory.json'), `${JSON.stringify(config)}\n`);
  const report = await vault.doctor();
  assert.equal(report.healthy, false);
  assert.equal(report.configVersion, 99);
  await assert.rejects(vault.recover(), (error: unknown) => error instanceof AgentMemoryError && error.code === 'CONFIG_VERSION_UNSUPPORTED');
  await assert.rejects(vault.capture({ content: 'must not write' }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'CONFIG_VERSION_UNSUPPORTED');
});

test('missing Git dependency fails before initialization claims success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amem-no-git-'));
  roots.push(root);
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    await assert.rejects(new MemoryVault(root).initialize('no-git'), (error: unknown) => error instanceof AgentMemoryError && error.code === 'DEPENDENCY_UNAVAILABLE');
    assert.equal(existsSync(join(root, 'agent-memory.json')), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('policy rejects unauthorized scope without a managed or Git change', async () => {
  const admin = await freshVault();
  const config = await admin.config();
  const principal: Principal = { id: 'limited', name: 'Limited writer', permissions: ['write'], scopes: ['user'], maxSensitivity: 'internal', tenantId: config.tenantId };
  const vault = new MemoryVault(admin.root, { principal });
  const before = await admin.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.propose({ kind: 'fact', key: 'team-only', statement: 'should not persist', scope: 'team', sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [] }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED');
  assert.equal(await admin.git.run(['rev-parse', 'HEAD']), before);
  assert.equal((await readdir(join(admin.root, 'candidates'))).length, 0);
});

test('authorization filters secret graph neighbors before expansion and snippets', async () => {
  const admin = await freshVault({ masterKey });
  const config = await admin.config();
  await admin.propose({ kind: 'fact', key: 'graph secret', statement: 'NEBULA SECRET PAYLOAD', scope: 'project', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [] });
  await admin.consolidate();
  const [secret] = await admin.search('NEBULA SECRET PAYLOAD', { includeSecret: true });
  assert.ok(secret);
  const publicDirectory = join(admin.root, 'wiki', 'public', 'fact');
  await mkdir(publicDirectory, { recursive: true });
  const timestamp = new Date().toISOString();
  await writeFile(join(publicDirectory, 'bridge.md'), serializeMarkdown({ id: 'public-bridge', type: 'memory', createdAt: timestamp, updatedAt: timestamp, validatedAt: timestamp, kind: 'fact', key: 'public bridge', scope: 'public', sensitivity: 'public', confidence: 1, status: 'active', evidence: [], conditions: [], tags: [], revision: 1 }, `# public bridge\n\nPublic information. See [restricted neighbor](/${secret.path}).`));
  const restricted: Principal = { id: 'reader', name: 'Public reader', permissions: ['read'], scopes: ['public'], maxSensitivity: 'internal', tenantId: config.tenantId };
  const reader = new MemoryVault(admin.root, { principal: restricted });
  const bridge = await reader.search('public bridge', { includeSecret: true, expandLinks: true });
  assert.deepEqual(bridge.map((hit) => hit.id), ['public-bridge']);
  assert.equal((await reader.search('NEBULA SECRET PAYLOAD', { includeSecret: true })).length, 0);
  assert.doesNotMatch(JSON.stringify(bridge), /NEBULA SECRET PAYLOAD/);
});

test('confidential records fail closed, avoid plaintext artifacts, and support cryptographic erasure', async () => {
  const noKey = await freshVault();
  const noKeyHead = await noKey.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(noKey.propose({ kind: 'fact', key: 'secret', statement: 'SILVER ORCHID', scope: 'user', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [] }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'ENCRYPTION_KEY_UNAVAILABLE');
  assert.equal(await noKey.git.run(['rev-parse', 'HEAD']), noKeyHead);

  const vault = await freshVault({ masterKey });
  await vault.capture({ content: 'TOPAZ EVIDENCE BODY', sourceUri: 'https://private.example/TOPAZ-SOURCE', scope: 'project', sensitivity: 'secret' });
  const candidate = await vault.propose({ kind: 'fact', key: 'private codename', statement: 'SILVER ORCHID', scope: 'project', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: ['private'] });
  await vault.consolidate();
  const [hit] = await vault.search('SILVER ORCHID', { includeSecret: true });
  assert.ok(hit);
  const artifacts = await collectText(vault.root, ['wiki', 'candidates', 'MEMORY.md', 'INDEX.md', 'log.md', '.amem/search-index.json', '.amem/audit.jsonl', '.amem/metrics.json']);
  assert.doesNotMatch(artifacts, /SILVER ORCHID/);
  assert.doesNotMatch(artifacts, /TOPAZ EVIDENCE BODY|TOPAZ-SOURCE/);
  assert.doesNotMatch(await vault.git.run(['log', '-p', '--all']), /SILVER ORCHID/);
  const encryptedPath = join(vault.root, hit.path);
  const encryptedRaw = await readFile(encryptedPath, 'utf8');
  await writeFile(encryptedPath, encryptedRaw.replace('sensitivity: secret', 'sensitivity: public'));
  await assert.rejects(vault.get(hit.id), (error: unknown) => error instanceof AgentMemoryError && error.code === 'ENCRYPTION_FAILED');
  await writeFile(encryptedPath, encryptedRaw);
  const erased = await vault.erase(hit.id, 'operator confirmed erasure');
  assert.equal(erased.keyErased, true);
  assert.equal(await vault.encryption.hasKey(hit.id), false);
  const historical = parseMarkdown<Record<string, unknown>>(encryptedRaw);
  await assert.rejects(vault.encryption.decrypt(historical.meta as EncryptedEnvelopeMeta, historical.body), (error: unknown) => error instanceof AgentMemoryError && error.code === 'ENCRYPTION_KEY_UNAVAILABLE');
  const audit = await readFile(join(vault.root, '.amem', 'audit.jsonl'), 'utf8');
  assert.match(audit, new RegExp(hit.id));
  assert.doesNotMatch(audit, /SILVER ORCHID/);
  assert.equal((await vault.search('SILVER ORCHID', { includeSecret: true })).length, 0);
  await assert.rejects(vault.get(hit.id), (error: unknown) => error instanceof AgentMemoryError && error.code === 'NOT_FOUND');
  assert.ok(candidate.id);
});

test('transaction recovery rolls back writing state and replays ready state', async () => {
  const vault = await freshVault();
  const original = await readFile(join(vault.root, 'log.md'), 'utf8');
  const writing = await VaultTransaction.begin(vault.root, vault.git, { id: 'crash', name: 'Crash test' }, 'test: rollback');
  await writing.write('log.md', 'partial state\n');
  assert.equal(await readFile(join(vault.root, 'log.md'), 'utf8'), 'partial state\n');
  const rolledBack = await vault.recover();
  assert.equal(rolledBack.rolledBack.length, 1);
  assert.equal(await readFile(join(vault.root, 'log.md'), 'utf8'), original);

  const ready = await VaultTransaction.begin(vault.root, vault.git, { id: 'crash', name: 'Crash test' }, 'test: replay');
  await ready.write('log.md', `${original}\nreplayed\n`);
  const transactionDirectory = join(vault.root, '.amem', 'transactions');
  const [manifestName] = (await readdir(transactionDirectory)).filter((name) => name.endsWith('.json'));
  assert.ok(manifestName);
  const manifestPath = join(transactionDirectory, manifestName);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.phase = 'ready';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const replayed = await vault.recover();
  assert.equal(replayed.replayed.length, 1);
  assert.match(await readFile(join(vault.root, 'log.md'), 'utf8'), /replayed/);
  assert.match((await vault.history())[0]?.subject ?? '', /replay/);
  assert.match(await readFile(join(vault.root, '.amem', 'audit.jsonl'), 'utf8'), /"operation":"recover"/);
});

test('writer lock rejects a live owner and recovers a stale owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amem-lock-'));
  roots.push(root);
  const lock = join(root, 'write.lock');
  const handle = await open(lock, 'wx');
  await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
  await handle.close();
  await assert.rejects(withFileLock(lock, async () => undefined, 60), (error: unknown) => error instanceof AgentMemoryError && error.code === 'LOCK_TIMEOUT');
  await writeFile(lock, `99999999\n2000-01-01T00:00:00.000Z\n`);
  let entered = false;
  await withFileLock(lock, async () => { entered = true; }, 100);
  assert.equal(entered, true);
});

test('persistent index rebuilds corruption, remains incremental, and supports CJK lexical fallback', async () => {
  const vault = await freshVault();
  await vault.propose({ kind: 'preference', key: '回答语言', statement: '用户喜欢简洁的中文回答。', scope: 'user', sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: ['中文'] });
  await vault.consolidate();
  assert.equal((await vault.search('中文回答')).length, 1);
  assert.equal((await vault.reindex()).updated, 0);
  await writeFile(join(vault.root, '.amem', 'search-index.json'), '{corrupt');
  assert.equal((await vault.doctor()).index?.healthy, false);
  const rebuilt = await vault.reindex();
  assert.equal(rebuilt.documents, 1);
  assert.equal(rebuilt.updated, 1);
  const metrics = JSON.parse(await readFile(join(vault.root, '.amem', 'metrics.json'), 'utf8')) as { counters: Record<string, number> };
  assert.ok((metrics.counters.index_rebuilds ?? 0) >= 1);

  const configPath = join(vault.root, 'agent-memory.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { index: { embeddingModel: string | null } };
  config.index.embeddingModel = 'unavailable-test-model';
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  assert.equal((await vault.reindex(true)).semanticStatus, 'degraded');
  const degraded = await vault.searchDetailed('中文', { semantic: true });
  assert.equal(degraded.semanticStatus, 'degraded');
  assert.equal(degraded.hits.length, 1);
});

test('persistent lexical index remains bounded on a representative corpus', async () => {
  const vault = await freshVault();
  const directory = join(vault.root, 'wiki', 'project', 'fact');
  await mkdir(directory, { recursive: true });
  const started = performance.now();
  await Promise.all(Array.from({ length: 1_000 }, async (_, index) => {
    const timestamp = new Date().toISOString();
    const meta = { id: `perf-${index}`, type: 'memory', createdAt: timestamp, updatedAt: timestamp, validatedAt: timestamp, kind: 'fact', key: `item ${index}`, scope: 'project', sensitivity: 'internal', confidence: 1, status: 'active', evidence: [], conditions: [], tags: ['performance'], revision: 1 };
    await writeFile(join(directory, `item-${index}.md`), serializeMarkdown(meta, `# item ${index}\n\nRepresentative searchable payload number ${index}.`));
  }));
  const result = await vault.reindex();
  const elapsed = performance.now() - started;
  assert.equal(result.documents, 1_000);
  assert.ok(elapsed < 15_000, `indexing took ${elapsed}ms`);
  const indexPath = join(vault.root, '.amem', 'search-index.json');
  const indexModifiedAt = (await stat(indexPath)).mtimeMs;
  const queryStarted = performance.now();
  assert.equal((await vault.search('payload number 777'))[0]?.id, 'perf-777');
  const queryElapsed = performance.now() - queryStarted;
  assert.ok(queryElapsed < 3_000, `hot query took ${queryElapsed}ms`);
  assert.equal((await stat(indexPath)).mtimeMs, indexModifiedAt, 'an unchanged hot query must not rewrite the index');
  const before = JSON.parse(await readFile(indexPath, 'utf8')) as { documents: Array<{ id: string; contentHash: string }> };
  const unchangedHash = before.documents.find((document) => document.id === 'perf-1')?.contentHash;
  const changedRaw = await readFile(join(directory, 'item-777.md'), 'utf8');
  await writeFile(join(directory, 'item-777.md'), changedRaw.replace('Representative searchable payload', 'Updated representative searchable payload'));
  const incremental = await vault.reindex();
  const after = JSON.parse(await readFile(indexPath, 'utf8')) as { documents: Array<{ id: string; contentHash: string }> };
  assert.equal(incremental.updated, 1);
  assert.equal(after.documents.find((document) => document.id === 'perf-1')?.contentHash, unchangedHash);
});

test('remote Git pushes, pulls fast-forward, reports divergence, and aborts conflicts', async () => {
  const remote = await mkdtemp(join(tmpdir(), 'amem-remote-'));
  const clone = await mkdtemp(join(tmpdir(), 'amem-clone-'));
  roots.push(remote, clone);
  await exec('git', ['init', '--bare', remote]);
  const vault = await freshVault();
  await assert.rejects(vault.configureRemote({ name: 'origin', url: 'https://user:secret-token@example.test/vault.git', branch: 'main', push: false }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_INVALID');
  assert.doesNotMatch(await readFile(join(vault.root, '.amem', 'audit.jsonl'), 'utf8'), /secret-token/);
  await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: true });
  const firstSync = await vault.sync();
  assert.equal(firstSync.pushed, true);
  assert.ok(firstSync.lastSuccessfulSync);

  await rm(clone, { recursive: true, force: true });
  await exec('git', ['clone', remote, clone]);
  await git(clone, ['config', 'user.name', 'Remote tester']);
  await git(clone, ['config', 'user.email', 'remote@example.test']);
  await writeFile(join(clone, 'log.md'), `${await readFile(join(clone, 'log.md'), 'utf8')}\nremote update\n`);
  const remoteWiki = join(clone, 'wiki', 'project', 'fact');
  await mkdir(remoteWiki, { recursive: true });
  const timestamp = new Date().toISOString();
  await writeFile(join(remoteWiki, 'remote-memory.md'), serializeMarkdown({ id: 'remote-memory', type: 'memory', createdAt: timestamp, updatedAt: timestamp, validatedAt: timestamp, kind: 'fact', key: 'remote searchable memory', scope: 'project', sensitivity: 'internal', confidence: 1, status: 'active', evidence: [], conditions: [], tags: ['remote'], revision: 1 }, '# remote searchable memory\n\nPulled through the shadow Git repository.'));
  await git(clone, ['add', 'log.md', 'wiki/project/fact/remote-memory.md']);
  await git(clone, ['commit', '-m', 'remote: update log']);
  await git(clone, ['push', 'origin', 'main']);
  assert.equal((await vault.remoteStatus()).behind, 1);
  assert.equal((await vault.sync()).merged, true);
  assert.match(await readFile(join(vault.root, 'log.md'), 'utf8'), /remote update/);
  assert.equal((await vault.search('shadow Git repository'))[0]?.id, 'remote-memory');
  await git(clone, ['pull', '--ff-only']);

  const localConfigPath = join(vault.root, 'agent-memory.json');
  const localConfig = JSON.parse(await readFile(localConfigPath, 'utf8')) as { name: string };
  localConfig.name = 'local-name';
  await writeFile(localConfigPath, `${JSON.stringify(localConfig, null, 2)}\n`);
  await vault.git.commit('local: rename vault', { id: 'local', name: 'Local tester' });
  const remoteConfigPath = join(clone, 'agent-memory.json');
  const remoteConfig = JSON.parse(await readFile(remoteConfigPath, 'utf8')) as { name: string };
  remoteConfig.name = 'remote-name';
  await writeFile(remoteConfigPath, `${JSON.stringify(remoteConfig, null, 2)}\n`);
  await git(clone, ['add', 'agent-memory.json']);
  await git(clone, ['commit', '-m', 'remote: rename vault']);
  await git(clone, ['push', 'origin', 'main']);
  const status = await vault.remoteStatus();
  assert.equal(status.diverged, true);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.sync(), (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal((JSON.parse(await readFile(localConfigPath, 'utf8')) as { name: string }).name, 'local-name');
});

test('transport failures are redacted and preserve local history', async () => {
  const vault = await freshVault();
  const missingRemote = join(tmpdir(), `missing-amem-remote-${Date.now()}`);
  await vault.configureRemote({ name: 'origin', url: missingRemote, branch: 'main', push: false });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const config = await readFile(join(vault.root, 'agent-memory.json'), 'utf8');
  await assert.rejects(vault.sync(), (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_TRANSPORT' && !error.message.includes('secret'));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(await readFile(join(vault.root, 'agent-memory.json'), 'utf8'), config);
});

test('Git corruption is unhealthy and disables synchronization', async () => {
  const remote = await mkdtemp(join(tmpdir(), 'amem-corrupt-remote-'));
  roots.push(remote);
  await exec('git', ['init', '--bare', remote]);
  const vault = await freshVault();
  await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await rm(join(vault.root, '.amem', 'git', 'objects', head.slice(0, 2), head.slice(2)), { force: true });
  const report = await vault.doctor();
  assert.equal(report.healthy, false);
  assert.equal(report.git?.healthy, false);
  await assert.rejects(vault.sync(), (error: unknown) => error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
});

test('maintenance is repeatable, enforces one daemon lease, and serves loopback health and metrics', async () => {
  const vault = await freshVault();
  const service = new MaintenanceService(vault);
  const first = await service.runOnce();
  const second = await service.runOnce();
  assert.equal(first.doctor.healthy, true);
  assert.equal(second.expiry.commit, null);
  const configPath = join(vault.root, 'agent-memory.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { maintenance: { debounceMs: number; intervalMs: number } };
  config.maintenance.debounceMs = 50;
  config.maintenance.intervalMs = 1_000;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await vault.git.commit('test: configure maintenance timing', { id: 'test', name: 'Test' });
  const handle = await service.start({ port: 0 });
  const watchedDirectory = join(vault.root, 'wiki', 'project', 'fact');
  await mkdir(watchedDirectory, { recursive: true });
  const timestamp = new Date().toISOString();
  await writeFile(join(watchedDirectory, 'watched.md'), serializeMarkdown({ id: 'watched-memory', type: 'memory', createdAt: timestamp, updatedAt: timestamp, validatedAt: timestamp, kind: 'fact', key: 'watched', scope: 'project', sensitivity: 'internal', confidence: 1, status: 'active', evidence: [], conditions: [], tags: [], revision: 1 }, '# watched\n\nExternal editor change.'));
  await waitUntil(async () => (await readFile(join(vault.root, '.amem', 'search-index.json'), 'utf8')).includes('watched-memory'));
  const health = await fetch(`http://${handle.host}:${handle.port}/healthz`);
  assert.equal(health.status, 200);
  const healthBody = await health.text();
  assert.match(healthBody, /"status":"ok"/);
  assert.match(healthBody, /"configuration"|"maintenance"/);
  const metrics = await fetch(`http://${handle.host}:${handle.port}/metrics`);
  assert.equal(metrics.status, 200);
  assert.match(await metrics.text(), /agent_memory_/);
  await assert.rejects(new MaintenanceService(vault).start({ port: 0 }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'LOCK_TIMEOUT');
  await handle.stop();
  assert.equal(existsSync(join(vault.root, '.amem', 'service.json')), false);
});

async function collectText(root: string, paths: string[]): Promise<string> {
  const chunks: string[] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    const entries = await files(absolute);
    for (const file of entries) chunks.push(await readFile(file, 'utf8'));
  }
  return chunks.join('\n');
}

async function files(path: string): Promise<string[]> {
  const entry = await stat(path);
  if (entry.isFile()) return [path];
  return (await Promise.all((await readdir(path, { withFileTypes: true })).map((child) => child.isDirectory() ? files(join(path, child.name)) : [join(path, child.name)]))).flat();
}

async function git(cwd: string, args: string[]): Promise<void> {
  await exec('git', args, { cwd });
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for asynchronous state');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}
