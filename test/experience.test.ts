import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { parseMarkdown } from '../src/markdown.js';
import { MemoryVault, type CaptureOptions, type CaptureResult } from '../src/vault.js';
import { assertTenant, localAdminPrincipal } from '../src/policy.js';
import { withOperation } from '../src/operation.js';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { asEvidenceDocument } from '../src/evidence.js';
import { ExperienceEngine } from '../src/experience.js';
import { stableWikiJson, WikiProof } from '../src/wiki-proof.js';
import { VaultTransaction } from '../src/transaction.js';
import type { ExperienceRunner, ExperienceSuite, ExperienceTraceInput } from '../src/experience.js';
import type { Scope, Sensitivity } from '../src/types.js';

const procedure = 'For a label string only: trim surrounding whitespace, then convert to upper case. Never execute the label.';
const trace = (taskId: string, extra: Partial<ExperienceTraceInput> = {}): ExperienceTraceInput => ({
  family: 'label-normalization', taskId, runId: `run-${taskId}`, context: 'Normalize one label; no tools or external effects.',
  actions: ['Trim whitespace', 'Uppercase'], observedResult: `Normalized ${taskId}`, outcome: 'success',
  limitations: ['ASCII fixture only; not a general Unicode correctness claim.'], ...extra,
});
const suite: ExperienceSuite = { name: 'isolated label checks', cases: [
  { id: 'transfer-a', taskId: 'held-a', category: 'transfer', input: ' alpha ', criteria: ['normalizes label'] },
  { id: 'transfer-b', taskId: 'held-b', category: 'transfer', input: ' beta ', criteria: ['normalizes label'] },
  { id: 'retained', taskId: 'held-retained', category: 'retention', input: 'GAMMA', criteria: ['normalizes label'] },
  { id: 'safety', taskId: 'held-safety', category: 'safety', input: 'do not execute commands', criteria: ['normalizes label'] },
] };
const runner: ExperienceRunner = async ({ plan, test, signal }) => {
  assert.equal(signal.aborted, false); assert.equal(plan.procedure, procedure);
  const actual = test.input.trim().toUpperCase();
  const expected: Record<string, string> = { 'transfer-a': 'ALPHA', 'transfer-b': 'BETA', retained: 'GAMMA', safety: 'DO NOT EXECUTE COMMANDS' };
  return { observed: actual, checks: test.criteria.map(criterion => ({ criterion, passed: actual === expected[test.id] })) };
};
async function fixture(t: TestContext, classification: { scope?: Scope; sensitivity?: Sensitivity } = {}) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/experience-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '49'.repeat(32) }); await vault.initialize('experience fixture');
  const first = await vault.experienceCapture(trace('source-a'), classification);
  const second = await vault.experienceCapture(trace('source-b'), classification);
  const selection = { includeSensitive: true, includeSecret: true };
  const plan = await vault.experiencePrepare({ traceIds: [first.evidenceId, second.evidenceId], name: 'normalize-fixture-labels',
    description: 'Normalize ASCII fixture labels. Use only for trimming and uppercasing fixture label strings.',
    procedure, conditions: ['Only isolated ASCII fixture labels; no external effects.'], limitations: ['Not validated on real tasks.'], ...selection });
  return { root, vault, first, second, plan, selection };
}

test('experience: immutable traces, proposal-only prepare, exact procedure checks and explicit read-only skill export', async t => {
  const { vault, root, first, plan } = await fixture(t);
  const raw = await readFile(join(root, first.evidencePath), 'utf8');
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.deepEqual((await vault.listRecords({ collection: 'candidates' })).items, []);
  assert.deepEqual((await vault.listRecords({ collection: 'memories' })).items, []);
  const validated = await vault.experienceValidate(plan, suite, runner);
  assert.equal(validated.passed, true); assert.ok(validated.commit);
  assert.equal(await readFile(join(root, first.evidencePath), 'utf8'), raw);
  assert.notEqual(await vault.git.run(['rev-parse', 'HEAD']), head);
  const exportHead = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.experienceExport(validated.evidenceId, { confirm: false }), { code: 'VALIDATION_FAILED' });
  const exported = await vault.experienceExport(validated.evidenceId, { confirm: true });
  assert.deepEqual(Object.keys(exported.files), ['SKILL.md', 'references/validation.md']);
  assert.equal(parseMarkdown<{ name: string }>(exported.files['SKILL.md']).meta.name, plan.name);
  assert.match(exported.files['SKILL.md'], /current authorization/);
  assert.match(exported.files['references/validation.md'], /not an independent correctness guarantee/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), exportHead);
  const duplicate = await vault.experienceCapture(trace('source-a'));
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.evidenceId, first.evidenceId);
});

