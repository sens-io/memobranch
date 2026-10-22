import assert from 'node:assert/strict';
import fsPromises, { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { LlmClient } from '../src/llm.js';
import { serializeMarkdown } from '../src/markdown.js';
import { cancellationError, operationSignal } from '../src/operation.js';
import type { Principal } from '../src/policy.js';
import type { Sensitivity } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';
import { startWebServer, type WebHandle } from '../src/web.js';
import { wikiPageId } from '../src/wiki-schema.js';
import type { WikiPageDraft } from '../src/wiki-types.js';
import { fixture as datedFixture, pageKey as datedKey } from './dated-wiki-fixture.js';

async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/web-merge-')), handles: WebHandle[] = [];
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let calls = 0;
  llm.wiki = async <T>(operation: string, input: object) => {
    calls++; const data = input as { catalog: Array<{ key: string }>; sources: Array<{ id: string; body: string }> };
    if (operation === 'navigate') return { keys: data.catalog.map(page => page.key) } as T;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string): WikiPageDraft => ({ key, pageType, title: 'Synthetic merge',
      summary: 'Synthetic summary.', body, evidenceIds: data.sources.map(source => source.id), links: [], status: 'active', conditions: ['Only a synthetic example.'], uncertainty: ['Needs verification.'] });
    return { pages: [...data.sources.map(source => draft(`source:${source.id}`, 'source', source.body)), draft('entity:web-merge', 'entity', data.sources.map(source => source.body).join('\n'))] } as T;
  };
  const masterKey = '83'.repeat(32), vault = new MemoryVault(join(root, 'vault'), { llm, masterKey }); await vault.initialize('Web merge fixture');
  const first = await vault.capture({ content: 'WEB_MERGE_OLD_CANARY', scope: 'project', sensitivity, extract: false }); await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const fromCommit = await vault.git.run(['rev-parse', 'HEAD']), oldBody = (await vault.get(wikiPageId('entity:web-merge'))).body;
  const second = await vault.capture({ content: 'WEB_MERGE_CURRENT_CANARY', scope: 'project', sensitivity, extract: false }); await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const input = { fromCommit, pageKey: 'entity:web-merge', expectedRevision: 2, body: '人工合并 🧠📚 with source conditions retained.', summary: 'Reviewed synthetic combination.' };
  const start = async (principal?: Principal) => { const handle = await startWebServer(vault.root, { llm, masterKey, ...(principal ? { principal } : {}) }); handles.push(handle); return handle; };
  t.after(async () => { await Promise.all(handles.map(handle => handle.stop())); await rm(root, { recursive: true, force: true }); });
  return { vault, input, first, second, oldBody, start, calls: () => calls };
}

