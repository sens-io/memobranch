import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fsPromises, { chmod, link, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { GitStore } from '../src/git-store.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import { sharedGitBranchAllowed, sharedGitRemoteAllowed } from '../src/shared-wiki-git.js';
import { SharedWikiImporter } from '../src/shared-wiki-import.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { integrity, masterKey, pageKey } from './shared-wiki-fixture.js';
import { gitFixture } from './shared-wiki-git-fixture.js';

test('shared Git: real bare refresh reads an old pin without changing source/caller heads, refs, indexes, raw evidence or model count', async t => {
  const { source, caller, reader, input, cache, binding, versions, calls } = await gitFixture(t);
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller), count = calls();
  const raw = await readFile(join(source.root, versions[0]!.evidencePath));
  assert.equal((await reader.catalog()).sources[0]!.commit, binding.commit); assert.equal(existsSync(cache), false);
  const view = await reader.snapshot(input);
  assert.equal(view.snapshot.commit, binding.commit); assert.equal(view.snapshot.authorityHead, beforeSource.head);
  assert.match(JSON.stringify(view), /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(JSON.stringify(view), /DATED_WIKI_CURRENT_CANARY|\.scratch|remoteHash|MASTER_KEY/);
  assert.match(view.warnings.join(' '), /freshly fetched/);
  assert.equal(await new GitStore(cache).run(['status', '--porcelain']), '');
  assert.deepEqual(await readFile(join(cache, versions[0]!.evidencePath)), raw);
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller); assert.equal(calls(), count);
});

