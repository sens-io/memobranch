import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fsPromises, { readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { serializeMarkdown } from '../src/markdown.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import { VaultTransaction } from '../src/transaction.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId } from '../src/wiki-schema.js';
import { integrity, masterKey, pageKey, sharedFixture } from './shared-wiki-fixture.js';

test('shared Wiki: two real vaults preserve the configured old version, exact origin, evidence, heads, refs and indexes', async t => {
  const { source, caller, reader, input, versions, binding, sourceConfig, calls } = await sharedFixture(t);
  const current = await source.wikiSnapshot({ commit: await source.git.run(['rev-parse', 'HEAD']), pageKeys: [pageKey] });
  assert.match(current.pages.find(page => page.meta.key === pageKey)!.body, /DATED_WIKI_CURRENT_CANARY/);
  const beforeSource = await integrity(source), beforeCaller = await integrity(caller), count = calls();
  const bytes = await readFile(join(source.root, versions[0]!.evidencePath));
  const catalog = await reader.catalog(); assert.equal(catalog.sources.length, 1);
  assert.deepEqual(Object.keys(catalog.sources[0]!).sort(), ['commit', 'id', 'maxSensitivity', 'scopes', 'title']);
  assert.doesNotMatch(JSON.stringify(catalog), /readers|MASTER_KEY|\/Users|\.scratch/);
  const result = await reader.snapshot(input);
  assert.deepEqual(result.source, { id: binding.id, title: binding.title, vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId, commit: versions[0]!.commit });
  assert.equal(result.snapshot.commit, versions[0]!.commit); assert.match(result.snapshot.pages.find(page => page.meta.key === pageKey)!.body, /DATED_WIKI_OLD_CANARY/);
  assert.doesNotMatch(JSON.stringify(result), /DATED_WIKI_CURRENT_CANARY/); assert.match(result.warnings.join(' '), /offline clone|copied plaintext/);
  assert.equal('validate' in result, false); assert.equal('documentHashes' in result, false);
  assert.deepEqual(await integrity(source), beforeSource); assert.deepEqual(await integrity(caller), beforeCaller);
  assert.deepEqual(await readFile(join(source.root, versions[0]!.evidencePath)), bytes); assert.equal(calls(), count);
});

test('shared Wiki: matching actor and tenant grant is required even for admins, without probing an ungranted root', async t => {
  const { caller, principal, binding, saveBindings, reader, input } = await sharedFixture(t);
  binding.root = join(caller.root, 'PRIVATE_ROOT_MUST_NOT_BE_PROBED');
  binding.readers = [{ id: 'other', tenantId: binding.readers[0]!.tenantId }]; await saveBindings();
  assert.deepEqual((await reader.catalog()).sources, []);
  await assert.rejects(reader.snapshot(input), (error: any) => { assert.equal(error.code, 'NOT_FOUND'); assert.doesNotMatch(JSON.stringify(error.toJSON()), /PRIVATE_ROOT|other/); return true; });
  principal.permissions = ['admin']; await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
  binding.readers[0] = { id: principal.id, tenantId: 'foreign' }; await saveBindings();
  assert.deepEqual((await reader.catalog()).sources, []);
  principal.tenantId = 'foreign'; await assert.rejects(reader.catalog(), { code: 'AUTHORIZATION_DENIED' });
});

test('shared Wiki: a stale catalog pin precondition refuses before source access and cannot select another commit', async t => {
  const { source, reader, input, binding, saveBindings } = await sharedFixture(t), pin = (await reader.catalog()).sources[0]!.commit;
  const original = MemoryVault.prototype.wikiSnapshotWithValidation; let sourceReads = 0;
  t.mock.method(MemoryVault.prototype, 'wikiSnapshotWithValidation', async function(this: MemoryVault, options: Parameters<typeof original>[0]) {
    if (this.root === source.root) sourceReads++; return original.call(this, options);
  });
  binding.commit = await source.git.run(['rev-parse', 'HEAD']); assert.notEqual(binding.commit, pin); await saveBindings();
  await assert.rejects(reader.snapshot({ ...input, expectedCommit: pin }), { code: 'VALIDATION_FAILED' }); assert.equal(sourceReads, 0);
  const current = await reader.snapshot({ ...input, expectedCommit: binding.commit }); assert.equal(sourceReads, 1);
  assert.match(current.snapshot.pages.find(page => page.meta.type === 'wiki-page' && page.meta.key === pageKey)!.body, /DATED_WIKI_CURRENT_CANARY/);
  await assert.rejects(reader.snapshot({ ...input, expectedCommit: 'HEAD' }), { code: 'VALIDATION_FAILED' }); assert.equal(sourceReads, 1);
});

