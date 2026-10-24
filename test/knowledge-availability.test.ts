import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AvailabilityEngine, type AvailabilityPort } from '../src/knowledge-availability.js';
import { EncryptionManager, type EncryptedEnvelopeMeta } from '../src/encryption.js';
import { LlmClient } from '../src/llm.js';
import { withOperation } from '../src/operation.js';
import { MemoryVault } from '../src/vault.js';
import type { Sensitivity } from '../src/types.js';

class Compiler extends LlmClient {
  version = 1; calls = 0;
  conceptKey = 'concept:labels';
  expiresAt: string | undefined;
  constructor() { super({ apiKey: 'fixture', embeddingModel: '' }); }
  override async wiki<T>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    this.calls++;
    if (operation === 'navigate') return { keys: [] } as T;
    const sources = (input as { sources: Array<{ id: string; body: string }> }).sources;
    const pages = sources.map(source => ({ key: `source:${source.id}`, pageType: 'source', title: 'Observed source',
      summary: `Version ${this.version}`, body: `${source.body}\nVersion ${this.version}`, evidenceIds: [source.id],
      links: [] as string[], status: 'active', conditions: [], uncertainty: [], ...(this.expiresAt ? { expiresAt: this.expiresAt } : {}) }));
    return { pages: [...pages, { ...pages[0], key: this.conceptKey, pageType: 'concept', title: 'Label procedure',
      body: `Label knowledge Version ${this.version}`, evidenceIds: sources.map(source => source.id), links: pages.map(page => page.key) }] } as T;
  }
}
async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/knowledge-availability-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const llm = new Compiler(), vault = new MemoryVault(root, { llm, masterKey: '35'.repeat(32) }); await vault.initialize('Observed knowledge');
  const source = await vault.capture({ content: 'AVAILABLE_SOURCE_CANARY', scope: 'user', sensitivity, extract: false });
  await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
  const key = 'concept:labels', flags = { includeSecret: sensitivity === 'secret', includeSensitive: sensitivity === 'sensitive' };
  return { vault, root, llm, source, key, flags };
}
const observe = (key: string) => ({ pageKeys: [key], confirm: true as const });
const engineOf = (vault: MemoryVault) => (vault as unknown as { availabilityEngine(): AvailabilityEngine }).availabilityEngine();
const portOf = (engine: AvailabilityEngine) => (engine as unknown as { port: AvailabilityPort }).port;
async function advance(vault: MemoryVault, llm: Compiler) {
  llm.version++;
  const second = await vault.capture({ content: `AVAILABLE_SOURCE_V${llm.version}_CANARY`, extract: false });
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const current = await vault.wikiSnapshot({ commit: await vault.git.run(['rev-parse', 'HEAD']), pageKeys: ['concept:labels'] });
  assert.match(current.pages.find(page => page.meta.key === 'concept:labels')!.body, new RegExp(`Version ${llm.version}`));
}

test('availability: unknown legacy history, explicit immutable observation, exact old content and no query writes/model calls', async t => {
  const { vault, root, llm, source, key } = await fixture(t);
  const now = new Date().toISOString();
  assert.equal((await vault.wikiAsKnownAt({ pageKeys: [key], at: now })).items[0]!.status, 'unknown');
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key], confirm: false } as never), { code: 'VALIDATION_FAILED' });
  const first = await vault.wikiObserveAvailability(observe(key)); assert.ok(first.commit);
  const bytes = await readFile(join(root, first.evidencePath), 'utf8'), sourceBytes = await readFile(join(root, source.evidencePath), 'utf8');
  const before = new Date(Date.parse(first.observedAt) - 1).toISOString();
  assert.equal((await vault.wikiAsKnownAt({ pageKeys: [key], at: before })).items[0]!.status, 'unknown');
  await advance(vault, llm);
  const head = await vault.git.run(['rev-parse', 'HEAD']), calls = llm.calls;
  const result = await vault.wikiAsKnownAt({ pageKeys: [key], at: first.observedAt });
  assert.equal(result.items[0]!.status, 'observed'); assert.equal(result.items[0]!.observationId, first.evidenceId);
  assert.equal(result.items[0]!.snapshot!.commit, first.observedCommit);
  assert.match(result.items[0]!.snapshot!.pages[0]!.body, /Version 1/); assert.doesNotMatch(result.items[0]!.snapshot!.pages[0]!.body, /Version 2/);
  assert.equal(llm.calls, calls); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(await vault.git.run(['status', '--porcelain']), '');
  assert.equal(await readFile(join(root, first.evidencePath), 'utf8'), bytes); assert.equal(await readFile(join(root, source.evidencePath), 'utf8'), sourceBytes);
});

