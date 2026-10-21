import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsPromises, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { LlmClient } from '../src/llm.js';
import { serializeMarkdown } from '../src/markdown.js';
import { withOperation } from '../src/operation.js';
import { localAdminPrincipal } from '../src/policy.js';
import { VaultTransaction } from '../src/transaction.js';
import type { MarkdownDocument, Scope, Sensitivity } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId } from '../src/wiki-schema.js';
import type { WikiMergeOptions } from '../src/wiki-merge.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/wiki-merge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let calls = 0;
  llm.wiki = async <T>(operation: string, input: object) => {
    calls++;
    const data = input as { catalog: Array<{ key: string }>; sources: Array<{ id: string; body: string }> };
    if (operation === 'navigate') return { keys: data.catalog.map(page => page.key) } as T;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string, links: string[]): WikiPageDraft => ({
      key, pageType, title: key, summary: 'Synthetic source summary.', body, evidenceIds: data.sources.map(source => source.id), links,
      status: 'active', conditions: ['Only for the synthetic project.'], uncertainty: ['Unverified synthetic example.'],
    });
    return { pages: [...data.sources.map(source => draft(`source:${source.id}`, 'source', source.body, ['entity:atlas'])),
      draft('entity:atlas', 'entity', data.sources.map(source => source.body).join('\n'), data.sources.map(source => `source:${source.id}`))] } as T;
  };
  const key = '81'.repeat(32), vault = new MemoryVault(join(root, 'vault'), { llm, masterKey: key });
  await vault.initialize('Manual merge fixture');
  const first = await vault.capture({ content: 'Historical synthesis version one.', sensitivity, scope: 'project', extract: false });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const fromCommit = await vault.git.run(['rev-parse', 'HEAD']);
  const second = await vault.capture({ content: 'Current synthesis version two.', sensitivity, scope: 'project', extract: false });
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const input: WikiMergeOptions = { fromCommit, pageKey: 'entity:atlas', expectedRevision: 2,
    body: 'Manually combined historical and current synthesis, with uncertainty retained.', summary: 'Human-authored combination.' };
  return { root, vault, key, llm, first, second, input, calls: () => calls };
}

async function save(vault: MemoryVault, document: MarkdownDocument<object>) {
  await writeFile(join(vault.root, document.path), serializeMarkdown(document.meta, document.body));
  await vault.git.commit('synthetic merge boundary', vault.principal, ['wiki']);
}

test('Wiki merge: signed full review preserves sources, explicit approval and atomic dependents; exact retry is a no-op', async t => {
  const { vault, input, first, second, calls } = await fixture(t), head = await vault.git.run(['rev-parse', 'HEAD']);
  const original = await readFile(join(vault.root, first.evidencePath)), current = await vault.get(wikiPageId(input.pageKey)), count = calls();
  const prepared = await vault.wikiMergePrepare(input);
  assert.equal(prepared.plan.kind, 'merge'); assert.equal(prepared.plan.merge!.fromCommit, input.fromCommit); assert.equal(prepared.plan.merge!.baseRevision, 1);
  assert.match(prepared.plan.merge!.baseHash, /^[a-f0-9]{64}$/); assert.equal(prepared.comparison.current.meta.revision, 2);
  assert.match(prepared.comparison.base.pages.find(page => page.meta.id === current.meta.id)!.body, /Historical synthesis/);
  assert.match(prepared.comparison.current.body, /Current synthesis/); assert.equal(prepared.preview.kind, 'merge');
  const target = prepared.preview.pages.find(page => page.key === input.pageKey)!;
  assert.match(target.before!.body, /Current synthesis/); assert.match(target.after.body, /Manually combined/);
  assert.deepEqual(new Set(target.after.evidence), new Set([first.evidencePath, second.evidencePath]));
  assert.ok(target.after.conditions.includes('Only for the synthetic project.')); assert.ok(target.after.uncertainty.includes('Unverified synthetic example.'));
  assert.ok(prepared.plan.pages.length >= 3); assert.equal(calls(), count);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.equal((await vault.get(current.meta.id as string)).body, current.body);
  const applied = await vault.wikiApply(prepared.plan);
  assert.equal(applied.pageIds.length, prepared.preview.affectedPageKeys.length); assert.ok(applied.commit);
  assert.match((await vault.get(current.meta.id as string)).body, /Manually combined/);
  assert.deepEqual(await readFile(join(vault.root, first.evidencePath)), original); assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 2);
  const log = await readFile(join(vault.root, 'log.md'), 'utf8'); assert.match(log, new RegExp(`wiki-merge:${input.fromCommit}`)); assert.doesNotMatch(log, /Manually combined/);
  assert.deepEqual(await vault.wikiApply(prepared.plan), { pageIds: [], commit: null });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), applied.commit); assert.equal(calls(), count);
});