test('shared Wiki: caller scope and sensitivity cap configured grants; private opt-out precedes decryption', async t => {
  const { reader, input, principal } = await sharedFixture(t, 'secret'), decrypt = EncryptionManager.prototype.decrypt;
  const seen: string[] = [];
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) { seen.push(meta.id); return decrypt.call(this, meta, body); });
  await assert.rejects(reader.snapshot({ ...input, includeSecret: false }), { code: 'NOT_FOUND' }); assert.equal(seen.length, 0);
  principal.maxSensitivity = 'internal'; await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' }); assert.equal(seen.length, 0);
  principal.maxSensitivity = 'secret'; principal.scopes = ['public'];
  assert.deepEqual((await reader.catalog()).sources, []); await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' }); assert.equal(seen.length, 0);
  principal.scopes = ['project']; assert.equal((await reader.snapshot(input)).snapshot.commit.length, 40); assert.ok(seen.length > 0);
});

test('shared Wiki: source-specific keys never fall back to the caller environment and erased keys prevent new reads', async t => {
  const { reader, input, binding, env, source, saveBindings, versions } = await sharedFixture(t, 'secret');
  const saved = process.env.AMEM_MASTER_KEY; process.env.AMEM_MASTER_KEY = masterKey;
  try {
    binding.masterKeyEnv = undefined; await saveBindings();
    await assert.rejects(reader.snapshot(input), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
    binding.masterKeyEnv = 'SHARED_TEST_MASTER_KEY'; await saveBindings();
    await reader.snapshot(input); delete env.SHARED_TEST_MASTER_KEY;
    await assert.rejects(reader.snapshot(input), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
    env.SHARED_TEST_MASTER_KEY = masterKey; await source.encryption.erase(versions[0]!.evidenceId);
    await assert.rejects(reader.snapshot(input), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
  } finally { if (saved === undefined) delete process.env.AMEM_MASTER_KEY; else process.env.AMEM_MASTER_KEY = saved; }
});

test('shared Wiki: current withdrawal, wrong source identity and dirty or pending sources do not return old content', async t => {
  const { source, reader, input, binding, saveBindings } = await sharedFixture(t);
  const before = await integrity(source), page = await source.get(wikiPageId(pageKey)), original = await readFile(join(source.root, page.path));
  await writeFile(join(source.root, page.path), Buffer.concat([original, Buffer.from('\n')]));
  await assert.rejects(reader.snapshot(input), (error: any) => {
    assert.equal(error.code, 'VALIDATION_FAILED'); const output = JSON.stringify(error.toJSON());
    assert.equal(output.includes(source.root), false); assert.doesNotMatch(output, /DATED_WIKI_/); return true;
  }); await writeFile(join(source.root, page.path), original);
  const transaction = await VaultTransaction.begin(source.root, source.git, source.principal, 'Synthetic pending source');
  try { await assert.rejects(reader.snapshot(input), { code: 'TRANSACTION_RECOVERY_FAILED' }); }
  finally { await transaction.rollback(); }
  assert.deepEqual(await integrity(source), before);
  binding.vaultId = 'foreign-vault'; await saveBindings(); await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
  binding.vaultId = (await source.config()).vaultId; await saveBindings();
  await source.wikiRevoke(pageKey, 'Withdraw shared source fixture');
  await assert.rejects(reader.snapshot(input), { code: 'NOT_FOUND' });
});

test('shared Wiki: host files reject malformed, oversized, duplicate, relative, executable and symlink bindings', async t => {
  const { reader, input, binding, configPath, caller, env, saveBindings } = await sharedFixture(t);
  for (const value of [null, {}, { version: 1, sources: [binding, binding] }, { version: 1, sources: [{ ...binding, root: 'relative' }] },
    { version: 1, sources: [{ ...binding, commit: 'HEAD' }] }, { version: 1, sources: [{ ...binding, readers: [...binding.readers, ...binding.readers] }] },
    { version: 1, sources: [{ ...binding, command: 'never' }] }, { version: 1, sources: [{ ...binding, masterKey: 'PRIVATE_TEST_KEY' }] },
    { version: 1, sources: Array.from({ length: 21 }, (_, index) => ({ ...binding, id: `source-${index}` })) }]) {
    await writeFile(configPath, JSON.stringify(value)); await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' });
  }
  await writeFile(configPath, '{invalid'); await assert.rejects(reader.catalog(), { code: 'CONFIG_INVALID' });
  await writeFile(configPath, ' '.repeat(100_001)); await assert.rejects(reader.catalog(), { code: 'CONTENT_TOO_LARGE' });
  await saveBindings(); const link = join(caller.root, '.amem/shared-link.json'); await symlink(configPath, link);
  await assert.rejects(new SharedWikiReader(caller, { configPath: link, env }).snapshot(input), { code: 'CONFIG_INVALID' });
  assert.throws(() => new SharedWikiReader(caller, { configPath: 'relative' }), { code: 'CONFIG_INVALID' });
});

test('shared Wiki: a regular host file replaced during its actual read is refused', async t => {
  const { reader, configPath, input } = await sharedFixture(t), open = fsPromises.open; let swapped = false;
  t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof open>) => {
    const handle = await open(...args);
    if (args[0] === configPath && !swapped) { swapped = true; const text = await readFile(configPath); await rename(configPath, configPath + '.old'); await writeFile(configPath, text); }
    return handle;
  }); syncBuiltinESMExports();
  try { await assert.rejects(reader.snapshot(input), { code: 'CONFIG_INVALID' }); assert.equal(swapped, true); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('shared Wiki: strict caller fields and real cancellation signals fail before shared access', async t => {
  const { reader, input, source, caller, configPath } = await sharedFixture(t), before = await integrity(source), beforeCaller = await integrity(caller);
  for (const extra of [{ root: source.root }, { commit: input.sourceId }, { tenantId: 'foreign' }, { principal: caller.principal }, { command: 'never' }, { signal: {} }, { pageKeys: [pageKey, pageKey] }]) {
    await assert.rejects(reader.snapshot({ ...input, ...extra } as never), { code: 'VALIDATION_FAILED' });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reader.snapshot({ ...input, signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(reader.catalog({ signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  assert.ok((await readFile(configPath)).length); assert.deepEqual(await integrity(source), before); assert.deepEqual(await integrity(caller), beforeCaller);
});

test('shared Wiki: revoked bindings, source key selection and caller authority after a real source read refuse assembled plaintext', async t => {
  const fixture = await sharedFixture(t, 'secret'), { reader, input, source, principal, env, binding, saveBindings } = fixture;
  const original = MemoryVault.prototype.wikiSnapshotWithValidation; let change: () => Promise<void>;
  t.mock.method(MemoryVault.prototype, 'wikiSnapshotWithValidation', async function(this: MemoryVault, options: Parameters<typeof original>[0]) {
    const result = await original.call(this, options); if (this.root === source.root) await change(); return result;
  });
  change = async () => { binding.readers[0]!.id = 'other'; await saveBindings(); };
  await assert.rejects(reader.snapshot(input), { code: 'AUTHORIZATION_DENIED' });
  binding.readers[0]!.id = principal.id; await saveBindings();
  change = async () => { delete env.SHARED_TEST_MASTER_KEY; };
  await assert.rejects(reader.snapshot(input), { code: 'AUTHORIZATION_DENIED' }); env.SHARED_TEST_MASTER_KEY = masterKey;
  change = async () => { principal.scopes = ['public']; };
  await assert.rejects(reader.snapshot(input), { code: 'AUTHORIZATION_DENIED' });
});

test('shared Wiki: cancelling an actual source lock wait releases the initial caller lock and changes no canonical state', async t => {
  const { source, caller, reader, input } = await sharedFixture(t), lock = join(source.root, '.amem/write.lock');
  const acquired = deferred(), release = deferred(), controller = new AbortController(), before = await integrity(source), beforeCaller = await integrity(caller);
  const owner = withFileLock(lock, async () => { acquired.resolve(); await release.promise; });
  try {
    await acquired.promise; const pending = reader.snapshot({ ...input, signal: controller.signal }).then(() => null, error => error);
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 2);
    assert.equal(existsSync(join(caller.root, '.amem/write.lock')), false);
    controller.abort(); assert.equal((await pending)?.code, 'OPERATION_CANCELLED');
    await waitFor(async () => (await readdir(`${lock}.queue`)).length === 1);
  } finally { controller.abort(); release.resolve(); await owner; }
  assert.deepEqual(await integrity(source), before); assert.deepEqual(await integrity(caller), beforeCaller);
});

for (const expiring of ['current', 'historical', 'fact-validity'] as const) test(`shared Wiki: final caller lock wait crossing ${expiring} expiry cannot return assembled old text`, { timeout: 15000 }, async t => {
  const { source, caller, binding, saveBindings, reader, input, versions } = await sharedFixture(t);
  const expires = Date.now() + 120000;
  if (expiring === 'fact-validity') {
    const proposed = await source.propose({ key: 'expiring-shared-fact', statement: 'Synthetic fact with reviewed validity.', kind: 'fact',
      scope: 'project', sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [] }, [versions[0]!.evidencePath]);
    const approved = await source.approve(proposed.id), memory = await source.get(approved.memoryId);
    await source.setMemoryValidity(approved.memoryId, { expectedRevision: memory.meta.revision as number,
      validFrom: new Date(expires - 180000).toISOString(), validUntil: new Date(expires).toISOString() });
    binding.commit = await source.git.run(['rev-parse', 'HEAD']); input.pageKeys = [`legacy:${approved.memoryId}`]; await saveBindings();
  } else {
    const pages = [];
    for (const entry of await source.wikiCatalog()) pages.push(await source.get(entry.id));
    // The fixture is cyclic: dependent pages must retain the same expiry restriction.
    for (const page of pages) { page.meta.expiresAt = new Date(expires).toISOString(); await writeFile(join(source.root, page.path), serializeMarkdown(page.meta, page.body)); }
    const expiringCommit = await source.git.commit('Synthetic source expiry', source.principal, ['wiki']);
    if (expiring === 'historical') {
      binding.commit = expiringCommit!; await saveBindings();
      for (const page of pages) { delete page.meta.expiresAt; await writeFile(join(source.root, page.path), serializeMarkdown(page.meta, page.body)); }
      await source.git.commit('Synthetic current pages without expiry', source.principal, ['wiki']);
    }
  }
  let now = expires - 1000, sourceReady = false, settled = false, sourceFailure: unknown;
  t.mock.method(Date, 'now', () => now);
  const sourceGate = deferred(), callerGate = deferred(), acquired = deferred(), original = MemoryVault.prototype.wikiSnapshotWithValidation;
  t.after(() => { sourceGate.resolve(); callerGate.resolve(); });
  t.mock.method(MemoryVault.prototype, 'wikiSnapshotWithValidation', async function(this: MemoryVault, options: Parameters<typeof original>[0]) {
    const result = await original.call(this, options).catch(error => { sourceFailure = error; throw error; });
    if (this.root === source.root) {
      if (expiring === 'fact-validity') { assert.equal(result.snapshot.pages[0]!.meta.type, 'memory'); assert.equal(result.snapshot.pages[0]!.meta.validUntil, new Date(expires).toISOString()); }
      else assert.equal(Boolean(result.snapshot.pages.find(page => page.meta.type === 'wiki-page' && page.meta.key === pageKey)!.meta.expiresAt), expiring === 'historical');
      sourceReady = true; await sourceGate.promise;
    }
    return result;
  });
  const outcome = reader.snapshot({ ...input, signal: t.signal }).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  await waitFor(async () => sourceReady || settled);
  if (!sourceReady) { assert.ifError(sourceFailure); const early = await outcome; if ('error' in early) assert.ifError(early.error); }
  assert.equal(sourceReady, true, 'source must finish successfully before the extra wait');
  const lock = join(caller.root, '.amem/write.lock'), owner = withFileLock(lock, async () => { acquired.resolve(); await callerGate.promise; });
  try {
    await acquired.promise; sourceGate.resolve();
    await waitFor(async () => !existsSync(join(source.root, '.amem/write.lock')) && (await readdir(`${lock}.queue`)).length === 2);
    now = expires + 1; callerGate.resolve(); await owner;
    const result = await outcome; assert.ok('error' in result); assert.equal(result.error.code, 'NOT_FOUND');
  } finally { sourceGate.resolve(); callerGate.resolve(); await owner; await outcome; }
});

test('shared Wiki: opposite caller/source reads complete without nested vault-lock deadlock', async t => {
  const a = await sharedFixture(t), b = await sharedFixture(t);
  const configA = await a.source.config(), configB = await b.source.config();
  const aPath = join(a.source.root, '.amem/shared-opposite.json'), bPath = join(b.source.root, '.amem/shared-opposite.json');
  const bindingA = { ...b.binding, readers: [{ id: a.source.principal.id, tenantId: configA.tenantId }] };
  const bindingB = { ...a.binding, readers: [{ id: b.source.principal.id, tenantId: configB.tenantId }] };
  await writeFile(aPath, JSON.stringify({ version: 1, sources: [bindingA] })); await writeFile(bPath, JSON.stringify({ version: 1, sources: [bindingB] }));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
  const beforeA = await integrity(a.source), beforeB = await integrity(b.source);
  try {
    const results = await Promise.all([new SharedWikiReader(a.source, { configPath: aPath }).snapshot({ ...b.input, signal: controller.signal }),
      new SharedWikiReader(b.source, { configPath: bPath }).snapshot({ ...a.input, signal: controller.signal })]);
    assert.equal(results.length, 2); assert.equal(controller.signal.aborted, false);
  } finally { clearTimeout(timer); controller.abort(); }
  assert.deepEqual(await integrity(a.source), beforeA); assert.deepEqual(await integrity(b.source), beforeB);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(predicate: () => Promise<boolean>) { const end = performance.now() + 4000; while (!await predicate()) { assert.ok(performance.now() < end, 'Expected actual lock/state transition'); await delay(10); } }
