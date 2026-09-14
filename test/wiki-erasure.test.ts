import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { EncryptionManager, isEncryptedEnvelope } from '../src/encryption.js';
import { AgentMemoryError, type ErrorCode } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { operationSignal, withOperation } from '../src/operation.js';
import type { Principal } from '../src/policy.js';
import type { Sensitivity } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

const roots: string[] = [];
const masterKey = '83'.repeat(32);
const payload = 'WIKI_ERASURE_BODY_72BE';
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class ErasureCompiler extends LlmClient {
  constructor() { super({ apiKey: 'fixture', model: 'wiki-erasure-fixture', embeddingModel: '' }); }
  override async wiki<T = unknown>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    const dto = input as Record<string, unknown>;
    if (operation === 'navigate') return { keys: (dto.catalog as Array<{ key: string }>).map((page) => page.key) } as T;
    if (operation === 'query') return { answer: payload, citations: ['synthesis:erasable'], uncertainty: [] } as T;
    const sources = dto.sources as Array<{ id: string }>;
    const sourceKey = `source:${sources[0]!.id}`;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], links: string[]): WikiPageDraft => ({
      key, pageType, title: `${payload} ${pageType}`, summary: `${payload} summary`, body: `# ${pageType}\n\n${payload}`,
      evidenceIds: sources.map((source) => source.id), links, status: 'active', conditions: ['Only for this project.'], uncertainty: [],
    });
    return { pages: [draft(sourceKey, 'source', []), draft('entity:erasable', 'entity', [sourceKey]), draft('synthesis:erasable', 'synthesis', ['entity:erasable'])] } as T;
  }
}

async function fixture(sensitivity: Sensitivity = 'secret') {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-wiki-erasure-'));
  roots.push(root);
  const llm = new ErasureCompiler();
  const vault = new MemoryVault(root, { llm, masterKey });
  await vault.initialize('wiki-erasure');
  if (sensitivity === 'internal') {
    const config = await vault.config();
    config.policy.requireEncryptionFor = ['internal', 'sensitive', 'secret'];
    await writeFile(join(root, 'agent-memory.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  const evidence = await vault.capture({ content: `${payload} immutable evidence`, scope: sensitivity === 'public' ? 'public' : 'user', sensitivity });
  const evidenceBytes = await readFile(join(root, evidence.evidencePath), 'utf8');
  const planned = await vault.wikiIngest({ evidenceIds: [evidence.evidenceId] });
  const applied = await vault.wikiApply(planned.plan);
  assert.ok(applied.commit);
  const pages = await vault.wikiCatalog();
  assert.equal(pages.length, 3);
  const source = pages.find((page) => page.pageType === 'source')!;
  return { vault, llm, evidence, evidenceBytes, pages, source };
}

const hasCode = (code: ErrorCode) => (error: unknown): boolean => error instanceof AgentMemoryError && error.code === code;

async function assertWithdrawn(vault: MemoryVault, ids: string[]) {
  assert.deepEqual(await vault.wikiCatalog(), []);
  assert.deepEqual(await vault.search(payload, { includeSecret: true }), []);
  assert.deepEqual((await vault.wikiQuery('What knowledge remains?')).citations, []);
  for (const id of ids) await assert.rejects(vault.get(id), hasCode('NOT_FOUND'));
}

test('S04 S05: encrypted Wiki erasure by semantic key survives policy relaxation and withdraws dependent readers', async () => {
  const { vault, llm, source, pages, evidence, evidenceBytes } = await fixture('internal');
  const reader = new MemoryVault(vault.root, { llm, masterKey });
  assert.equal((await reader.search(payload, { includeSecret: true })).length, 3);
  assert.equal((await reader.wikiQuery('What is supported?')).citations.length, 1);
  const historyHead = await vault.git.run(['rev-parse', 'HEAD']);
  const historicalBytes = await vault.git.run(['show', `${historyHead}:${source.path}`]);
  const historical = parseMarkdown<Record<string, unknown>>(historicalBytes);
  assert.ok(isEncryptedEnvelope(historical.meta));
  assert.doesNotMatch(historicalBytes, new RegExp(`${payload}|${source.key}`));
  assert.equal(await vault.encryption.hasKey(source.id), true);
  const config = await vault.config();
  config.policy.requireEncryptionFor = ['sensitive', 'secret'];
  await writeFile(join(vault.root, 'agent-memory.json'), `${JSON.stringify(config, null, 2)}\n`);
  const result = await vault.erase(source.key, 'WIKI_ERASURE_REASON_927C');
  assert.equal(result.memoryId, source.id);
  assert.equal(result.keyErased, true);
  assert.equal(result.commit, await vault.git.run(['rev-parse', 'HEAD']));
  assert.equal(await vault.encryption.hasKey(source.id), false);
  assert.equal(await vault.git.run(['show', `${historyHead}:${source.path}`]), historicalBytes, 'encrypted Git history is retained');
  await assert.rejects(new EncryptionManager(vault.root, masterKey).decrypt(historical.meta, historical.body), hasCode('ENCRYPTION_KEY_UNAVAILABLE'));
  const tombstoneBytes = await readFile(join(vault.root, source.path), 'utf8');
  const tombstone = parseMarkdown<Record<string, unknown>>(tombstoneBytes);
  assert.equal(tombstone.meta.id, source.id);
  assert.equal(tombstone.meta.type, 'memory-erased');
  assert.equal(tombstone.meta.status, 'revoked');
  assert.doesNotMatch(tombstoneBytes, new RegExp(`${payload}|${source.key}|WIKI_ERASURE_REASON_927C`));
  await assertWithdrawn(reader, pages.map((page) => page.id));
  await assertWithdrawn(new MemoryVault(vault.root, { llm, masterKey }), pages.map((page) => page.id));
  assert.equal(await readFile(join(vault.root, evidence.evidencePath), 'utf8'), evidenceBytes);
  assert.equal(await vault.encryption.hasKey(evidence.evidenceId), true);
  assert.doesNotMatch(await vault.git.run(['log', '-p', '--all']), new RegExp(`${payload}|WIKI_ERASURE_REASON_927C`));
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'erasures')), []);
});