async function call(handle: WebHandle, operation: string, data: unknown = {}, extra: Record<string, string> = {}) {
  const response = await fetch(`${handle.url}/api/${operation}`, { method: 'POST', headers: {
    Origin: handle.url, Authorization: `Bearer ${handle.token}`, 'Content-Type': 'application/json', ...extra,
  }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() as { result: any; error?: { code: string } } };
}

test('Web dated comparison: resolve once, pin the real hash for preparation and approve separately without rewriting sources',async t=>{
  const example=await datedFixture(t),{vault,llm,versions}=example,handle=await startWebServer(vault.root,{llm,masterKey:'85'.repeat(32)});example.cleanup.push(()=>handle.stop());
  const head=await vault.git.run(['rev-parse','HEAD']),count=example.calls(),sources=await Promise.all(versions.map(version=>readFile(join(vault.root,version.evidencePath))));
  const selected=await call(handle,'wiki-snapshot',example.input);assert.equal(selected.status,200);const base=selected.body.result;assert.equal(base.commit,versions[0]!.commit);assert.ok(base.selection);
  const current=await call(handle,'wiki-snapshot',{commit:base.authorityHead,pageKeys:[datedKey]});assert.equal(current.status,200);assert.equal('selection' in current.body.result,false);
  const input={fromCommit:base.commit,pageKey:datedKey,expectedRevision:2,body:'Human-reviewed dated combination 中文 🧠.',summary:'Reviewed date-selected source conditions.'};
  const prepared=await call(handle,'merge-prepare',input);assert.equal(prepared.status,200);assert.equal(prepared.body.result.plan.merge.fromCommit,versions[0]!.commit);assert.equal('at' in prepared.body.result.plan.merge,false);
  assert.equal(await vault.git.run(['rev-parse','HEAD']),head);assert.equal(example.calls(),count);assert.equal((await call(handle,'apply',{plan:prepared.body.result.plan})).status,400);
  const applied=await call(handle,'apply',{plan:prepared.body.result.plan,confirm:true});assert.equal(applied.status,200);assert.ok(applied.body.result.commit);
  assert.deepEqual((await call(handle,'apply',{plan:prepared.body.result.plan,confirm:true})).body.result,{pageIds:[],commit:null});
  for(const [i,version] of versions.entries())assert.deepEqual(await readFile(join(vault.root,version.evidencePath)),sources[i]);assert.equal(example.calls(),count);
});

test('Web merge: complete historical/current reads, signed preview, separate approval and exact retry preserve both sources', async t => {
  const { vault, input, first, second, oldBody, start, calls } = await fixture(t), handle = await start();
  const head = await vault.git.run(['rev-parse', 'HEAD']), count = calls(), firstBytes = await readFile(join(vault.root, first.evidencePath)), secondBytes = await readFile(join(vault.root, second.evidencePath));
  const base = await call(handle, 'wiki-snapshot', { commit: input.fromCommit, pageKeys: [input.pageKey] }); assert.equal(base.status, 200);
  assert.equal(base.body.result.pages.find((page: any) => page.meta.key === input.pageKey).body, oldBody);
  const current = await call(handle, 'wiki-snapshot', { commit: base.body.result.authorityHead, pageKeys: [input.pageKey] }); assert.equal(current.status, 200);
  assert.equal(current.body.result.pages.find((page: any) => page.meta.key === input.pageKey).body, (await vault.get(wikiPageId(input.pageKey))).body);
  const prepared = await call(handle, 'merge-prepare', input); assert.equal(prepared.status, 200); assert.equal(prepared.body.result.plan.kind, 'merge');
  assert.equal(prepared.body.result.comparison.base.pages.find((page: any) => page.meta.key === input.pageKey).body, oldBody);
  const preview = await call(handle, 'preview', { plan: prepared.body.result.plan }); assert.equal(preview.status, 200); assert.deepEqual(preview.body.result, prepared.body.result.preview);
  assert.equal(calls(), count); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal((await call(handle, 'apply', { plan: prepared.body.result.plan })).status, 400);
  const applied = await call(handle, 'apply', { plan: prepared.body.result.plan, confirm: true }); assert.equal(applied.status, 200); assert.ok(applied.body.result.commit);
  const target = preview.body.result.pages.find((page: any) => page.key === input.pageKey);
  assert.equal((await vault.get(wikiPageId(input.pageKey))).body, target.after.body); assert.ok(target.after.body.includes(input.body));
  assert.deepEqual(new Set(target.after.evidence), new Set([first.evidencePath, second.evidencePath]));
  assert.deepEqual(await readFile(join(vault.root, first.evidencePath)), firstBytes); assert.deepEqual(await readFile(join(vault.root, second.evidencePath)), secondBytes);
  assert.deepEqual((await call(handle, 'apply', { plan: prepared.body.result.plan, confirm: true })).body.result, { pageIds: [], commit: null }); assert.equal(calls(), count);
});

test('Web merge: read/write/review, tenant, secret selection, forged/stale plans and foreign fields stay separate', async t => {
  const { vault, input, start } = await fixture(t, 'secret'), handle = await start();
  const tenantId = (await vault.config()).tenantId, identity = { ...vault.principal, tenantId };
  const reader = await start({ ...identity, permissions: ['read'] }), writer = await start({ ...identity, permissions: ['read', 'write'] });
  const options = { commit: input.fromCommit, pageKeys: [input.pageKey] };
  assert.notEqual((await call(handle, 'wiki-snapshot', options)).status, 200);
  assert.notEqual((await call(handle, 'merge-prepare', input)).status, 200);
  assert.equal((await call(reader, 'wiki-snapshot', { ...options, includeSecret: true })).status, 200);
  assert.equal((await call(reader, 'merge-prepare', { ...input, includeSecret: true })).status, 403);
  for (const patch of [{ root: '/foreign/vault' }, { signal: {} }, { apply: true }, { expectedRevision: 1 }, { body: 'Malformed \uD800 body.' }, { body: '<script>notExecutable()</script>' }]) {
    assert.notEqual((await call(handle, 'merge-prepare', { ...input, includeSecret: true, ...patch })).status, 200);
  }
  for (const patch of [{ commit: 'HEAD' }, { pageKeys: [input.pageKey, input.pageKey] }, { root: '/foreign/vault' }]) {
    assert.notEqual((await call(handle, 'wiki-snapshot', { ...options, includeSecret: true, ...patch })).status, 200);
  }
  const prepared = (await call(writer, 'merge-prepare', { ...input, includeSecret: true })).body.result;
  assert.equal((await call(reader, 'preview', { plan: prepared.plan })).status, 200);
  assert.equal((await call(writer, 'apply', { plan: prepared.plan, confirm: true })).status, 403);
  const forged = structuredClone(prepared.plan); forged.pages[0].body = 'Changed after signing';
  assert.equal((await call(handle, 'apply', { plan: forged, confirm: true })).status, 400);
  const outsider = await start({ ...identity, tenantId: 'foreign-tenant', permissions: ['read', 'write', 'review'] }).catch(() => null);
  assert.equal(outsider, null, 'server initialization also requires the current tenant');
  await vault.encryption.erase(prepared.plan.sourceIds[0]);
  assert.notEqual((await call(handle, 'apply', { plan: prepared.plan, confirm: true })).status, 200);
});

test('Web merge: token/origin boundaries and stale current inputs never apply implicitly', async t => {
  const { vault, input, start } = await fixture(t), handle = await start(), head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const operation of ['wiki-snapshot', 'merge-prepare']) {
    const data = operation === 'wiki-snapshot' ? { commit: input.fromCommit, pageKeys: [input.pageKey] } : input;
    for (const headers of [{ Origin: 'https://foreign.example' }, { Authorization: 'Bearer wrong' }]) assert.equal((await call(handle, operation, data, headers)).status, 403);
  }
  const prepared = (await call(handle, 'merge-prepare', input)).body.result;
  const added = await vault.capture({ content: 'Explicitly update the current compiled page.', scope: 'project', extract: false });
  await vault.wikiIngest({ evidenceIds: [added.evidenceId], apply: true });
  assert.notEqual(await vault.git.run(['rev-parse', 'HEAD']), head);
  const current = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await call(handle, 'preview', { plan: prepared.plan })).status, 400);
  assert.equal((await call(handle, 'apply', { plan: prepared.plan, confirm: true })).status, 400);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), current);
});