test('availability: old Git dates and forged markers cannot establish prior availability; lost proofs stay unknown without recreation', async t => {
  const { vault, root, key } = await fixture(t);
  const previous = { author: process.env.GIT_AUTHOR_DATE, committer: process.env.GIT_COMMITTER_DATE };
  try {
    process.env.GIT_AUTHOR_DATE = '2001-01-01T00:00:00Z'; process.env.GIT_COMMITTER_DATE = '2001-01-01T00:00:00Z';
    await vault.git.run(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'backdated fixture']);
  } finally {
    for (const [key, value] of [['GIT_AUTHOR_DATE', previous.author], ['GIT_COMMITTER_DATE', previous.committer]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
  assert.match(await vault.git.run(['show', '-s', '--format=%cI', 'HEAD']), /^2001-/);
  const observed = await vault.wikiObserveAvailability(observe(key)), record = await vault.get(observed.evidenceId);
  const prefix = 'MEMOBRANCH_KNOWLEDGE_AVAILABILITY_V1\n', copied = JSON.parse(record.body.slice((`# Evidence ${observed.evidenceId}\n\n` + prefix).length));
  await vault.capture({ content: prefix + JSON.stringify({ ...copied, observedAt: '2001-01-01T00:00:00.000Z' }), extract: false });
  assert.equal((await vault.wikiAsKnownAt({ pageKeys: [key], at: '2002-01-01T00:00:00Z' })).items[0]!.status, 'unknown');
  await rm(join(root, '.amem/wiki-proof-key'));
  assert.equal((await vault.wikiAsKnownAt({ pageKeys: [key], at: new Date().toISOString() })).items[0]!.status, 'unknown');
  await assert.rejects(readFile(join(root, '.amem/wiki-proof-key')), { code: 'ENOENT' });
});

test('availability: private opt-out precedes decryption and selected source key loss prevents historical plaintext', async t => {
  const { vault, key, source, flags } = await fixture(t, 'secret');
  const decrypt = EncryptionManager.prototype.decrypt, seen: string[] = [];
  t.mock.method(EncryptionManager.prototype, 'decrypt', async function(this: EncryptionManager, meta: EncryptedEnvelopeMeta, body: string) {
    seen.push(meta.id); return decrypt.call(this, meta, body);
  });
  const absent = await vault.wikiAsKnownAt({ pageKeys: [key], at: new Date().toISOString() });
  assert.equal(absent.items[0]!.status, 'unknown'); assert.equal(seen.length, 0);
  await assert.rejects(vault.wikiObserveAvailability(observe(key)), { code: 'NOT_FOUND' }); assert.equal(seen.length, 0);
  const observed = await vault.wikiObserveAvailability({ ...observe(key), ...flags });
  const checked = await vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt, observationIds: [observed.evidenceId], ...flags });
  assert.equal(checked.items[0]!.status, 'observed');
  await vault.encryption.erase(source.evidenceId);
  await assert.rejects(vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt, observationIds: [observed.evidenceId], ...flags }), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
});

test('availability: current revocation prevents fallback to older observed content', async t => {
  const { vault, key, llm } = await fixture(t);
  const first = await vault.wikiObserveAvailability(observe(key));
  await advance(vault, llm);
  await vault.wikiObserveAvailability(observe(key));
  await vault.wikiRevoke(key, 'Withdraw fixture');
  await assert.rejects(vault.wikiAsKnownAt({ pageKeys: [key], at: first.observedAt }), { code: 'NOT_FOUND' });
});

test('availability: different observed versions at one recorded instant are unknown, not selected by record order', async t => {
  const { vault, key, llm } = await fixture(t);
  const RealDate = Date, instant = new Date().getTime();
  globalThis.Date = new Proxy(RealDate, { construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [instant], newTarget); } });
  try {
    const first = await vault.wikiObserveAvailability(observe(key));
    await advance(vault, llm);
    const second = await vault.wikiObserveAvailability(observe(key)); assert.equal(first.observedAt, second.observedAt);
    const result = await vault.wikiAsKnownAt({ pageKeys: [key], at: first.observedAt });
    assert.equal(result.items[0]!.status, 'unknown'); assert.match(result.items[0]!.reason!, /Conflicting/);
    const selected = await vault.wikiAsKnownAt({ pageKeys: [key], at: first.observedAt, observationIds: [first.evidenceId] });
    assert.equal(selected.items[0]!.status, 'observed'); assert.equal(selected.coverage.mode, 'explicit-observation-ids');
    assert.match(selected.warnings.join(' '), /outside that set/); assert.match(selected.items[0]!.snapshot!.pages[0]!.body, /Version 1/);
  } finally { globalThis.Date = RealDate; }
});