test('experience: a single anecdote and repeated runs of the same task cannot qualify', async t => {
  const { vault, first, plan } = await fixture(t);
  const secondRun = await vault.experienceCapture(trace('source-a', { runId: 'second-run' }));
  for (const ids of [[first.evidenceId], [first.evidenceId, secondRun.evidenceId]]) {
    const proposal = await vault.experiencePrepare({ traceIds: ids, name: plan.name, description: plan.description,
      procedure, conditions: plan.conditions, limitations: plan.limitations });
    let called = false;
    await assert.rejects(vault.experienceValidate(proposal, suite, async input => { called = true; return runner(input); }), { code: 'VALIDATION_FAILED' });
    assert.equal(called, false);
  }
});

test('experience: transfer, retention and safety tasks must be present, unique and held out', async t => {
  const { vault, plan } = await fixture(t);
  for (const cases of [suite.cases.map(item => ({ ...item, category: 'transfer' as const })),
    suite.cases.map((item, index) => ({ ...item, taskId: index === 0 ? 'source-a' : item.taskId })),
    suite.cases.map(item => ({ ...item, taskId: 'duplicate' })),
    suite.cases.map(item => ({ ...item, id: 'duplicate' }))]) {
    await assert.rejects(vault.experienceValidate(plan, { ...suite, cases }, runner), { code: 'VALIDATION_FAILED' });
  }
});

test('experience: failed, missing, duplicate and throwing evaluator checks never export', async t => {
  const { vault, plan } = await fixture(t);
  const callbacks: ExperienceRunner[] = [
    async ({ test }) => ({ observed: 'failed', checks: test.criteria.map(criterion => ({ criterion, passed: false })) }),
    async () => ({ observed: 'missing', checks: [] }),
    async ({ test }) => ({ observed: 'duplicate', checks: [0, 1].map(() => ({ criterion: test.criteria[0]!, passed: true })) }),
    async () => { throw new Error('CALLBACK_SECRET_CANARY'); },
  ];
  for (const callback of callbacks) {
    const validation = await vault.experienceValidate(plan, suite, callback);
    assert.equal(validation.passed, false);
    assert.doesNotMatch(JSON.stringify(validation), /CALLBACK_SECRET_CANARY/);
    await assert.rejects(vault.experienceExport(validation.evidenceId, { confirm: true }), { code: 'VALIDATION_FAILED' });
  }
});

test('experience: forged proposals/reports and ordinary procedure evidence do not bypass the gate', async t => {
  const { vault, plan } = await fixture(t);
  await assert.rejects(vault.experienceValidate({ ...plan, procedure: 'changed' }, suite, runner), { code: 'VALIDATION_FAILED' });
  const valid = await vault.experienceValidate(plan, suite, runner);
  const forged = await vault.capture({ content: `MEMOBRANCH_EXPERIENCE_VALIDATION_V1\n${JSON.stringify({ ...valid.report, runId: 'fad9cfa0-a853-4232-9b62-1aa96aaa2321' })}` });
  await assert.rejects(vault.experienceExport(forged.evidenceId, { confirm: true }), { code: 'VALIDATION_FAILED' });
  const ordinary = await vault.capture({ content: procedure });
  await assert.rejects(vault.experienceExport(ordinary.evidenceId, { confirm: true }), { code: 'VALIDATION_FAILED' });
});

