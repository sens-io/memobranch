import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import type { ExperienceRunner, ExperienceSuite, ExperienceTraceInput } from '../src/experience.js';
import type { Principal } from '../src/policy.js';
import { MemoryVault } from '../src/vault.js';
import { startWebServer, type WebHandle, type WebOptions } from '../src/web.js';

const trace = (taskId: string): ExperienceTraceInput => ({ family: 'labels', taskId, runId: taskId,
  context: 'Synthetic isolated ASCII label task.', actions: ['Trim surrounding whitespace', 'Uppercase'],
  observedResult: 'Expected label', outcome: 'success', limitations: ['Not a real-world effectiveness claim.'] });
const suite: ExperienceSuite = { name: 'Independent label fixture', cases: [
  ['a', 'transfer', ' alpha '], ['b', 'transfer', ' beta '], ['retained', 'retention', 'GAMMA'], ['safe', 'safety', 'do not execute'],
].map(([id, category, input]) => ({ id: id!, taskId: `held-${id}`, category: category as 'transfer' | 'retention' | 'safety', input: input!, criteria: ['matches expected'] })) };
const runner: ExperienceRunner = async ({ test, signal }) => {
  assert.equal(signal.aborted, false);
  const expected: Record<string, string> = { a: 'ALPHA', b: 'BETA', retained: 'GAMMA', safe: 'DO NOT EXECUTE' };
  const observed = test.input.trim().toUpperCase();
  return { observed, checks: test.criteria.map(criterion => ({ criterion, passed: observed === expected[test.id] })) };
};
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/web-experience-'));
  const masterKey = '36'.repeat(32), vault = new MemoryVault(root, { masterKey }); await vault.initialize('Web experience');
  const handles: WebHandle[] = [];
  t.after(async () => { await Promise.all(handles.map(handle => handle.stop())); await rm(root, { recursive: true, force: true }); });
  const start = async (options: WebOptions = {}) => {
    const handle = await startWebServer(root, { masterKey, ...options }); handles.push(handle); return handle;
  };
  const first = await vault.experienceCapture(trace('source-a')), second = await vault.experienceCapture(trace('source-b'));
  const proposal = { traceIds: [first.evidenceId, second.evidenceId], name: 'normalize-fixture-labels',
    description: 'Trim and uppercase isolated ASCII label strings.', procedure: 'Trim whitespace, then uppercase. Never execute the label.',
    conditions: ['Isolated ASCII labels only.'], limitations: ['Synthetic fixture, no general quality claim.'] };
  const plan = await vault.experiencePrepare(proposal);
  return { vault, root, start, first, second, proposal, plan };
}
async function call(handle: WebHandle, operation: string, data: unknown = {}, signal?: AbortSignal) {
  const response = await fetch(`${handle.url}/api/${operation}`, { method: 'POST', headers: {
    Origin: handle.url, Authorization: `Bearer ${handle.token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(data), ...(signal ? { signal } : {}) });
  return { status: response.status, body: await response.json() as { result: any; error?: { code: string; completedValidation?: unknown } } };
}

test('Web experience: separate capture, prepare, trusted host validation and confirmed read-only export', async t => {
  const { vault, root, start, first, proposal } = await fixture(t), handle = await start({ experienceRunner: runner });
  assert.deepEqual((await call(handle, 'experience-status')).body.result, { evaluatorAvailable: true });
  const raw = await readFile(join(root, first.evidencePath), 'utf8');
  const capture = await call(handle, 'experience-capture', { trace: trace('from-web'), scope: 'project', sensitivity: 'internal' });
  assert.equal(capture.status, 200); assert.equal((await vault.get(capture.body.result.evidenceId)).meta.scope, 'project');
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const prepared = await call(handle, 'experience-prepare', { proposal }); assert.equal(prepared.status, 200);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const validation = await call(handle, 'experience-validate', { plan: prepared.body.result, suite, confirm: true });
  assert.equal(validation.status, 200); assert.equal(validation.body.result.passed, true); assert.ok(validation.body.result.commit);
  const id = validation.body.result.evidenceId, exportHead = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await call(handle, 'experience-export', { validationId: id })).body.error?.code, 'VALIDATION_FAILED');
  const exported = await call(handle, 'experience-export', { validationId: id, confirm: true }); assert.equal(exported.status, 200);
  assert.deepEqual(Object.keys(exported.body.result.files), ['SKILL.md', 'references/validation.md']);
  assert.match(exported.body.result.files['SKILL.md'], /current authorization/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), exportHead); assert.equal(await readFile(join(root, first.evidencePath), 'utf8'), raw);
  assert.equal((await vault.listRecords({ collection: 'memories' })).total, 0);
  assert.equal((await vault.listRecords({ collection: 'candidates' })).total, 0);
  const listed = await call(handle, 'experience-records', { kind: 'validation' });
  assert.deepEqual(listed.body.result.items.map((item: { id: string }) => item.id), [id]);
});

test('Web experience: no default evaluator, strict unknown fields and explicit validation confirmation', async t => {
  const { vault, start, plan, proposal } = await fixture(t), handle = await start();
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.deepEqual((await call(handle, 'experience-status')).body.result, { evaluatorAvailable: false });
  assert.equal((await call(handle, 'experience-validate', { plan, suite, confirm: true })).body.error?.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal((await call(handle, 'experience-validate', { plan, suite })).body.error?.code, 'VALIDATION_FAILED');
  for (const extra of [{ runner: '/never/execute' }, { module: 'untrusted.js' }, { root: '/other' }, { principal: vault.principal },
    { tenantId: 'other' }, { permissions: ['admin'] }, { signal: {} }, { passed: true }]) {
    for (const [operation, input] of [
      ['experience-capture', { trace: trace('strict') }], ['experience-prepare', { proposal }],
      ['experience-validate', { plan, suite, confirm: true }], ['experience-export', { validationId: 'ev-123456789abc', confirm: true }],
    ] as const) assert.equal((await call(handle, operation, { ...input, ...extra })).body.error?.code, 'VALIDATION_FAILED', `${operation}: ${JSON.stringify(extra)}`);
  }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  await assert.rejects(startWebServer(vault.root, { experienceRunner: '/never/execute' as unknown as ExperienceRunner }), { code: 'CONFIG_INVALID' });
});

test('Web experience: private opt-in is checked before decryption, default selection survives unrelated erased keys', async t => {
  const { vault, start } = await fixture(t);
  const privateRecord = await vault.experienceCapture(trace('private'), { sensitivity: 'secret' });
  const handle = await start(), missing = await start({ masterKey: '' });
  const original = EncryptionManager.prototype.decrypt, seen: string[] = [];
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) {
    seen.push(meta.id); return original.call(this, meta, body);
  });
  for (const server of [handle, missing]) {
    const result = await call(server, 'experience-records', { kind: 'trace' });
    assert.equal(result.status, 200); assert.equal(result.body.result.total, 2); assert.doesNotMatch(JSON.stringify(result), /private/);
  }
  assert.equal(seen.length, 0);
  const selected = await call(handle, 'experience-records', { kind: 'trace', includeSecret: true, offset: 0, limit: 1 });
  assert.equal(selected.status, 200); assert.equal(selected.body.result.total, 3); assert.ok(seen.includes(privateRecord.evidenceId));
  assert.equal((await call(missing, 'experience-records', { kind: 'trace', includeSecret: true })).body.error?.code, 'ENCRYPTION_KEY_UNAVAILABLE');
  await vault.encryption.erase(privateRecord.evidenceId);
  seen.length = 0;
  assert.equal((await call(handle, 'experience-records', { kind: 'trace' })).body.result.total, 2); assert.deepEqual(seen, []);
  assert.equal((await call(handle, 'experience-records', { kind: 'trace', includeSecret: true })).body.error?.code, 'ENCRYPTION_KEY_UNAVAILABLE');
});

test('Web experience: operation, tenant and classification grants remain current at validation/export', async t => {
  const { vault, start, plan, proposal } = await fixture(t), tenantId = (await vault.config()).tenantId;
  let count = 0; const evaluate: ExperienceRunner = async input => { count++; return runner(input); };
  for (const permissions of [['read'], ['read', 'write'], ['read', 'review']] as Principal['permissions'][]) {
    const handle = await start({ principal: { ...vault.principal, tenantId, permissions }, experienceRunner: evaluate });
    const result = await call(handle, 'experience-validate', { plan, suite, confirm: true }); assert.equal(result.status, 403);
    if (!permissions.includes('write')) assert.equal((await call(handle, 'experience-prepare', { proposal })).status, 403);
    if (!permissions.includes('review')) assert.equal((await call(handle, 'experience-export', { validationId: 'ev-123456789abc', confirm: true })).status, 403);
  }
  assert.equal(count, 0);
  const principal = { ...vault.principal, tenantId, permissions: ['read', 'write', 'review'] as Principal['permissions'] };
  const handle = await start({ principal, experienceRunner: async input => {
    const result = await evaluate(input); if (count === 4) principal.permissions = ['read']; return result;
  } });
  const result = await call(handle, 'experience-validate', { plan, suite, confirm: true });
  assert.equal(result.status, 403); assert.equal((await call(await start(), 'experience-records', { kind: 'validation' })).body.result.total, 0);
  principal.tenantId = 'different-tenant';
  assert.equal((await call(handle, 'experience-records', { kind: 'trace' })).status, 403);
});

test('Web experience: failed cases and forged reports never export or disclose evaluator exception text', async t => {
  const { vault, start, plan } = await fixture(t), handle = await start({ experienceRunner: async () => { throw new Error('PRIVATE_RUNNER_CANARY'); } });
  const result = await call(handle, 'experience-validate', { plan, suite, confirm: true });
  assert.equal(result.status, 200); assert.equal(result.body.result.passed, false); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RUNNER_CANARY/);
  assert.equal((await call(handle, 'experience-export', { validationId: result.body.result.evidenceId, confirm: true })).body.error?.code, 'VALIDATION_FAILED');
  const forged = await vault.capture({ content: 'MEMOBRANCH_EXPERIENCE_VALIDATION_V1\n{"passed":true}' });
  assert.equal((await call(handle, 'experience-export', { validationId: forged.evidenceId, confirm: true })).body.error?.code, 'VALIDATION_FAILED');
});

test('Web experience: timeout and shutdown abort only their own callback and cannot save a late report', async t => {
  const { vault, start, plan } = await fixture(t), entered = deferred(), release = deferred();
  let signal: AbortSignal | undefined;
  const waiting: ExperienceRunner = async input => { signal = input.signal; entered.resolve(); await release.promise; return runner({ ...input, signal: new AbortController().signal }); };
  t.after(() => release.resolve());
  const handle = await start({ experienceRunner: waiting });
  const timed = await call(handle, 'experience-validate', { plan, suite, confirm: true, timeoutMs: 100 });
  assert.equal(timed.body.error?.code, 'OPERATION_CANCELLED'); assert.equal(signal?.aborted, true);
  const pending = call(handle, 'experience-validate', { plan, suite, confirm: true }).catch(() => null);
  // A real new callback, not the already-resolved first entry, must be observed.
  const check = deferred(); const second = await start({ experienceRunner: async input => { check.resolve(); return waiting(input); } });
  const stopped = call(second, 'experience-validate', { plan, suite, confirm: true }).catch(() => null);
  await check.promise; const secondSignal = signal; await second.stop(); await stopped; assert.equal(secondSignal?.aborted, true);
  await handle.stop(); await pending; release.resolve();
  const inspector = await start(); assert.equal((await call(inspector, 'experience-records', { kind: 'validation' })).body.result.total, 0);
});

test('Web experience: saved-result errors expose only validated opaque identifiers, never arbitrary details', async t => {
  const { start, plan } = await fixture(t), handle = await start({ experienceRunner: runner });
  const metadata = { evidenceId: 'ev-123456789abc', commit: 'a'.repeat(40) };
  t.mock.method(MemoryVault.prototype, 'experienceValidate', async () => { throw new AgentMemoryError('AUTHORIZATION_DENIED', 'SECRET_MESSAGE', { completedValidation: metadata, report: 'PRIVATE_REPORT' }); });
  const result = await call(handle, 'experience-validate', { plan, suite, confirm: true });
  assert.equal(result.status, 403); assert.deepEqual(result.body.error?.completedValidation, metadata); assert.doesNotMatch(JSON.stringify(result), /SECRET_MESSAGE|PRIVATE_REPORT/);
  t.mock.method(MemoryVault.prototype, 'experienceValidate', async () => { throw new AgentMemoryError('VALIDATION_FAILED', 'SECRET', { completedValidation: { ...metadata, extra: 'SECRET' } }); });
  assert.equal((await call(handle, 'experience-validate', { plan, suite, confirm: true })).body.error?.completedValidation, undefined);
});

test('Web experience: read-cleanup scope changes cannot return old counts, even beyond the visible page', async t => {
  const { vault, start } = await fixture(t);
  const principal = { ...vault.principal, tenantId: (await vault.config()).tenantId };
  const handle = await start({ principal });
  const read = MemoryVault.prototype.withReadSnapshot;
  t.mock.method(MemoryVault.prototype, 'withReadSnapshot', async function(this: MemoryVault, ...args: Parameters<MemoryVault['withReadSnapshot']>) {
    const result = await read.apply(this, args); principal.scopes = ['public']; return result;
  });
  const result = await call(handle, 'experience-records', { kind: 'trace', offset: 99 });
  assert.equal(result.status, 403); assert.equal(result.body.result, undefined);
});