test('shared Git: grants, exact pin precondition and local-only broker refuse before any cache or transport', async t => {
  const { caller, principal, reader, input, binding, saveBindings, slot, configPath, env } = await gitFixture(t);
  await assert.rejects(reader.snapshot({ sourceId: input.sourceId, pageKeys: input.pageKeys }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(reader.snapshot({ ...input, expectedCommit: '0'.repeat(40) }), { code: 'VALIDATION_FAILED' });
  binding.readers[0]!.id = 'another'; await saveBindings(); principal.permissions = ['admin'];
  await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' }); assert.deepEqual((await reader.catalog()).sources, []);
  binding.readers[0]!.id = principal.id; await saveBindings();
  await assert.rejects(new SharedWikiReader(caller, { configPath, env, localOnly: true }).snapshot(input), { code: 'CONFIG_INVALID' });
  assert.equal(existsSync(slot), false);
});

test('shared Git: SHA-256 bare history preserves the full 64-character pin and exact object bytes', async t => {
  environment(t, { GIT_DEFAULT_HASH: 'sha256' });
  const { reader, input, cache, binding, source, versions } = await gitFixture(t);
  assert.equal(binding.commit.length, 64); const result = await reader.snapshot(input);
  assert.equal(result.snapshot.commit, binding.commit); assert.equal(result.snapshot.authorityHead.length, 64);
  assert.equal(await new GitStore(cache).run(['rev-parse', '--show-object-format']), 'sha256');
  assert.deepEqual(await readFile(join(cache, versions[0]!.evidencePath)), await readFile(join(source.root, versions[0]!.evidencePath)));
});

test('shared Git: strict remote/branch/config rejects helpers, credentials, insecure HTTP, unapproved files and request-selected commands', async t => {
  for (const remote of ['ext::anything', 'http://example.com/x', 'https://user@example.com/x', 'https://example.com/x?token=no', 'https://example.com/x#no',
    'ssh://bad@example.com/x', 'git@-bad:x', '/tmp/local', 'file:///tmp/local', './relative', 'https://example.com/\nanything']) assert.equal(sharedGitRemoteAllowed(remote), false, remote);
  for (const remote of ['https://example.com/repo.git', 'ssh://git@example.com/repo', 'git@example.com:repo.git']) assert.equal(sharedGitRemoteAllowed(remote), true, remote);
  for (const branch of ['-main', 'main..old', '.main', 'main/.x', 'main.lock', 'main/', 'main@{1}', 'main:other', 'a[0]']) assert.equal(sharedGitBranchAllowed(branch), false, branch);
  assert.equal(sharedGitBranchAllowed('release/one'), true);
  const { reader, input, binding, saveBindings, slot } = await gitFixture(t);
  for (const changed of [{ ...binding, allowLocalFile: false }, { ...binding, timeoutMs: 99 }, { ...binding, maxCacheBytes: 63_999 }, { ...binding, branch: 'HEAD:other' },
    { ...binding, remote: 'ext::never' }, { ...binding, root: '/unselected' }, { ...binding, command: 'never' }, { ...binding, token: 'no' }]) {
    await saveBindings([changed]); await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' });
  }
  await saveBindings(); await assert.rejects(reader.snapshot({ ...input, remote: binding.remote } as never), { code: 'VALIDATION_FAILED' }); assert.equal(existsSync(slot), false);
});

test('shared Git: failed refresh never serves cached plaintext; current withdrawal stops an old pin', async t => {
  const { source, reader, input, remote, publish } = await gitFixture(t);
  await reader.snapshot(input); await rename(remote, remote + '.offline');
  await assert.rejects(reader.snapshot(input), { code: 'REMOTE_TRANSPORT' }); await rename(remote + '.offline', remote);
  await source.wikiRevoke(pageKey, 'Synthetic remote withdrawal'); await publish();
  await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
});

test('shared Git: force-pushed history that excludes the configured pin refuses even while its old objects remain cached', async t => {
  const { reader, input, source, publish, versions } = await gitFixture(t);
  await reader.snapshot(input);
  const initial = (await source.git.run(['rev-list', '--max-parents=0', 'HEAD'])).split('\n')[0]!;
  assert.notEqual(initial, versions[0]!.commit); await publish(initial);
  await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
});

test('shared Git: encrypted reads require separately provisioned wrapped keys; opt-out precedes decrypt and refresh preserves the key store', async t => {
  const { reader, input, cache, provisionKeys, env } = await gitFixture(t, 'secret'), decrypt = EncryptionManager.prototype.decrypt;
  const saved = process.env.AMEM_MASTER_KEY; process.env.AMEM_MASTER_KEY = masterKey; t.after(() => { if (saved === undefined) delete process.env.AMEM_MASTER_KEY; else process.env.AMEM_MASTER_KEY = saved; });
  let attempts = 0; t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) { attempts++; return decrypt.call(this, meta, body); });
  await assert.rejects(reader.snapshot({ ...input, includeSecret: false }), { code: 'NOT_FOUND' }); assert.equal(attempts, 0);
  await assert.rejects(reader.snapshot(input), { code: 'ENCRYPTION_KEY_UNAVAILABLE' }); await provisionKeys();
  const keys = await readFile(join(cache, '.amem/keys.json')); assert.match(JSON.stringify(await reader.snapshot(input)), /DATED_WIKI_OLD_CANARY/);
  assert.deepEqual(await readFile(join(cache, '.amem/keys.json')), keys); delete env.SHARED_TEST_MASTER_KEY;
  await assert.rejects(reader.snapshot(input), { code: 'ENCRYPTION_KEY_UNAVAILABLE' }); env.SHARED_TEST_MASTER_KEY = masterKey;
  const privateCache = new MemoryVault(cache, { masterKey }); await privateCache.encryption.erase((await reader.snapshot(input)).snapshot.sources[0]!.id);
  await assert.rejects(reader.snapshot(input), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
});

test('shared Git: public selected graph does not decrypt unrelated confidential records', async t => {
  const { source, reader, input, binding, env, publish } = await gitFixture(t);
  await source.capture({ content: 'UNRELATED_GIT_SECRET_CANARY', scope: 'project', sensitivity: 'secret', extract: false }); await publish();
  delete env.SHARED_TEST_MASTER_KEY; let decrypts = 0;
  t.mock.method(EncryptionManager.prototype, 'decrypt', async () => { decrypts++; throw new Error('Unrelated decrypt'); });
  const result = await reader.snapshot(input); assert.equal(result.source.commit, binding.commit); assert.equal(decrypts, 0);
  assert.doesNotMatch(JSON.stringify(result), /UNRELATED_GIT_SECRET/);
});

test('shared Git: different cache owner/remote and static symlinks or hard links refuse without modifying outside files', async t => {
  const { reader, input, cache, slot, binding, saveBindings, caller } = await gitFixture(t); await reader.snapshot(input);
  binding.branch = 'another'; await saveBindings(); await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' });
  binding.branch = 'published'; await saveBindings();
  const outside = join(caller.root, '.amem/outside-canary'); await writeFile(outside, 'UNCHANGED_OUTSIDE_CANARY');
  const config = join(cache, '.amem/git/config'); await rename(config, config + '.safe'); await symlink(outside, config);
  await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' }); assert.equal(await readFile(outside, 'utf8'), 'UNCHANGED_OUTSIDE_CANARY');
  await rm(config); await link(outside, config); await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' }); assert.equal(await readFile(outside, 'utf8'), 'UNCHANGED_OUTSIDE_CANARY');
  await rm(config); await rename(config + '.safe', config); await rm(join(slot, 'owner.json'));
  await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' });
});

for (const kind of ['symlink', 'submodule', 'attributes', 'runtime', 'case', 'unicode', 'invalid-utf8', 'oversized-blob'] as const) {
  test(`shared Git: untrusted ${kind} current tree refuses before returning any old pin`, async t => {
    const { source, reader, input, publish, cache } = await gitFixture(t); await reader.snapshot(input);
    let path = 'wiki/untrusted.md';
    if (kind === 'symlink') { await symlink('/outside-untrusted-canary', join(source.root, path)); await source.git.run(['add', '--', path]); }
    else if (kind === 'submodule') { const head = await source.git.run(['rev-parse', 'HEAD']); await source.git.run(['update-index', '--add', '--cacheinfo', `160000,${head},wiki/submodule`]); }
    else {
      if (kind === 'attributes') path = '.gitattributes';
      if (kind === 'runtime') path = '.amem/untrusted.md';
      const content = kind === 'invalid-utf8' ? Buffer.from([0xff, 0xfe]) : kind === 'oversized-blob' ? Buffer.alloc(10_000_001, 65) : Buffer.from('UNTRUSTED_TREE_CANARY');
      await writeFile(join(source.root, path), content);
      if (kind === 'case' || kind === 'unicode') {
        // Construct collisions in the Git index even on a case-insensitive filesystem.
        await source.git.run(['config', 'core.ignorecase', 'false']); await source.git.run(['config', 'core.precomposeUnicode', 'false']);
        const blob = await source.git.run(['hash-object', '-w', join(source.root, path)]);
        await source.git.run(['update-index', '--add', '--cacheinfo', `100644,${blob},wiki/${kind === 'case' ? 'A' : 'é'}.md`]);
        await source.git.run(['update-index', '--add', '--cacheinfo', `100644,${blob},wiki/${kind === 'case' ? 'a' : 'é'}.md`]);
      } else await source.git.run(['add', '--force', '--', path]);
    }
    await source.git.run(['commit', '--no-gpg-sign', '-m', 'Synthetic untrusted remote tree']); await publish();
    await assert.rejects(reader.snapshot(input), { code: kind === 'oversized-blob' ? 'CONTENT_TOO_LARGE' : 'CONFIG_INVALID' });
    assert.equal(existsSync(join(cache, 'wiki/untrusted.md')), false);
  });
}

test('shared Git: exact whitespace bytes are materialized without running global filters, hooks or filesystem monitor commands', async t => {
  const { source, reader, input, cache, publish, caller } = await gitFixture(t);
  await writeFile(join(source.root, 'AGENTS.md'), '\ufeff  EXACT_GIT_BYTES\n\n'); await source.git.commit('Synthetic exact object bytes', source.principal, ['AGENTS.md']); await publish();
  const global = join(caller.root, '.amem/synthetic-global-config'), attributes = join(caller.root, '.amem/synthetic-attributes'), trap = join(caller.root, '.amem/SHOULD_NOT_EXECUTE'), hooks = join(caller.root, '.amem/synthetic-hooks');
  await mkdir(hooks); for (const name of ['reference-transaction', 'post-index-change', 'post-checkout']) { const path = join(hooks, name); await writeFile(path, '#!/bin/sh\ntouch "' + trap + '"\n'); await chmod(path, 0o700); }
  await writeFile(attributes, '* filter=trap\n');
  await writeFile(global, `[core]\n attributesFile = ${attributes}\n hooksPath = ${hooks}\n fsmonitor = touch ${trap}\n[filter "trap"]\n clean = touch ${trap}; cat\n smudge = touch ${trap}; cat\n required = true\n`);
  const restore = environment(t, { GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' });
  await reader.snapshot(input); assert.equal(existsSync(trap), false);
  assert.deepEqual(await readFile(join(cache, 'AGENTS.md')), await readFile(join(source.root, 'AGENTS.md')));
  assert.equal(await new GitStore(cache).run(['status', '--porcelain']), ''); assert.equal(existsSync(trap), false); restore();
});

test('shared Git: pending partial materialization, stale Git locks and file/directory shape changes recover without deleting private runtime', async t => {
  const { reader, input, cache, source } = await gitFixture(t); await reader.snapshot(input);
  const sentinel = join(cache, '.amem/private-host-note'); await writeFile(sentinel, 'PRIVATE_RUNTIME_RETAINED');
  await writeFile(join(cache, '.amem/shared-cache-pending.json'), '{}');
  await writeFile(join(cache, '.amem/git/index.lock'), 'interrupted'); await writeFile(join(cache, 'WIKI.md'), 'PARTIAL_CACHE_CANARY');
  const page = (await source.wikiCatalog())[0]!, target = join(cache, page.path);
  await rm(target); await mkdir(target); await writeFile(join(target, 'partial.md'), 'old');
  await reader.snapshot(input); assert.deepEqual(await readFile(target), await readFile(join(source.root, page.path)));
  assert.equal(await readFile(sentinel, 'utf8'), 'PRIVATE_RUNTIME_RETAINED'); assert.equal(existsSync(join(cache, '.amem/shared-cache-pending.json')), false);
  assert.equal(existsSync(join(cache, '.amem/git/index.lock')), false);
});

test('shared Git: cancellation during an actual file replacement leaves no returned view and the next refresh reconstructs the cache', async t => {
  const { reader, input, cache, caller, source } = await gitFixture(t), controller = new AbortController(), native = fsPromises.rename;
  const before = await integrity(caller), beforeSource = await integrity(source); let interrupted = false;
  t.mock.method(fsPromises, 'rename', async (...args: Parameters<typeof native>) => {
    const result = await native(...args);
    if (!interrupted && String(args[0]).includes(cache + '/.amem/stage-')) { interrupted = true; controller.abort(); }
    return result;
  }); syncBuiltinESMExports();
  try { await assert.rejects(reader.snapshot({ ...input, signal: controller.signal }), { code: 'OPERATION_CANCELLED' }); assert.equal(interrupted, true); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(existsSync(join(cache, '.amem/shared-cache-pending.json')), true);
  assert.match(JSON.stringify(await reader.snapshot(input)), /DATED_WIKI_OLD_CANARY/);
  assert.equal(existsSync(join(cache, '.amem/shared-cache-pending.json')), false);
  assert.deepEqual(await integrity(caller), before); assert.deepEqual(await integrity(source), beforeSource);
});

test('shared Git: source expiry or binding withdrawal after graph assembly refuses before caller receives plaintext', async t => {
  const { reader, input, source, cache, publish, binding, saveBindings, caller } = await gitFixture(t), expires = Date.now() + 120000;
  for (const page of await source.wikiCatalog()) {
    const path = join(source.root, page.path), doc = parseMarkdown<Record<string, unknown>>(await readFile(path, 'utf8'));
    doc.meta.expiresAt = new Date(expires).toISOString(); await writeFile(path, serializeMarkdown(doc.meta, doc.body));
  }
  await source.git.commit('Synthetic remote expiry', source.principal, ['wiki']); await publish();
  let now = expires - 1000, expire = false; t.mock.method(Date, 'now', () => now);
  const original = MemoryVault.prototype.wikiSnapshotWithValidation;
  t.mock.method(MemoryVault.prototype, 'wikiSnapshotWithValidation', async function(this: MemoryVault, options: Parameters<typeof original>[0]) {
    const result = await original.call(this, options);
    if (this.root === cache) { if (expire) now = expires; else { binding.readers[0]!.id = 'withdrawn'; await saveBindings(); } }
    return result;
  });
  const before = await integrity(caller);
  await assert.rejects(reader.snapshot(input), { code: 'AUTHORIZATION_DENIED' });
  binding.readers[0]!.id = caller.principal.id; await saveBindings(); expire = true;
  await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' }); assert.deepEqual(await integrity(caller), before);
});

test('shared Git: cache quota refuses before transport and does not erase host key material', async t => {
  const { reader, input, cache, binding, saveBindings } = await gitFixture(t); await reader.snapshot(input);
  const keys = join(cache, '.amem/keys.json'); await writeFile(keys, 'HOST_KEY_SENTINEL');
  await writeFile(join(cache, '.amem/too-large'), Buffer.alloc(65_000)); binding.maxCacheBytes = 64_000; await saveBindings();
  await assert.rejects(reader.snapshot(input), { code: 'CONTENT_TOO_LARGE' }); assert.equal(await readFile(keys, 'utf8'), 'HOST_KEY_SENTINEL');
});

test('shared Git: a preexisting refresh queue symlink refuses before writing any contender outside the cache', async t => {
  const { reader, input, caller } = await gitFixture(t), base = join(caller.root, '.amem/shared-cache'), outside = join(caller.root, '.amem/outside-queue');
  await mkdir(base); await mkdir(outside); await symlink(outside, join(base, 'team-wiki.lock.queue'));
  await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' }); assert.deepEqual(await readdir(outside), []);
});

test('shared Git: abandoned owned staging files cannot consume the next refresh quota or delete separately provisioned keys', async t => {
  const { reader, input, binding, saveBindings, cache, slot } = await gitFixture(t); await reader.snapshot(input);
  const stage = join(cache, '.amem/stage-76ec9c03-bded-4d77-bcaf-9fde7a9bf037'), keys = join(cache, '.amem/keys.json');
  await writeFile(keys, 'HOST_KEY_RETENTION_CANARY');
  const baseline = await fixtureBytes(slot), tree = await new GitStore(cache).run(['ls-tree', '-r', '-l', 'HEAD']);
  const stageBytes = tree.split('\n').reduce((total, line) => total + Number(/^\d+ blob [a-f0-9]+\s+(\d+)\t/.exec(line)![1]), 0);
  binding.maxCacheBytes = Math.max(64_000, baseline + stageBytes + 4096); await saveBindings();
  await mkdir(stage); await writeFile(join(stage, '0'.repeat(64)), Buffer.alloc(stageBytes)); await writeFile(join(cache, '.amem/shared-cache-pending.json'), '{}');
  assert.ok(await fixtureBytes(slot) < binding.maxCacheBytes, 'interrupted cache fits before rebuilding');
  assert.match(JSON.stringify(await reader.snapshot(input)), /DATED_WIKI_OLD_CANARY/); assert.equal(existsSync(stage), false);
  await mkdir(stage); await writeFile(join(stage, '0'.repeat(64)), Buffer.alloc(600_000));
  binding.maxCacheBytes = 512_000; await saveBindings();
  assert.match(JSON.stringify(await reader.snapshot(input)), /DATED_WIKI_OLD_CANARY/);
  assert.equal(existsSync(stage), false); assert.equal(await readFile(keys, 'utf8'), 'HOST_KEY_RETENTION_CANARY');
});

test('shared Git: reserved staging cleanup refuses unexpected private files instead of deleting them', async t => {
  const { reader, input, cache } = await gitFixture(t); await reader.snapshot(input);
  const stage = join(cache, '.amem/stage-34c0e753-f899-4fc6-846f-d2d636c183dc'); await mkdir(stage);
  await writeFile(join(stage, 'keys.json'), 'DO_NOT_DELETE_PRIVATE_FILE');
  await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' }); assert.equal(await readFile(join(stage, 'keys.json'), 'utf8'), 'DO_NOT_DELETE_PRIVATE_FILE');
});

test('shared Git: actual refresh lock cancellation releases its ticket, holds no caller writer lock and leaves canonical data unchanged', async t => {
  const { reader, input, caller } = await gitFixture(t), lock = join(caller.root, '.amem/shared-cache/team-wiki.lock');
  const acquired = deferred(), release = deferred(), controller = new AbortController(), before = await integrity(caller);
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const pending = reader.snapshot({ ...input, signal: controller.signal }).then(() => null, error => error);
    await waitFor(async () => (await readdir(lock + '.queue')).length === 2);
    assert.equal(existsSync(join(caller.root, '.amem/write.lock')), false); controller.abort(); assert.equal((await pending).code, 'OPERATION_CANCELLED');
    await waitFor(async () => (await readdir(lock + '.queue')).length === 1);
  } finally { controller.abort(); release.resolve(); await owner; }
  assert.deepEqual(await integrity(caller), before);
});

test('shared Git: concurrent reads serialize refresh, and imports require separate confirmation plus a fresh remote check', async t => {
  const { source, caller, callerAdmin, principal, reader, input, publish, configPath, env } = await gitFixture(t);
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller);
  const views = await Promise.all([reader.snapshot(input), reader.snapshot(input)]); assert.deepEqual(views[0]!.snapshot.pages, views[1]!.snapshot.pages);
  principal.permissions = ['read', 'write', 'review']; const importer = new SharedWikiImporter(caller, { configPath, env }), { plan } = await importer.prepare(input);
  assert.deepEqual(await integrity(caller), beforeCaller); await assert.rejects(importer.apply(plan, { confirm: false } as never), { code: 'VALIDATION_FAILED' });
  const copied = await importer.apply(plan, { confirm: true }); assert.ok(copied.commit); assert.deepEqual(await callerAdmin.wikiCatalog(), []);
  const duplicate = await importer.apply(plan, { confirm: true }); assert.equal(duplicate.commit, null); assert.equal(duplicate.duplicate, true);
  assert.deepEqual(await integrity(source), beforeSource);
  await source.wikiRevoke(pageKey, 'Synthetic import withdrawal'); await publish(); const beforeWithdrawalRetry = await integrity(caller);
  await assert.rejects(importer.apply(plan, { confirm: true }), { code: 'NOT_FOUND' }); assert.deepEqual(await integrity(caller), beforeWithdrawalRetry);
});

function environment(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); let done = false;
  const restore = () => { if (done) return; done = true; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
  Object.assign(process.env, values); t.after(restore); return restore;
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixtureBytes(path: string): Promise<number> {
  const meta = await stat(path); if (!meta.isDirectory()) return meta.size;
  let bytes = 0; for (const name of await readdir(path)) bytes += await fixtureBytes(join(path, name)); return bytes;
}
async function waitFor(check: () => Promise<boolean>) { const end = performance.now() + 5000; while (performance.now() < end) { if (await check().catch(() => false)) return; await delay(10); } throw new Error('Expected live fixture condition'); }