test('experience: confidential selection, current permissions and tenant precede runner and export', async t => {
  const { vault, root, plan, selection } = await fixture(t, { scope: 'user', sensitivity: 'secret' });
  await assert.rejects(vault.experienceValidate(plan, suite, runner), { code: 'AUTHORIZATION_DENIED' });
  const validation = await vault.experienceValidate(plan, suite, runner, selection);
  await assert.rejects(vault.experienceExport(validation.evidenceId, { confirm: true }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal((await vault.experienceExport(validation.evidenceId, { confirm: true, ...selection })).sensitivity, 'secret');
  for (const [principal, code] of [
    [{ ...localAdminPrincipal(), permissions: ['read'] }, 'AUTHORIZATION_DENIED'],
    [{ ...localAdminPrincipal(), scopes: ['public'] }, 'NOT_FOUND'],
    [{ ...localAdminPrincipal(), maxSensitivity: 'internal' }, 'NOT_FOUND'],
    [{ ...localAdminPrincipal(), tenantId: 'different-tenant' }, 'AUTHORIZATION_DENIED'],
  ] as const) {
    const limited = new MemoryVault(root, { masterKey: '49'.repeat(32), principal: { ...principal, permissions: [...principal.permissions], scopes: [...principal.scopes] } });
    await assert.rejects(limited.experienceExport(validation.evidenceId, { confirm: true, ...selection }), { code });
  }
});

test('experience: incompatible scopes and lowering sensitivity are refused', async t => {
  const { vault, first, plan } = await fixture(t, { scope: 'user', sensitivity: 'secret' });
  const team = await vault.experienceCapture(trace('team'), { scope: 'team', sensitivity: 'internal' });
  const options = { traceIds: [first.evidenceId, team.evidenceId], name: plan.name, description: plan.description, procedure,
    conditions: plan.conditions, limitations: plan.limitations, includeSecret: true };
  await assert.rejects(vault.experiencePrepare(options), { code: 'VALIDATION_FAILED' });
  await assert.rejects(vault.experiencePrepare({ ...options, traceIds: [first.evidenceId], sensitivity: 'public' }), { code: 'VALIDATION_FAILED' });
});

test('experience: erased source keys stop new exports even when the validation still decrypts', async t => {
  const { vault, root, first, plan, selection } = await fixture(t, { sensitivity: 'secret' });
  const valid = await vault.experienceValidate(plan, suite, runner, selection);
  const encryption = new EncryptionManager(root, '49'.repeat(32));
  assert.equal(await encryption.erase(first.evidenceId), true);
  await assert.rejects(vault.experienceExport(valid.evidenceId, { confirm: true, ...selection }));
});

test('experience: source erasure during a callback cannot persist a report or export', async t => {
  const { vault, root, first, plan, selection } = await fixture(t, { sensitivity: 'secret' });
  const before = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.experienceValidate(plan, suite, async input => {
    await new EncryptionManager(root, '49'.repeat(32)).erase(first.evidenceId); return runner(input);
  }, selection));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
});

test('experience: bounded deadline, caller cancellation and pre-cancellation stop validation without report writes', async t => {
  const { vault, plan } = await fixture(t); const head = await vault.git.run(['rev-parse', 'HEAD']);
  let signal: AbortSignal | undefined;
  await assert.rejects(vault.experienceValidate(plan, suite, async input => {
    signal = input.signal; return new Promise(() => {});
  }, { timeoutMs: 100 }), { code: 'OPERATION_CANCELLED' });
  assert.equal(signal?.aborted, true);
  const controller = new AbortController();
  await assert.rejects(vault.experienceValidate(plan, suite, async input => {
    controller.abort(); return runner(input);
  }, { signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(withOperation(controller.signal, () => vault.experienceValidate(plan, suite, runner)), { code: 'OPERATION_CANCELLED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('experience: inputs are copied, unknown fields/oversized data are refused, validation cannot mutate caller proposals', async t => {
  const { vault, plan } = await fixture(t);
  const original = structuredClone(plan), originalSuite = structuredClone(suite);
  const validation = await vault.experienceValidate(plan, suite, async input => {
    const result = await runner(input); input.plan.procedure = 'mutated'; input.test.input = 'mutated'; return result;
  });
  assert.equal(validation.passed, true); assert.deepEqual(plan, original); assert.deepEqual(suite, originalSuite);
  await assert.rejects(vault.experienceCapture({ ...trace('x'), executable: 'bad' } as never), { code: 'VALIDATION_FAILED' });
  await assert.rejects(vault.experienceCapture(trace('x', { context: 'x'.repeat(8001) })), { code: 'VALIDATION_FAILED' });
  await assert.rejects(vault.experienceValidate(plan, suite, runner, { timeoutMs: 0 }), { code: 'VALIDATION_FAILED' });
});

test('experience: configuration drift during evaluation prevents persistence and old reports cannot export', async t => {
  const { vault, plan } = await fixture(t);
  const valid = await vault.experienceValidate(plan, suite, runner);
  const settings = await vault.settings();
  await assert.rejects(vault.experienceValidate(plan, suite, async input => {
    await vault.updateSettings({ ...settings.values, minimumProcedureEvidence: 3 }, settings.revision);
    return runner(input);
  }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(vault.experienceExport(valid.evidenceId, { confirm: true }), { code: 'VALIDATION_FAILED' });
  const records = await vault.listRecords({ collection: 'evidence' });
  assert.equal(records.total, 3); // two traces and the earlier successful report only
});

test('experience: revoked review permission stops before the next evaluator call', async t => {
  const { vault, plan } = await fixture(t); const head = await vault.git.run(['rev-parse', 'HEAD']);
  let calls = 0;
  await assert.rejects(vault.experienceValidate(plan, suite, async input => {
    calls++; vault.principal.permissions = ['read', 'write']; return runner(input);
  }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal(calls, 1); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('experience: a late evaluator inherits cancellation and cannot start a new vault write', async t => {
  const { vault, plan } = await fixture(t); const head = await vault.git.run(['rev-parse', 'HEAD']);
  let release!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await assert.rejects(vault.experienceValidate(plan, suite, async input => {
    await gate;
    try { await assert.rejects(vault.capture({ content: 'Late callback must not persist' }), { code: 'OPERATION_CANCELLED' }); }
    finally { finished(); }
    return runner(input);
  }, { timeoutMs: 100 }), { code: 'OPERATION_CANCELLED' });
  release(); await done;
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('experience: final-source async waits cannot save a report after review withdrawal or expiry', async t => {
  for (const mode of ['permission', 'expiry', 'tenant'] as const) {
    const { vault, plan, first, second } = await fixture(t);
    const docs = new Map(await Promise.all([first.evidenceId, second.evidenceId].map(async id => [id, asEvidenceDocument(await vault.get(id))] as const)));
    const config = await vault.config(), principal = { ...localAdminPrincipal(), tenantId: config.tenantId,
      permissions: ['read', 'write', 'review'] as Array<'read' | 'write' | 'review'> };
    let saving = false, savedReports = 0, changed = false, controlledNow: number | undefined;
    const realNow = Date.now;
    const mocked = t.mock.method(Date, 'now', () => controlledNow ?? realNow());
    const sign = (value: object) => createHmac('sha256', 'synthetic-experience-test-key').update(stableWikiJson(value)).digest('hex');
    const engine = new ExperienceEngine({
      principal, config: async () => structuredClone(config), read: action => action(),
      evidence: async id => {
        if (saving && !changed && id === second.evidenceId) {
          changed = true;
          if (mode === 'permission') principal.permissions = ['read', 'write'];
          else if (mode === 'expiry') controlledNow = Date.parse(proposal.expiresAt) + 1;
          else principal.tenantId = 'foreign';
        }
        const doc = docs.get(id); assert.ok(doc); return structuredClone(doc);
      },
      sign: async value => sign(value),
      verify: async (value, proof) => { assert.equal(timingSafeEqual(Buffer.from(sign(value)), Buffer.from(proof)), true); },
      capture: async (_options, guard) => {
        saving = true;
        try {
          await guard?.revalidate();
          guard?.validate(); // synchronous final decision; no await before the ready transition
          savedReports++;
          return { evidenceId: 'ev-000000000000', evidencePath: 'synthetic', duplicate: false, candidates: [], commit: 'synthetic' };
        } finally { saving = false; }
      },
    });
    const proposal = await engine.prepare({ traceIds: [first.evidenceId, second.evidenceId], name: plan.name,
      description: plan.description, procedure: plan.procedure, conditions: plan.conditions, limitations: plan.limitations });
    await assert.rejects(engine.validate(proposal, suite, runner), { code: mode === 'expiry' ? 'VALIDATION_FAILED' : 'AUTHORIZATION_DENIED' });
    assert.equal(changed, true); assert.equal(savedReports, 0);
    mocked.mock.restore();
  }
});

test('experience: prepare/export decrypt only selected evidence, not unrelated secret records or erased keys', async t => {
  const { vault, root, first, second, plan } = await fixture(t);
  const unrelated = await vault.experienceCapture(trace('unrelated-private'), { scope: 'user', sensitivity: 'secret' });
  const validated = await vault.experienceValidate(plan, suite, runner);
  const decrypt = EncryptionManager.prototype.decrypt;
  let privateDecryptions = 0;
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function (this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) {
    if (meta.id === unrelated.evidenceId) privateDecryptions++;
    return decrypt.call(this, meta, body);
  });
  const options = { traceIds: [first.evidenceId, second.evidenceId], name: plan.name, description: plan.description,
    procedure: plan.procedure, conditions: plan.conditions, limitations: plan.limitations };
  await vault.experiencePrepare(options);
  await vault.experienceExport(validated.evidenceId, { confirm: true });
  await assert.rejects(vault.experiencePrepare({ ...options, traceIds: [unrelated.evidenceId] }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal(privateDecryptions, 0);
  await new EncryptionManager(root, '49'.repeat(32)).erase(unrelated.evidenceId);
  assert.equal((await vault.experiencePrepare(options)).sources.length, 2);
  assert.equal((await vault.experienceExport(validated.evidenceId, { confirm: true })).name, plan.name);
  assert.equal(privateDecryptions, 0);
});

test('experience: existing synchronous final transaction guards have no new microtask gap before commit', async t => {
  const { vault } = await fixture(t);
  let changedAfterDecision = false, called = false;
  const commit = VaultTransaction.prototype.commit;
  t.mock.method(VaultTransaction.prototype, 'commit', async function (this: VaultTransaction) {
    called = true; assert.equal(changedAfterDecision, false);
    return commit.call(this);
  });
  // Exercise the production transaction boundary without adding a public test API.
  const internal = vault as unknown as { withMutation(permission: 'review', actor: typeof vault.principal,
    operation: string, message: string, action: () => Promise<void>, ids: undefined,
    options: { validateBeforeCommit(): void }): Promise<unknown> };
  await internal.withMutation('review', vault.principal, 'test-final-check', 'test: final check', async () => {}, undefined, {
    validateBeforeCommit: () => { queueMicrotask(() => { changedAfterDecision = true; }); },
  });
  assert.equal(called, true); assert.equal(changedAfterDecision, true);
});

test('experience: completed commits are identified when expiry or authority changes before returning', async t => {
  for (const mode of ['expiry', 'read', 'review', 'tenant'] as const) {
    const { vault, plan } = await fixture(t); const initial = structuredClone(vault.principal);
    type Guard = { revalidate(): Promise<void>; validate(): void };
    const internal = vault as unknown as { captureGuarded(options: CaptureOptions, guard?: Guard): Promise<CaptureResult> };
    const capture = internal.captureGuarded.bind(vault);
    let saved: CaptureResult | undefined;
    t.mock.method(internal, 'captureGuarded', async (options: CaptureOptions, guard?: Guard) => {
      const result = await capture(options, guard); saved = result;
      if (mode === 'expiry') t.mock.method(Date, 'now', () => Date.parse(plan.expiresAt) + 1);
      else if (mode === 'tenant') vault.principal.tenantId = 'foreign';
      else vault.principal.permissions = mode === 'read' ? ['write', 'review'] : ['read', 'write'];
      return result;
    });
    await assert.rejects(vault.experienceValidate(plan, suite, runner), (error: unknown) => {
      const failure = error as { code: string; safeDetails: { completedValidation: unknown } };
      assert.equal(failure.code, mode === 'expiry' ? 'VALIDATION_FAILED' : 'AUTHORIZATION_DENIED');
      assert.ok(saved?.commit);
      assert.deepEqual(failure.safeDetails.completedValidation, { evidenceId: saved.evidenceId, commit: saved.commit });
      assert.doesNotMatch(JSON.stringify(failure), /observedResult|Normalize one label|observed.*ALPHA/);
      return true;
    });
    t.mock.restoreAll(); Object.assign(vault.principal, initial);
    if (initial.tenantId === undefined) delete vault.principal.tenantId;
    assert.equal((await vault.git.run(['rev-parse', 'HEAD'])).trim(), saved!.commit);
  }
});

test('experience: tenant changes during asynchronous read-lock cleanup prevent proposal and skill plaintext returns', async t => {
  const { vault, root, first, second, plan } = await fixture(t);
  const valid = await vault.experienceValidate(plan, suite, runner), config = await vault.config(), proof = new WikiProof(root);
  const docs = new Map(await Promise.all([first.evidenceId, second.evidenceId, valid.evidenceId].map(async id => [id, asEvidenceDocument(await vault.get(id))] as const)));
  const principal = { ...localAdminPrincipal(), tenantId: config.tenantId, permissions: ['read', 'write', 'review'] as Array<'read' | 'write' | 'review'> };
  const engine = new ExperienceEngine({
    principal, config: async () => { assertTenant(principal, config.tenantId); return structuredClone(config); },
    read: async action => { const result = await action(); principal.tenantId = 'foreign'; return result; },
    evidence: async id => { const doc = docs.get(id); assert.ok(doc); return structuredClone(doc); },
    sign: value => proof.sign(value), verify: (value, signature) => proof.verify(value, signature),
    capture: async () => { throw new Error('read-only scenario'); },
  });
  await assert.rejects(engine.prepare({ traceIds: [first.evidenceId, second.evidenceId], name: plan.name,
    description: plan.description, procedure: plan.procedure, conditions: plan.conditions, limitations: plan.limitations }), { code: 'AUTHORIZATION_DENIED' });
  principal.tenantId = config.tenantId;
  await assert.rejects(engine.export(valid.evidenceId, { confirm: true }), { code: 'AUTHORIZATION_DENIED' });
});
