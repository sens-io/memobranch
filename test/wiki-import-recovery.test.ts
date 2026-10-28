import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { SharedWikiImporter, type SharedWikiImportPlan } from '../src/shared-wiki-import.js';
import { MemoryVault } from '../src/vault.js';
import { operationSignal } from '../src/operation.js';
import { withFileLock } from '../src/utils.js';
import { integrity, pageKey, sharedFixture } from './shared-wiki-fixture.js';
import { readWikiImportArtifact } from '../src/wiki-import-artifact.js';
import type { EvidenceMeta } from '../src/types.js';

async function fixture(t: TestContext) {
  const f = await sharedFixture(t);
  f.principal.permissions = ['read', 'write', 'review'];
  const importer = new SharedWikiImporter(f.caller, { configPath: f.configPath, env: f.env });
  const { plan } = await importer.prepare({ ...f.input, expectedCommit: f.binding.commit });
  return { ...f, importer, plan };
}

async function files(root: string, path = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    if (!path && ['.git', '.amem'].includes(entry.name)) continue;
    const relative = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await files(root, relative));
    else result[relative] = (await readFile(join(root, relative))).toString('base64');
  }
  return result;
}

async function canonical(vault: MemoryVault) {
  return { head: await vault.git.run(['rev-parse', 'HEAD']), refs: await vault.git.run(['show-ref']),
    staged: await vault.git.run(['diff', '--cached', '--binary']), status: await vault.git.run(['status', '--porcelain']), files: await files(vault.root) };
}

async function settled(root: string) {
  assert.equal(existsSync(join(root, '.amem/write.lock')), false);
  assert.deepEqual(await readdir(join(root, '.amem/write.lock.queue')), []);
  assert.deepEqual(await readdir(join(root, '.amem/transactions')), []);
}

// Observe real completed writes and Git boundaries; SIGKILL deliberately bypasses
// all JavaScript cleanup. The reopened vault must use the on-disk transaction.
const suffix = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const worker = `
import { MemoryVault } from ${JSON.stringify(new URL('../src/vault' + suffix, import.meta.url).href)};
import { SharedWikiImporter } from ${JSON.stringify(new URL('../src/shared-wiki-import' + suffix, import.meta.url).href)};
import { VaultTransaction } from ${JSON.stringify(new URL('../src/transaction' + suffix, import.meta.url).href)};
const [root, configPath, encodedPlan, boundary] = process.argv.slice(1);
const vault = new MemoryVault(root, { masterKey: '31'.repeat(32) });
const plan = JSON.parse(encodedPlan);
const message = value => new Promise(resolve => process.send(value, resolve));
async function stop(at) {
  if (boundary !== at) return;
  await message({ boundary: at }); process.kill(process.pid, 'SIGKILL'); await new Promise(() => {});
}
const write = VaultTransaction.prototype.write;
VaultTransaction.prototype.write = async function(path, content) {
  await write.call(this, path, content);
  if (path.startsWith('evidence/')) await stop('evidence');
  if (path === 'log.md') await stop('log');
};
const commit = vault.git.commit.bind(vault.git);
vault.git.commit = async (...args) => { await stop('ready'); return commit(...args); };
const run = vault.git.run.bind(vault.git);
vault.git.run = async (...args) => { const result = await run(...args); if (args[0][0] === 'commit') await stop('commit'); return result; };
try {
  const importer = new SharedWikiImporter(vault, { configPath, env: { SHARED_TEST_MASTER_KEY: '85'.repeat(32) } });
  await message({ result: await importer.apply(plan, { confirm: true }) });
} catch (error) { await message({ error: { code: error.code, message: error.message } }); }
process.disconnect();
`;

