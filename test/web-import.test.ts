import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { cancellationError } from '../src/operation.js';
import { localAdminPrincipal } from '../src/policy.js';
import { MemoryVault } from '../src/vault.js';
import { createWebImportWorkflow, readWebImportPlan, serializeWebImportPlan } from '../src/web-import.js';
import type { WebSource } from '../src/web-source.js';

const urls = ['https://docs.example/atlas', 'https://docs.example/restore'];
function source(url: string, content = '\ufeff  <p>Atlas source</p>\n'): WebSource {
  return { url, finalUrl: url, mediaType: 'text/html', content,
    bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
}
async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/web-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(join(root, 'vault'), { masterKey: '74'.repeat(32) });
  await vault.initialize('web-import');
  let calls = 0;
  let transform = (url: string) => source(url);
  const workflow = createWebImportWorkflow(async url => { calls++; return transform(url); });
  return { root, vault, workflow, count: () => calls, reset: () => { calls = 0; }, set: (next: typeof transform) => { transform = next; } };
}

test('web import: preview hides bodies and exact source envelope preserves bytes without automatic approval', async t => {
  const { root, vault, workflow } = await fixture(t);
  const plan = await workflow.preview(urls);
  assert.equal(plan.documents.length, 2);
  assert.ok(!JSON.stringify(plan).includes('Atlas source'));
  const file = join(root, 'web-plan.json'); await writeFile(file, serializeWebImportPlan(plan));
  assert.deepEqual(await readWebImportPlan(file), plan);
  const result = await workflow.apply(vault, Object.fromEntries(Object.entries(plan).reverse()), { scope: 'public', sensitivity: 'public' });
  assert.equal(result.status, 'completed');
  const evidence = await vault.get(result.entries[0]!.result.evidenceId);
  const envelope = JSON.parse(evidence.body.slice(evidence.body.indexOf('\n\n') + 2));
  assert.equal(envelope.content, '\ufeff  <p>Atlas source</p>\n');
  assert.equal(envelope.bytes, Buffer.byteLength(envelope.content));
  assert.equal(envelope.sha256, createHash('sha256').update(Buffer.from(envelope.content)).digest('hex'));
  assert.equal(evidence.meta.sourceUri, urls[0]);
  assert.equal((await vault.listRecords({ collection: 'candidates' })).total, 0);
  assert.equal((await vault.wikiCatalog()).length, 0);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const retry = await workflow.apply(vault, plan, { scope: 'public', sensitivity: 'public' });
  assert.ok(retry.entries.every(item => item.result.duplicate && !item.result.commit));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('web import: body, target, type or manifest drift fails before any capture', async t => {
  const { vault, workflow, set, count, reset } = await fixture(t);
  const plan = await workflow.preview(urls);
  for (const transform of [
    (url: string) => source(url, 'changed'),
    (url: string) => ({ ...source(url), finalUrl: 'https://other.example/target' }),
    (url: string) => ({ ...source(url), mediaType: 'text/plain' }),
  ]) {
    set(transform);
    await assert.rejects(workflow.apply(vault, plan), /sources changed/);
    assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 0);
  }
  reset();
  for (const invalid of [{ ...plan, revision: '0'.repeat(64) }, { ...plan, extra: 'not allowed' },
    { ...plan, documents: [{ ...plan.documents[0]!, url: 'https://127.0.0.1/' }] }]) {
    await assert.rejects(workflow.apply(vault, invalid), { code: 'VALIDATION_FAILED' });
  }
  assert.equal(count(), 0);
});

test('web import: current tenant/write/scope/sensitivity authority is checked before network', async t => {
  const { vault, workflow, reset, count } = await fixture(t);
  const plan = await workflow.preview(urls); reset();
  const tenantId = (await vault.config()).tenantId;
  for (const principal of [
    { ...localAdminPrincipal(), tenantId, permissions: ['read'] as const },
    { ...localAdminPrincipal(), tenantId: 'foreign' },
    { ...localAdminPrincipal(), tenantId, scopes: ['public'] as const },
    { ...localAdminPrincipal(), tenantId, maxSensitivity: 'public' as const },
  ]) {
    const reader = new MemoryVault(vault.root, { principal: { ...principal, permissions: [...principal.permissions], scopes: [...principal.scopes] } });
    await assert.rejects(workflow.apply(reader, plan), { code: 'AUTHORIZATION_DENIED' });
  }
  assert.equal(count(), 0);
});

test('web import: limits and invalid UTF-8 provenance fail without writes', async t => {
  const { vault, workflow, set, reset, count } = await fixture(t);
  for (const input of [[], Array.from({ length: 21 }, (_, n) => `https://docs.example/${n}`),
    ['https://docs.example/a#first', 'https://DOCS.example:443/a#second']]) await assert.rejects(workflow.preview(input));
  assert.equal(count(), 0);
  for (const timeoutMs of [0, NaN, 30_001, 1.5]) await assert.rejects(workflow.preview(urls, { timeoutMs }));
  set(url => source(url, 'x'.repeat(1_000_000)));
  reset();
  await assert.rejects(workflow.preview(Array.from({ length: 6 }, (_, n) => `https://docs.example/${n}`)), { code: 'CONTENT_TOO_LARGE' });
  assert.equal(count(), 5);
  set(url => ({ ...source(url), sha256: '0'.repeat(64) }));
  await assert.rejects(workflow.preview(urls), /source bytes/);
  const contentLimit = (await vault.config()).limits.maxContentCharacters;
  set(url => source(url, 'x'.repeat(contentLimit)));
  const plan = await workflow.preview([urls[0]!]);
  await assert.rejects(workflow.apply(vault, plan), { code: 'CONTENT_TOO_LARGE' });
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 0);
});

