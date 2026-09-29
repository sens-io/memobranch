import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dns from 'node:dns';
import type { Server } from 'node:http';
import { test, type TestContext } from 'node:test';
import { MemoryVault } from '../src/vault.js';
import { MaintenanceService } from '../src/maintenance.js';
import { operationSignal } from '../src/operation.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-maintenance-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root);
  await vault.initialize('maintenance-lifecycle');
  const service = new MaintenanceService(vault);
  return { vault, service, root };
}

test('maintenance stop aborts only its own cycle and starts no subsequent mutation', async t => {
  const { vault, service } = await fixture(t);
  const entered = deferred(), release = deferred();
  let signal: AbortSignal | undefined;
  let expired = false, globalCancellation = false;
  const recover = vault.recover.bind(vault);
  vault.recover = async () => { signal = operationSignal(); entered.resolve(); await release.promise; return recover(); };
  vault.expireDue = async () => { expired = true; return { expired: [], commit: null }; };
  vault.llm.cancelPending = () => { globalCancellation = true; };
  const pending = service.runOnce();
  const rejected = assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
  await entered.promise;
  const stop = service.stop();
  assert.equal(signal?.aborted, true);
  release.resolve();
  await Promise.all([stop, rejected]);
  assert.equal(expired, false);
  assert.equal(globalCancellation, false);
  await assert.rejects(service.runOnce(), { code: 'OPERATION_CANCELLED' });
  await service.stop();
});

test('maintenance retains lease until protected in-flight recovery settles', async t => {
  const { vault, service, root } = await fixture(t);
  await service.start();
  const entered = deferred(), release = deferred();
  const recovered = await vault.recover();
  vault.recover = async () => { entered.resolve(); await release.promise; return recovered; };
  const pending = service.runOnce();
  const rejected = assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
  await entered.promise;
  const stop = service.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(JSON.parse(await readFile(join(root, '.amem/service.json'), 'utf8')).ownerToken);
  const other = new MaintenanceService(new MemoryVault(root));
  await assert.rejects(other.start(), { code: 'LOCK_TIMEOUT' });
  release.resolve();
  await Promise.all([stop, rejected]);
  await assert.rejects(readFile(join(root, '.amem/service.json')), { code: 'ENOENT' });
  const next = new MaintenanceService(new MemoryVault(root));
  const handle = await next.start();
  await handle.stop();
});

test('maintenance shutdown waits for pending localhost bind and closes late listeners', async t => {
  const { service, root } = await fixture(t);
  const entered = deferred(), release = deferred();
  const original = dns.lookup;
  dns.lookup = ((...args: unknown[]) => {
    entered.resolve();
    void release.promise.then(() => Reflect.apply(original, dns, args));
  }) as typeof dns.lookup;
  const internals = service as unknown as { server: Server | null; timer: unknown; watchers: unknown[] };
  t.after(async () => { dns.lookup = original; release.resolve(); await service.stop(); });
  const starting = service.start({ host: 'localhost' });
  const rejected = assert.rejects(starting, { code: 'OPERATION_CANCELLED' });
  await entered.promise;
  const server = internals.server!;
  let stopped = false;
  const stopping = service.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.ok(JSON.parse(await readFile(join(root, '.amem/service.json'), 'utf8')).ownerToken);
  dns.lookup = original;
  release.resolve();
  await Promise.all([stopping, rejected]);
  assert.equal(server.listening, false);
  assert.equal(internals.server, null);
  assert.equal(internals.timer, null);
  assert.deepEqual(internals.watchers, []);
  await assert.rejects(readFile(join(root, '.amem/service.json')), { code: 'ENOENT' });
  await service.stop();
  assert.equal(server.listening, false);
});