test('Wiki merge: bounded input, full ancestor, current expected revision and compiled target are required', async t => {
  const { vault, input } = await fixture(t), head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const patch of [{ fromCommit: 'HEAD' }, { expectedRevision: 1 }, { pageKey: 'missing' }, { body: '' }, { body: 'x'.repeat(100_001) },
    { summary: 'invalid\nsummary' }, { body: 'null\0byte' }, { unknown: true }, { fromCommit: 'f'.repeat(40) }]) {
    await assert.rejects(vault.wikiMergePrepare({ ...input, ...patch }));
  }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('Wiki merge: malformed Unicode is rejected rather than silently rewritten at storage', async t => {
  const { vault, input } = await fixture(t);
  for (const patch of [{ body: 'Malformed \uD800 body.' }, { summary: 'Malformed \uDFFF summary.' }, { title: 'Malformed \uD800 title.' }]) {
    await assert.rejects(vault.wikiMergePrepare({ ...input, ...patch }), { code: 'VALIDATION_FAILED' });
  }
  const prepared = await vault.wikiMergePrepare({ ...input, body: '中文合并 🧠📚 retains conditions.' });
  const expected = prepared.preview.pages.find(page => page.key === input.pageKey)!.after.body;
  await vault.wikiApply(prepared.plan);
  assert.equal((await vault.get(wikiPageId(input.pageKey))).body, expected);
});

test('Wiki merge: tampering the draft, origin, projection or proof cannot approve anything', async t => {
  const { vault, input } = await fixture(t), prepared = await vault.wikiMergePrepare(input), head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const modify of [
    (plan: typeof prepared.plan) => { plan.pages[0]!.body = 'Altered proposed content'; },
    (plan: typeof prepared.plan) => { plan.merge!.fromCommit = '0'.repeat(40); },
    (plan: typeof prepared.plan) => { plan.merge!.conditions = []; },
    (plan: typeof prepared.plan) => { plan.merge!.selection.includeSecret = true; },
    (plan: typeof prepared.plan) => { plan.proof = '0'.repeat(64); },
    (plan: typeof prepared.plan) => { delete plan.merge; },
  ]) {
    const copy = structuredClone(prepared.plan); modify(copy);
    await assert.rejects(vault.wikiPreview(copy)); await assert.rejects(vault.wikiApply(copy));
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  }
});