test('web import: preflight cancellation saves nothing and capture retry resumes unchanged sources', async t => {
  const { vault, workflow } = await fixture(t);
  const controller = new AbortController();
  const waiting = createWebImportWorkflow((_url, options) => new Promise<WebSource>((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(cancellationError()), { once: true });
    queueMicrotask(() => controller.abort());
  }));
  const plan = await workflow.preview(urls);
  await assert.rejects(waiting.apply(vault, plan, { signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 0);
  const stopping = new AbortController();
  const partial = await workflow.apply(vault, plan, { signal: stopping.signal, onProgress: async () => { await Promise.resolve(); stopping.abort(); } });
  assert.equal(partial.status, 'cancelled'); assert.equal(partial.entries.length, 1);
  const retry = await workflow.apply(vault, plan);
  assert.equal(retry.status, 'completed'); assert.equal(retry.entries[0]!.result.duplicate, true); assert.equal(retry.entries[1]!.result.duplicate, false);
});

test('web import: encryption and appended source history remain authoritative', async t => {
  const { vault, workflow, set } = await fixture(t);
  const plan = await workflow.preview([urls[0]!]);
  const initial = await workflow.apply(vault, plan, { scope: 'user', sensitivity: 'secret' });
  const stored = await readFile(join(vault.root, initial.entries[0]!.result.evidencePath), 'utf8');
  assert.ok(!stored.includes('Atlas source') && !stored.includes(urls[0]!));
  set(url => source(url, 'A new document version.'));
  const updated = await workflow.preview([urls[0]!]);
  await workflow.apply(vault, updated, { scope: 'user', sensitivity: 'secret' });
  assert.equal((await vault.sourceTimeline(urls[0]!, { includeSecret: true })).total, 2);
  assert.equal((await new MemoryVault(vault.root, { masterKey: '' }).sourceTimeline(urls[0]!)).total, 0);
});

test('web import CLI: private URL refusal does not create a vault or bypass through ambient proxy variables', async t => {
  const { root } = await fixture(t);
  await assert.rejects(promisify(execFile)(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'import', 'web-preview', 'https://127.0.0.1/', '--root', join(root, 'absent')],
    { env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' } }),
  (error: unknown) => /VALIDATION_FAILED/.test(String((error as { stderr?: string }).stderr)));
  await assert.rejects(stat(join(root, 'absent')), { code: 'ENOENT' });
});