test('S01 S04: Wiki erasure enforces admin, tenant, scope and clearance before decryption', async () => {
  const { vault, llm, source } = await fixture();
  const config = await vault.config();
  const base: Principal = { id: 'eraser', name: 'Scoped administrator', permissions: ['admin'], scopes: ['user'], maxSensitivity: 'secret', tenantId: config.tenantId };
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const raw = await readFile(join(vault.root, source.path), 'utf8');
  for (const principal of [
    { ...base, permissions: ['read', 'write', 'review', 'maintain'] as Principal['permissions'] },
    { ...base, tenantId: 'other-tenant' },
    { ...base, scopes: ['public'] as Principal['scopes'] },
    { ...base, maxSensitivity: 'public' as const },
  ]) {
    const denied = new MemoryVault(vault.root, { llm, masterKey, principal });
    let decryptions = 0;
    const decrypt = denied.encryption.decrypt.bind(denied.encryption);
    denied.encryption.decrypt = async (...args) => { decryptions += 1; return decrypt(...args); };
    await assert.rejects(denied.erase(source.id, 'denied request'), (error: unknown) => error instanceof AgentMemoryError && ['AUTHORIZATION_DENIED', 'NOT_FOUND'].includes(error.code));
    assert.equal(decryptions, 0);
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
    assert.equal(await readFile(join(vault.root, source.path), 'utf8'), raw);
    assert.equal(await vault.encryption.hasKey(source.id), true);
  }
  const administrator = new MemoryVault(vault.root, { llm, masterKey, principal: base });
  assert.equal((await administrator.erase(source.id, 'permitted scoped admin')).memoryId, source.id);
});