test('Wiki merge: read/write/review, tenant and scope checks remain separate', async t => {
  const { vault, input, llm, key } = await fixture(t), tenantId = (await vault.config()).tenantId;
  const restricted = (permissions: Array<'read' | 'write' | 'review'>, scopes: Scope[] = ['project'], tenant = tenantId) => new MemoryVault(vault.root, {
    masterKey: key, llm, principal: { ...localAdminPrincipal(), permissions, scopes, tenantId: tenant, maxSensitivity: 'internal' },
  });
  await assert.rejects(restricted(['read']).wikiMergePrepare(input), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(restricted(['read', 'write'], ['user']).wikiMergePrepare(input));
  await assert.rejects(restricted(['read', 'write'], ['project'], 'other-tenant').wikiMergePrepare(input), { code: 'AUTHORIZATION_DENIED' });
  const writer = restricted(['read', 'write']), prepared = await writer.wikiMergePrepare(input);
  await assert.rejects(writer.wikiApply(prepared.plan), { code: 'AUTHORIZATION_DENIED' });
  assert.equal((await restricted(['read']).wikiPreview(prepared.plan)).kind, 'merge');
  assert.ok((await restricted(['read', 'review']).wikiApply(prepared.plan)).commit);
});

test('Wiki merge: secret selection is required, approved pages stay encrypted and key loss invalidates proposals', async t => {
  const { vault, input, first } = await fixture(t, 'secret');
  const decrypt = vault.encryption.decrypt.bind(vault.encryption); let decrypts = 0;
  vault.encryption.decrypt = async (...args) => { decrypts++; return decrypt(...args); };
  await assert.rejects(vault.wikiMergePrepare(input)); assert.equal(decrypts, 0);
  const prepared = await vault.wikiMergePrepare({ ...input, includeSecret: true });
  await vault.wikiApply(prepared.plan);
  const page = await vault.get(wikiPageId(input.pageKey)); assert.equal(page.meta.sensitivity, 'secret');
  assert.doesNotMatch(await readFile(join(vault.root, page.path), 'utf8'), /Manually combined|Human-authored/);
  const again = await vault.wikiMergePrepare({ ...input, includeSecret: true, expectedRevision: Number(page.meta.revision) });
  await vault.encryption.erase(first.evidenceId);
  await assert.rejects(vault.wikiPreview(again.plan)); await assert.rejects(vault.wikiApply(again.plan));
});

test('Wiki merge: unrelated opt-out private keys and hashes stay outside the whole proposal and preview', async t => {
  const { vault, input, key } = await fixture(t), tenantId = (await vault.config()).tenantId;
  const source = await vault.capture({ content: 'PRIVATE_UNSELECTED_MERGE_CANARY', scope: 'user', sensitivity: 'secret', extract: false });
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
  llm.wiki = async <T>(operation: string) => operation === 'navigate' ? { keys: [] } as T : { pages: [{ key: `source:${source.evidenceId}`, pageType: 'source',
    title: 'PRIVATE_UNSELECTED_TITLE', summary: 'PRIVATE_UNSELECTED_SUMMARY', body: 'Private only.', evidenceIds: [source.evidenceId], links: [], status: 'active', conditions: [], uncertainty: [] }] } as T;
  const privateVault = new MemoryVault(vault.root, { llm, masterKey: key, principal: { ...localAdminPrincipal(), tenantId, scopes: ['user'] } });
  await privateVault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
  const decrypt = vault.encryption.decrypt.bind(vault.encryption); let decrypts = 0;
  vault.encryption.decrypt = async (...args) => { decrypts++; return decrypt(...args); };
  const prepared = await vault.wikiMergePrepare(input);
  assert.equal(decrypts, 0, 'selected Wiki reads must not decrypt unrelated opted-out material');
  assert.doesNotMatch(JSON.stringify(prepared), /PRIVATE_UNSELECTED/); assert.equal(JSON.stringify(prepared).includes(source.evidenceId), false);
  assert.equal(JSON.stringify(prepared).includes(source.evidencePath), false);
  await vault.wikiPreview(prepared.plan); assert.equal(decrypts, 0);
  await vault.wikiApply(prepared.plan);
  assert.match((await vault.get(wikiPageId(input.pageKey))).body, /Manually combined/);
});

test('Wiki merge: stale current pages and withdrawn historical dependencies require a fresh review', async t => {
  const { vault, input, first } = await fixture(t), prepared = await vault.wikiMergePrepare(input);
  const third = await vault.capture({ content: 'Third committed version.', scope: 'project', extract: false });
  await vault.wikiIngest({ evidenceIds: [third.evidenceId], apply: true });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.wikiApply(prepared.plan)); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const fresh = await vault.wikiMergePrepare({ ...input, expectedRevision: 3 });
  await vault.wikiRevoke(`source:${first.evidenceId}`, 'Historical support withdrawn');
  await assert.rejects(vault.wikiPreview(fresh.plan)); await assert.rejects(vault.wikiApply(fresh.plan));
});