async function crash(root: string, configPath: string, plan: SharedWikiImportPlan, boundary: string) {
  const child = spawn(process.execPath, [...(suffix === '.ts' ? ['--import', 'tsx'] : []), '--input-type=module', '--eval', worker,
    root, configPath, JSON.stringify(plan), boundary], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages: unknown[] = []; let stderr = '';
  child.on('message', value => messages.push(value)); child.stdout!.resume();
  child.stderr!.on('data', value => { stderr += value.toString(); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  assert.deepEqual(result, { code: null, signal: 'SIGKILL' }, stderr);
  assert.deepEqual(messages, [{ boundary }], `The actual requested boundary must be reached: ${stderr}`);
}

for (const boundary of ['evidence', 'log', 'ready', 'commit']) {
  test(`Wiki import recovery: actual child termination after ${boundary} restores or completes one immutable copy`, { timeout: 30_000 }, async t => {
    const f = await fixture(t), before = await canonical(f.caller), sourceBefore = await integrity(f.source), count = f.calls();
    // The child uses its own local admin, so grant that exact actor in this synthetic source.
    f.binding.readers.push({ id: f.callerAdmin.principal.id, tenantId: f.callerConfig.tenantId });
    await f.saveBindings();
    const importer = new SharedWikiImporter(f.callerAdmin, { configPath: f.configPath, env: f.env });
    const { plan } = await importer.prepare({ ...f.input, expectedCommit: f.binding.commit });
    await crash(f.caller.root, f.configPath, plan, boundary);
    const pending = await readdir(join(f.caller.root, '.amem/transactions')); assert.equal(pending.length, 1);
    const journal = JSON.parse(await readFile(join(f.caller.root, '.amem/transactions', pending[0]!), 'utf8'));
    const durable = ['ready', 'commit'].includes(boundary);
    assert.equal(journal.phase, durable ? 'ready' : 'writing');
    const fresh = new MemoryVault(f.caller.root, { masterKey: '31'.repeat(32) });
    const result = await fresh.recover();
    assert.equal(result.rolledBack.length, durable ? 0 : 1); assert.equal(result.replayed.length, durable ? 1 : 0);
    if (!durable) assert.deepEqual(await canonical(fresh), before);
    else assert.equal(await fresh.git.run(['rev-list', '--count', `${before.head}..HEAD`]), '1');
    const next = new SharedWikiImporter(fresh, { configPath: f.configPath, env: f.env });
    const captured = await next.apply(plan, { confirm: true });
    assert.equal(captured.duplicate, durable); assert.equal(captured.commit === null, durable);
    const record = await fresh.get(captured.evidenceId);
    const artifact = readWikiImportArtifact(record as unknown as { path: string; meta: EvidenceMeta; body: string });
    assert.deepEqual(artifact, plan.artifact); assert.equal(record.meta.digestVersion, 4);
    assert.deepEqual(await fresh.wikiCatalog(), []);
    assert.equal(await fresh.git.run(['rev-list', '--count', `${before.head}..HEAD`]), '1');
    assert.equal((await fresh.listRecords({ collection: 'evidence' })).total, 1);
    const complete = await canonical(fresh);
    assert.deepEqual(await fresh.recover(), { rolledBack: [], replayed: [], commits: [] });
    assert.equal((await next.apply(plan, { confirm: true })).commit, null);
    assert.deepEqual(await canonical(fresh), complete); await settled(fresh.root);
    assert.deepEqual(await integrity(f.source), sourceBefore); assert.equal(f.calls(), count);
  });
}

for (const boundary of ['ready', 'commit']) {
  test(`Wiki import recovery: cancellation at ${boundary} returns the actual durable capture receipt`, async t => {
    const f = await fixture(t), controller = new AbortController(), before = await canonical(f.caller), sourceBefore = await integrity(f.source);
    let actualReceipt: string | undefined;
    const commit = f.caller.git.commit.bind(f.caller.git);
    t.mock.method(f.caller.git, 'commit', async (...args: Parameters<typeof commit>) => {
      assert.equal(operationSignal(), undefined);
      if (boundary === 'ready') controller.abort();
      const result = await commit(...args); if (boundary === 'commit') controller.abort(); return result;
    });
    await assert.rejects(f.importer.apply(f.plan, { confirm: true, signal: controller.signal }), (error: any) => {
      assert.equal(error.code, 'OPERATION_CANCELLED'); assert.equal(error.safeDetails?.committed?.length, 1);
      assert.equal(error.safeDetails.committed[0].operation, 'capture'); actualReceipt = error.safeDetails.committed[0].commit; return true;
    });
    const head = await f.caller.git.run(['rev-parse', 'HEAD']); assert.notEqual(head, before.head);
    assert.equal(actualReceipt, head);
    assert.equal(await f.caller.git.run(['rev-list', '--count', `${before.head}..HEAD`]), '1');
    const retry = await f.importer.apply(f.plan, { confirm: true }); assert.equal(retry.duplicate, true); assert.equal(retry.commit, null);
    assert.deepEqual(await f.caller.wikiCatalog(), []); await settled(f.caller.root);
    assert.deepEqual(await integrity(f.source), sourceBefore);
  });
}

test('Wiki import recovery: cancellation during the actual destination writer wait removes only its contender', async t => {
  const f = await fixture(t), before = await canonical(f.caller), sourceBefore = await integrity(f.source);
  const acquired = deferred(), release = deferred(), controller = new AbortController(); let owner: Promise<void> | undefined;
  const capture = f.caller.captureWikiImport.bind(f.caller);
  t.mock.method(f.caller, 'captureWikiImport', async (...args: Parameters<typeof capture>) => {
    owner = withFileLock(join(f.caller.root, '.amem/write.lock'), async () => { acquired.resolve(); await release.promise; });
    await acquired.promise; return capture(...args);
  });
  const outcome = f.importer.apply(f.plan, { confirm: true, signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await acquired.promise;
    await until(async () => (await readdir(join(f.caller.root, '.amem/write.lock.queue'))).length === 2);
    controller.abort(); const result = await outcome; assert.ok('error' in result); assert.equal(result.error.code, 'OPERATION_CANCELLED');
    assert.equal(existsSync(join(f.caller.root, '.amem/write.lock')), true);
    assert.equal((await readdir(join(f.caller.root, '.amem/write.lock.queue'))).length, 1);
    assert.deepEqual(await canonical(f.caller), before);
  } finally { release.resolve(); await owner; await outcome; }
  assert.deepEqual(await integrity(f.source), sourceBefore); await settled(f.caller.root);
});

test('Wiki import recovery: opposite vault imports complete concurrently without holding source and destination locks together', { timeout: 15_000 }, async t => {
  const a = await sharedFixture(t), b = await sharedFixture(t);
  const configA = await a.source.config(), configB = await b.source.config();
  const pathA = join(a.source.root, '.amem/shared-opposite-import.json'), pathB = join(b.source.root, '.amem/shared-opposite-import.json');
  await writeFile(pathA, JSON.stringify({ version: 1, sources: [{ ...b.binding, readers: [{ id: a.source.principal.id, tenantId: configA.tenantId }] }] }));
  await writeFile(pathB, JSON.stringify({ version: 1, sources: [{ ...a.binding, readers: [{ id: b.source.principal.id, tenantId: configB.tenantId }] }] }));
  const importerA = new SharedWikiImporter(a.source, { configPath: pathA }), importerB = new SharedWikiImporter(b.source, { configPath: pathB });
  const [pa, pb] = await Promise.all([importerA.prepare({ ...b.input, expectedCommit: b.binding.commit }), importerB.prepare({ ...a.input, expectedCommit: a.binding.commit })]);
  const beforeA = await files(a.source.root), beforeB = await files(b.source.root);
  const headA = await a.source.git.run(['rev-parse', 'HEAD']), headB = await b.source.git.run(['rev-parse', 'HEAD']), countA = a.calls(), countB = b.calls();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  let result: Awaited<ReturnType<SharedWikiImporter['apply']>>[];
  try {
    result = await Promise.all([importerA.apply(pa.plan, { confirm: true, signal: controller.signal }), importerB.apply(pb.plan, { confirm: true, signal: controller.signal })]);
    assert.equal(controller.signal.aborted, false); assert.equal(result.every(copy => !!copy.commit && !copy.duplicate), true);
  } finally { clearTimeout(timer); controller.abort(); }
  for (const [vault, before, head, copy, plan] of [[a.source, beforeA, headA, result[0]!, pa.plan], [b.source, beforeB, headB, result[1]!, pb.plan]] as const) {
    assert.equal(await vault.git.run(['rev-list', '--count', `${head}..HEAD`]), '1');
    const after = await files(vault.root);
    for (const [path, bytes] of Object.entries(before)) if (path !== 'log.md') assert.equal(after[path], bytes, `${path} is unchanged`);
    const doc = await vault.get(copy.evidenceId);
    assert.deepEqual(readWikiImportArtifact(doc as unknown as { path: string; meta: EvidenceMeta; body: string }), plan.artifact);
    assert.equal((await vault.wikiCatalog()).some(page => page.key === pageKey), true); await settled(vault.root);
  }
  assert.equal(a.calls(), countA); assert.equal(b.calls(), countB);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function until(predicate: () => Promise<boolean>) {
  const end = performance.now() + 5000;
  while (!await predicate()) { assert.ok(performance.now() < end, 'Expected the actual destination queue contender'); await delay(10); }
}