test('S04: Wiki erasure rejects plaintext and ambiguous memory/Wiki selectors without destroying a key', async () => {
  const publicFixture = await fixture('public');
  const publicHead = await publicFixture.vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(publicFixture.vault.erase(publicFixture.source.id, 'cannot erase plaintext'), hasCode('VALIDATION_FAILED'));
  assert.equal(await publicFixture.vault.git.run(['rev-parse', 'HEAD']), publicHead);
  assert.equal(existsSync(join(publicFixture.vault.root, '.amem', 'erasures')), false);

  const { vault, source } = await fixture();
  const proposed = await vault.propose({ kind: 'fact', key: source.key, statement: 'An independent retained atomic memory.', scope: 'user', sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: [] });
  const atomic = await vault.approve(proposed.id);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.erase(source.key, 'ambiguous erasure'), hasCode('VALIDATION_FAILED'));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(await vault.encryption.hasKey(source.id), true);
  assert.equal(await vault.encryption.hasKey(atomic.memoryId), true);
  assert.equal((await vault.erase(source.id, 'use exact Wiki id')).memoryId, source.id);
  assert.equal(await vault.encryption.hasKey(atomic.memoryId), true);
  assert.equal((await vault.get(atomic.memoryId)).meta.type, 'memory');
});

test('S04: noncanonical Wiki data-key references cannot produce a false cryptographic-erasure receipt', async () => {
  const { vault, source } = await fixture();
  const page = await vault.get(source.id);
  const alternate = await vault.encryption.encrypt(page.meta, page.body, 'alternate-wiki-key');
  await writeFile(join(vault.root, source.path), serializeMarkdown(alternate.meta, alternate.body));
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.erase(source.id, 'refuse wrong data key'), hasCode('ENCRYPTION_FAILED'));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(await vault.encryption.hasKey(source.id), true);
  assert.equal(await vault.encryption.hasKey('alternate-wiki-key'), true);
  assert.equal(existsSync(join(vault.root, '.amem', 'erasures')), false);
});

test('S04 S07: cancellation during Wiki key destruction settles the tombstone and reports its durable commit', async () => {
  const { vault, llm, source, pages, evidence, evidenceBytes } = await fixture();
  const controller = new AbortController();
  const erase = vault.encryption.erase.bind(vault.encryption);
  vault.encryption.erase = async (id) => {
    assert.equal(operationSignal(), undefined);
    controller.abort();
    return erase(id);
  };
  let cancelled: AgentMemoryError | undefined;
  await assert.rejects(withOperation(controller.signal, () => vault.erase(source.id, 'cancel after durable intent')), (error: unknown) => {
    assert.ok(error instanceof AgentMemoryError);
    cancelled = error;
    return error.code === 'OPERATION_CANCELLED';
  });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.deepEqual(cancelled?.safeDetails?.committed, [{ operation: 'erase', commit: head }]);
  assert.equal(await vault.encryption.hasKey(source.id), false);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'erasures')), []);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'transactions')), []);
  assert.equal(existsSync(join(vault.root, '.amem', 'write.lock')), false);
  const restart = new MemoryVault(vault.root, { llm, masterKey });
  await assertWithdrawn(restart, pages.map((page) => page.id));
  assert.equal((await restart.git.integrity()).dirty, false);
  assert.equal(await readFile(join(vault.root, evidence.evidencePath), 'utf8'), evidenceBytes);
});

test('S04 S08: failed Wiki key destruction leaves a durable intent that a fresh vault completes', async () => {
  const { vault, llm, source, pages, evidence, evidenceBytes } = await fixture();
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const raw = await readFile(join(vault.root, source.path), 'utf8');
  vault.encryption.erase = async () => { throw new Error('simulated Wiki key-store failure'); };
  await assert.rejects(vault.erase(source.id, 'recover Wiki erasure'), /simulated Wiki key-store failure/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal(await readFile(join(vault.root, source.path), 'utf8'), raw);
  assert.equal(await vault.encryption.hasKey(source.id), true);
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'erasures')), [`${source.id}.json`]);
  const restart = new MemoryVault(vault.root, { llm, masterKey });
  await restart.recover();
  assert.equal(await restart.encryption.hasKey(source.id), false);
  await assertWithdrawn(restart, pages.map((page) => page.id));
  assert.deepEqual(await readdir(join(vault.root, '.amem', 'erasures')), []);
  assert.equal((await restart.recover()).replayed.length, 0);
  assert.equal(await readFile(join(vault.root, evidence.evidencePath), 'utf8'), evidenceBytes);
});