test('availability: actual read cleanup permission changes are refused before save or return', async t => {
  const { vault, key } = await fixture(t), head = await vault.git.run(['rev-parse', 'HEAD']);
  const engine = engineOf(vault), port = portOf(engine), read = port.read;
  port.read = async action => { const result = await read(action); vault.principal.permissions = ['read']; return result; };
  await assert.rejects(engine.observe(observe(key)), { code: 'AUTHORIZATION_DENIED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  vault.principal.permissions = ['admin']; const observed = await vault.wikiObserveAvailability(observe(key));
  port.read = async action => { const result = await read(action); vault.principal.scopes = ['public']; return result; };
  await assert.rejects(engine.at({ pageKeys: [key], at: observed.observedAt }), { code: 'AUTHORIZATION_DENIED' });
});

test('availability: source/config drift before capture refuses stale records and cancellation writes nothing', async t => {
  const { vault, key } = await fixture(t), engine = engineOf(vault), port = portOf(engine), capture = port.capture;
  let changedHead = '';
  port.capture = async (...args) => {
    const settings = await vault.settings(); settings.values.name = 'Changed before observation save';
    await vault.updateSettings(settings.values, settings.revision); changedHead = await vault.git.run(['rev-parse', 'HEAD']);
    return capture(...args);
  };
  await assert.rejects(engine.observe(observe(key)), { code: 'VALIDATION_FAILED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), changedHead); assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withOperation(controller.signal, () => vault.wikiObserveAvailability(observe(key))), { code: 'OPERATION_CANCELLED' });
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 1);
});

test('availability: explicit signals and strict schemas fail before IO without serialized cancellation overrides', async t => {
  const { vault, key } = await fixture(t), controller = new AbortController(); controller.abort();
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.wikiObserveAvailability({ ...observe(key), signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(vault.wikiAsKnownAt({ pageKeys: [key], at: new Date().toISOString(), signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  for (const extra of [{ principal: vault.principal }, { tenantId: 'different' }, { commit: head }, { observedAt: '2001-01-01T00:00:00Z' }, { signal: {} }]) {
    await assert.rejects(vault.wikiObserveAvailability({ ...observe(key), ...extra } as never), { code: 'VALIDATION_FAILED' });
  }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('availability: a completed real save remains identifiable after authority is removed without returning manifest plaintext', async t => {
  const { vault, key } = await fixture(t), engine = engineOf(vault), port = portOf(engine), capture = port.capture;
  let id = '', commit: string | null = null;
  port.capture = async (...args) => { const result = await capture(...args); id = result.evidenceId; commit = result.commit; vault.principal.permissions = ['read']; return result; };
  await assert.rejects(engine.observe(observe(key)), (error: any) => {
    assert.equal(error.code, 'AUTHORIZATION_DENIED');
    assert.deepEqual(error.safeDetails.completedAvailability, { evidenceId: id, commit });
    assert.doesNotMatch(JSON.stringify(error.safeDetails), /AVAILABLE_SOURCE_CANARY|documents|concept:labels/); return true;
  });
  assert.ok(id); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), commit);
  const inspector = new MemoryVault(vault.root, { masterKey: '35'.repeat(32) });
  assert.equal((await inspector.listRecords({ collection: 'evidence' })).total, 2);
});

test('availability: actual read cleanup crossing source expiry cannot return previously assembled historical text', async t => {
  const { vault, key, llm } = await fixture(t);
  let now = Date.now(); const end = now + 120000; llm.expiresAt = new Date(end).toISOString(); await advance(vault, llm);
  const observed = await vault.wikiObserveAvailability(observe(key)), engine = engineOf(vault), port = portOf(engine), read = port.read;
  t.mock.method(Date, 'now', () => now);
  port.read = async action => { const result = await read(action); now = end; return result; };
  await assert.rejects(engine.at({ pageKeys: [key], at: observed.observedAt }), { code: 'NOT_FOUND' });
});

test('availability: incompatible private scopes and foreign tenants never produce an availability record', async t => {
  const { vault, key, llm } = await fixture(t);
  llm.conceptKey = 'concept:project';
  const source = await vault.capture({ content: 'Project-only availability source', scope: 'project', extract: false });
  await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
  const head = await vault.git.run(['rev-parse', 'HEAD']), calls = llm.calls;
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key, llm.conceptKey], confirm: true }), { code: 'VALIDATION_FAILED' });
  const foreign = new MemoryVault(vault.root, { principal: { ...vault.principal, tenantId: 'foreign-tenant' } });
  await assert.rejects(foreign.wikiObserveAvailability(observe(key)), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(foreign.wikiAsKnownAt({ pageKeys: [key], at: new Date().toISOString() }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.equal(llm.calls, calls);
});

test('availability: runtime rule attestation mismatch cannot silently reconstruct observed content', async t => {
  const { vault, key } = await fixture(t), observed = await vault.wikiObserveAvailability(observe(key));
  const engine = engineOf(vault), port = portOf(engine), snapshot = port.snapshot;
  port.snapshot = async (...args) => ({ ...await snapshot(...args), builtinRulesHash: 'f'.repeat(64) });
  await assert.rejects(engine.at({ pageKeys: [key], at: observed.observedAt }), { code: 'VALIDATION_FAILED' });
});