test('Web merge: complete responses and resubmittable plans fit the review transport or fail closed', async t => {
  const { vault, input, start } = await fixture(t), handle = await start(), prepared = await vault.wikiMergePrepare(input);
  const oversized = 'x'.repeat(16 * 1_048_576);
  const merge = t.mock.method(MemoryVault.prototype, 'wikiMergePrepare', async () => ({ ...prepared, comparison: { ...prepared.comparison, current: { ...prepared.comparison.current, body: oversized } } }));
  assert.equal((await call(handle, 'merge-prepare', input)).body.error?.code, 'CONTENT_TOO_LARGE'); merge.mock.restore();
  const plan = structuredClone(prepared.plan); plan.pages[0]!.body = oversized;
  const largePlan = t.mock.method(MemoryVault.prototype, 'wikiMergePrepare', async () => ({ ...prepared, plan }));
  assert.equal((await call(handle, 'merge-prepare', input)).body.error?.code, 'CONTENT_TOO_LARGE'); largePlan.mock.restore();
  const snapshot = await vault.wikiSnapshot({ commit: input.fromCommit, pageKeys: [input.pageKey] }); snapshot.pages[0]!.body = oversized;
  const largeSnapshot = t.mock.method(MemoryVault.prototype, 'wikiSnapshot', async () => snapshot);
  assert.equal((await call(handle, 'wiki-snapshot', { commit: input.fromCommit, pageKeys: [input.pageKey] })).body.error?.code, 'CONTENT_TOO_LARGE'); largeSnapshot.mock.restore();
  const request = await call(handle, 'merge-prepare', { ...input, body: 'x'.repeat(1_048_577) }); assert.equal(request.status, 413);
});