test('Wiki merge: historical conflict and stricter conditions survive a currently active revision', async t => {
  const { vault, input } = await fixture(t);
  const pages = await Promise.all((await vault.wikiCatalog()).map(entry => vault.get(entry.id)));
  for (const page of pages) {
    page.meta.status = 'conflicted'; page.meta.conditions = ['Historical extra condition.'];
    page.meta.uncertainty = ['Historical unresolved uncertainty.']; await save(vault, page);
  }
  const fromCommit = await vault.git.run(['rev-parse', 'HEAD']);
  for (const page of pages) {
    page.meta.status = 'active'; page.meta.conditions = []; page.meta.uncertainty = []; await save(vault, page);
  }
  const prepared = await vault.wikiMergePrepare({ ...input, fromCommit });
  assert.equal(prepared.plan.merge!.conflicted, true);
  for (const page of prepared.preview.pages) { assert.equal(page.after.status, 'conflicted'); assert.ok(page.after.conditions.includes('Historical extra condition.')); }
  await vault.wikiApply(prepared.plan);
  assert.equal((await vault.get(wikiPageId(input.pageKey))).meta.status, 'conflicted');
});

test('Wiki merge: old expiry cannot be lengthened by current revisions or approved after its deadline', async t => {
  const { vault, input } = await fixture(t), now = Date.now, deadline = now() + 60_000, pages = await Promise.all((await vault.wikiCatalog()).map(entry => vault.get(entry.id)));
  for (const page of pages) { page.meta.expiresAt = new Date(deadline).toISOString(); await save(vault, page); }
  const fromCommit = await vault.git.run(['rev-parse', 'HEAD']);
  for (const page of pages) { delete page.meta.expiresAt; await save(vault, page); }
  const prepared = await vault.wikiMergePrepare({ ...input, fromCommit });
  assert.equal(prepared.plan.merge!.expiresAt, new Date(deadline).toISOString());
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  try { Date.now = () => deadline + 1; await assert.rejects(vault.wikiPreview(prepared.plan)); await assert.rejects(vault.wikiApply(prepared.plan)); }
  finally { Date.now = now; }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

for (const mode of ['cancel', 'expiry'] as const) {
  test(`Wiki merge: ${mode} during real outer lock cleanup prevents returning a usable proposal`, async t => {
    const { vault, input, first } = await fixture(t), controller = new AbortController(), now = Date.now, timestamp = now();
    if (mode === 'expiry') {
      const at = new Date(timestamp).toISOString();
      await save(vault, { path: 'wiki/merge-time-support.md', body: 'Time bounded synthetic support.', meta: { id: 'mem-cccccccccccc', type: 'memory', kind: 'fact', key: 'Merge deadline',
        scope: 'project', sensitivity: 'internal', status: 'active', confidence: 0.9, evidence: [first.evidencePath],
        createdAt: at, updatedAt: at, validatedAt: at, revision: 1, conditions: [], tags: [], validUntil: new Date(timestamp + 60_000).toISOString() } });
    }
    const originalRm = fsPromises.rm; let injected = false;
    const hook = t.mock.method(fsPromises, 'rm', async (...args: Parameters<typeof fsPromises.rm>) => {
      if (!injected && String(args[0]) === join(vault.root, '.amem', 'write.lock')) {
        injected = true; if (mode === 'cancel') controller.abort(); else Date.now = () => timestamp + 120_000;
      }
      return originalRm(...args);
    }); syncBuiltinESMExports();
    try { await assert.rejects(vault.wikiMergePrepare({ ...input, signal: controller.signal }), { code: mode === 'cancel' ? 'OPERATION_CANCELLED' : 'VALIDATION_FAILED' }); assert.equal(injected, true); }
    finally { Date.now = now; hook.mock.restore(); syncBuiltinESMExports(); }
    await vault.capture({ content: 'Normal operation after interrupted manual preparation.', extract: false });
  });
}

test('Wiki merge: pre-cancelled and parent operations leave canonical data unchanged', async t => {
  const { vault, input } = await fixture(t), controller = new AbortController(), head = await vault.git.run(['rev-parse', 'HEAD']); controller.abort();
  await assert.rejects(vault.wikiMergePrepare({ ...input, signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(withOperation(controller.signal, () => vault.wikiMergePrepare({ ...input, signal: new AbortController().signal })), { code: 'OPERATION_CANCELLED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  await vault.wikiMergePrepare(input);
});

test('Wiki merge: approval observes its own and enclosing cancellation before writing', async t => {
  const { vault, input } = await fixture(t), prepared = await vault.wikiMergePrepare(input);
  const head = await vault.git.run(['rev-parse', 'HEAD']), controller = new AbortController(); controller.abort();
  await assert.rejects(vault.wikiApply(prepared.plan, { signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(withOperation(controller.signal, () => vault.wikiApply(prepared.plan, { signal: new AbortController().signal })), { code: 'OPERATION_CANCELLED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.deepEqual(await readdir(join(vault.root, '.amem/transactions')), []);
});

for (const boundary of ['before-ready', 'after-ready'] as const) {
  test(`Wiki merge: cancellation ${boundary} rolls back or reports the completed commit`, async t => {
    const { vault, input } = await fixture(t), prepared = await vault.wikiMergePrepare(input), controller = new AbortController();
    const head = await vault.git.run(['rev-parse', 'HEAD']), write = VaultTransaction.prototype.write, commit = vault.git.commit;
    const before = await readFile(join(vault.root, (await vault.get(wikiPageId(input.pageKey))).path));
    try {
      if (boundary === 'before-ready') {
        VaultTransaction.prototype.write = async function (path, content) { await write.call(this, path, content); if (path === 'log.md') controller.abort(); };
        await assert.rejects(vault.wikiApply(prepared.plan, { signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
      } else {
        vault.git.commit = async (...args) => { controller.abort(); return commit.apply(vault.git, args); };
        await assert.rejects(vault.wikiApply(prepared.plan, { signal: controller.signal }), error => {
          assert.equal((error as { code?: string }).code, 'OPERATION_CANCELLED');
          assert.equal((error as { safeDetails?: { committed?: unknown[] } }).safeDetails?.committed?.length, 1);
          return true;
        });
      }
    } finally { VaultTransaction.prototype.write = write; vault.git.commit = commit; }
    const afterHead = await vault.git.run(['rev-parse', 'HEAD']);
    if (boundary === 'before-ready') {
      assert.equal(afterHead, head);
      assert.deepEqual(await readFile(join(vault.root, (await vault.get(wikiPageId(input.pageKey))).path)), before);
      assert.ok((await vault.wikiApply(prepared.plan)).commit);
    } else {
      assert.notEqual(afterHead, head);
      assert.match((await vault.get(wikiPageId(input.pageKey))).body, /Manually combined/);
      assert.deepEqual(await vault.wikiApply(prepared.plan), { pageIds: [], commit: null });
      assert.equal(await vault.git.run(['rev-parse', 'HEAD']), afterHead);
    }
    assert.deepEqual(await readdir(join(vault.root, '.amem/transactions')), []);
  });
}

test('Wiki merge: partial writes roll back and a ready transaction recovers with idempotent approval', async t => {
  const { vault, input } = await fixture(t), prepared = await vault.wikiMergePrepare(input), head = await vault.git.run(['rev-parse', 'HEAD']);
  const before = await readFile(join(vault.root, (await vault.get(wikiPageId(input.pageKey))).path));
  const write = VaultTransaction.prototype.write;
  try {
    VaultTransaction.prototype.write = async function (path, content) { await write.call(this, path, content); if (path.startsWith('wiki/')) throw new Error('Synthetic merge write failure'); };
    await assert.rejects(vault.wikiApply(prepared.plan), /Synthetic merge write failure/);
  } finally { VaultTransaction.prototype.write = write; }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.deepEqual(await readFile(join(vault.root, (await vault.get(wikiPageId(input.pageKey))).path)), before);
  const commit = vault.git.commit;
  try { vault.git.commit = async () => { throw new Error('Synthetic ready merge failure'); }; await assert.rejects(vault.wikiApply(prepared.plan), /Synthetic ready merge failure/); }
  finally { vault.git.commit = commit; }
  assert.equal((await readdir(join(vault.root, '.amem/transactions'))).length, 1);
  await vault.recover(); assert.equal((await readdir(join(vault.root, '.amem/transactions'))).length, 0);
  assert.match((await vault.get(wikiPageId(input.pageKey))).body, /Manually combined/);
  assert.deepEqual(await vault.wikiApply(prepared.plan), { pageIds: [], commit: null });
});

test('Wiki merge: real CLI prepares bounded JSON, previews, explicitly applies and safely retries', async t => {
  const { vault, input, root } = await fixture(t), file = join(root, 'merge.json'), planFile = join(root, 'proposal.json'), exec = promisify(execFile);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  await writeFile(file, JSON.stringify(input));
  await assert.rejects(exec(process.execPath, ['dist/cli.js', 'wiki', 'merge-prepare', '--file', file, '--root', vault.root, '--apply'], { env }));
  const prepared = await exec(process.execPath, ['dist/cli.js', 'wiki', 'merge-prepare', '--file', file, '--root', vault.root], { env });
  await writeFile(planFile, prepared.stdout); assert.equal(JSON.parse(prepared.stdout).plan.kind, 'merge');
  await exec(process.execPath, ['dist/cli.js', 'wiki', 'preview', '--file', planFile, '--root', vault.root], { env });
  const applied = await exec(process.execPath, ['dist/cli.js', 'wiki', 'apply', '--file', planFile, '--root', vault.root], { env }); assert.ok(JSON.parse(applied.stdout).commit);
  const retry = await exec(process.execPath, ['dist/cli.js', 'wiki', 'apply', '--file', planFile, '--root', vault.root], { env }); assert.equal(JSON.parse(retry.stdout).commit, null);
  await writeFile(file, Buffer.alloc(1_000_001));
  await assert.rejects(exec(process.execPath, ['dist/cli.js', 'wiki', 'merge-prepare', '--file', file, '--root', vault.root], { env }));
});

for (const boundary of ['before-ready', 'after-ready'] as const) {
  test(`Wiki merge: expiry ${boundary} follows the recoverable commit boundary`, async t => {
    const { vault, input } = await fixture(t), now = Date.now, deadline = now() + 60_000;
    const pages = await Promise.all((await vault.wikiCatalog()).map(entry => vault.get(entry.id)));
    for (const page of pages) { page.meta.expiresAt = new Date(deadline).toISOString(); await save(vault, page); }
    const fromCommit = await vault.git.run(['rev-parse', 'HEAD']);
    for (const page of pages) { delete page.meta.expiresAt; await save(vault, page); }
    const prepared = await vault.wikiMergePrepare({ ...input, fromCommit }), head = await vault.git.run(['rev-parse', 'HEAD']);
    const write = VaultTransaction.prototype.write, commit = vault.git.commit;
    try {
      if (boundary === 'before-ready') {
        VaultTransaction.prototype.write = async function (path, content) {
          await write.call(this, path, content); if (path === 'log.md') Date.now = () => deadline + 1;
        };
        await assert.rejects(vault.wikiApply(prepared.plan), /no longer currently effective/);
        assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
      } else {
        vault.git.commit = async (...args) => { Date.now = () => deadline + 1; return commit.apply(vault.git, args); };
        const applied = await vault.wikiApply(prepared.plan); assert.ok(applied.commit);
        await assert.rejects(vault.get(wikiPageId(input.pageKey)), { code: 'NOT_FOUND' });
      }
    } finally { Date.now = now; VaultTransaction.prototype.write = write; vault.git.commit = commit; }
    assert.deepEqual(await readdir(join(vault.root, '.amem/transactions')), []);
  });
}