for (const operation of ['wiki-snapshot', 'merge-prepare']) {
  test(`Web merge: ${operation} retains its own post-lock historical deadline check`, async t => {
    const { vault, input, start } = await fixture(t), now = Date.now, deadline = now() + 60_000;
    const pages = await Promise.all((await vault.wikiCatalog()).map(page => vault.get(page.id)));
    for (const page of pages) { page.meta.expiresAt = new Date(deadline).toISOString(); await writeFile(join(vault.root, page.path), serializeMarkdown(page.meta, page.body)); }
    await vault.git.commit('synthetic historical deadline', vault.principal); const fromCommit = await vault.git.run(['rev-parse', 'HEAD']);
    for (const page of pages) { delete page.meta.expiresAt; await writeFile(join(vault.root, page.path), serializeMarkdown(page.meta, page.body)); }
    await vault.git.commit('synthetic current extended deadline', vault.principal); const handle = await start(), head = await vault.git.run(['rev-parse', 'HEAD']);
    const original = fsPromises.rm; let injected = false;
    const hook = t.mock.method(fsPromises, 'rm', async (...args: Parameters<typeof fsPromises.rm>) => {
      if (!injected && String(args[0]) === join(vault.root, '.amem', 'write.lock')) { injected = true; Date.now = () => deadline + 1; }
      return original(...args);
    }); syncBuiltinESMExports();
    try {
      const data = operation === 'wiki-snapshot' ? { commit: fromCommit, pageKeys: [input.pageKey] } : { ...input, fromCommit };
      const response = await call(handle, operation, data); assert.notEqual(response.status, 200); assert.equal(injected, true);
      assert.doesNotMatch(JSON.stringify(response.body), /WEB_MERGE_|人工合并/);
    } finally { Date.now = now; hook.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
    assert.equal((await call(handle, 'wiki-snapshot', { commit: fromCommit, pageKeys: [input.pageKey] })).status, 200);
  });
}

test('Web merge: shutdown owns cancellation and awaits an active read without writing', async t => {
  const { vault, input, start } = await fixture(t), handle = await start(), head = await vault.git.run(['rev-parse', 'HEAD']);
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let cancelled = false;
  const hook = t.mock.method(MemoryVault.prototype, 'wikiSnapshot', async () => new Promise<never>((_resolve, reject) => {
    const signal = operationSignal(); entered();
    signal!.addEventListener('abort', () => { cancelled = true; reject(cancellationError()); }, { once: true });
  }));
  const read = call(handle, 'wiki-snapshot', { commit: input.fromCommit, pageKeys: [input.pageKey] }).catch(() => null);
  await started; await handle.stop(); await read; hook.mock.restore(); assert.equal(cancelled, true);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});
