import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { defaultVaultConfig } from '../src/config.js';
import { GitStore } from '../src/git-store.js';
import { LlmClient } from '../src/llm.js';
import { serializeMarkdown } from '../src/markdown.js';
import { withOperation } from '../src/operation.js';
import { applyPdfImport, previewPdfImport } from '../src/pdf-import.js';
import { localAdminPrincipal } from '../src/policy.js';
import type { MarkdownDocument, Scope, Sensitivity } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId, wikiPagePath } from '../src/wiki-schema.js';
import { assertSnapshotPath, snapshotReader } from '../src/wiki-snapshot.js';
import type { WikiPageDraft, WikiPageMeta } from '../src/wiki-types.js';
import { syntheticPdf } from './pdf-fixture.js';

async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal', scope: Scope = 'project') {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/wiki-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' });
  let calls = 0;
  llm.wiki = async <T>(operation: string, input: object) => {
    calls++;
    const data = input as { catalog: Array<{ key: string }>; sources: Array<{ id: string; body: string }> };
    if (operation === 'navigate') return { keys: data.catalog.map(page => page.key) } as T;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string, links: string[]): WikiPageDraft => ({
      key, pageType, title: key, summary: body.replace(/\s+/g, ' ').slice(0, 500), body, links, evidenceIds: data.sources.map(source => source.id), status: 'active', conditions: ['Synthetic project only.'], uncertainty: ['Fixture, not verified advice.'],
    });
    return { pages: [...data.sources.map(source => draft(`source:${source.id}`, 'source', source.body, ['entity:atlas'])),
      draft('entity:atlas', 'entity', data.sources.map(source => source.body).join('\n'), data.sources.map(source => `source:${source.id}`))] } as T;
  };
  const key = '71'.repeat(32), vault = new MemoryVault(root, { masterKey: key, llm });
  await vault.initialize('Revision views');
  const first = await vault.capture({ content: 'snapshot-original-v1', scope, sensitivity, extract: false });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const commit = await vault.git.run(['rev-parse', 'HEAD']);
  return { root, key, vault, llm, first, commit, calls: () => calls };
}

async function save(vault: MemoryVault, document: MarkdownDocument<object>) {
  await writeFile(join(vault.root, document.path), serializeMarkdown(document.meta, document.body));
  return vault.git.commit('synthetic snapshot boundary', vault.principal, ['wiki', 'evidence', 'agent-memory.json']);
}

test('Wiki snapshot: exact old text/graph with current revisions; no model, source text, refs, index or canonical writes', async t => {
  const { vault, first, commit, calls } = await fixture(t);
  const original = await vault.get(wikiPageId('entity:atlas'));
  const second = await vault.capture({ content: 'snapshot-updated-v2', extract: false });
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const head = await vault.git.run(['rev-parse', 'HEAD']), index = await readFile(join(vault.git.gitDir, 'index'));
  const before = await readFile(join(vault.root, original.path)), requestCount = calls();
  const result = await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] });
  assert.equal(result.commit, commit); assert.equal(result.authorityHead, head); assert.equal(result.kind, 'wiki-revision-view');
  assert.equal(result.pages.length, 2, 'cyclic dependencies are included once');
  const old = result.pages.find(page => page.meta.id === original.meta.id)!;
  assert.deepEqual({ meta: old.meta, body: old.body }, { meta: original.meta, body: original.body });
  assert.equal(old.currentRevision, 2); assert.equal(old.meta.revision, 1);
  assert.equal(result.sources[0]!.id, first.evidenceId); assert.equal(result.sources[0]!.sha256, (await vault.get(first.evidenceId)).meta.sha256);
  assert.equal(calls(), requestCount); assert.deepEqual(await readFile(join(vault.root, original.path)), before);
  assert.deepEqual(await readFile(join(vault.git.gitDir, 'index')), index); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.doesNotMatch(JSON.stringify(result.sources), /snapshot-original|pdfOriginal/); assert.match(result.warnings.join(' '), /not.*approval|not.*current advice/);
  const readOnly = new MemoryVault(vault.root, { llm: vault.llm, principal: { ...localAdminPrincipal(), tenantId: (await vault.config()).tenantId, permissions: ['read'] } });
  assert.equal((await readOnly.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] })).pages.length, 2);
});

test('Wiki snapshot: reject refs, noncommits, nonancestors, missing keys and dirty managed files', async t => {
  const { vault, commit } = await fixture(t);
  const dangling = await vault.git.run(['commit-tree', 'HEAD^{tree}', '-m', 'unrelated synthetic object']);
  const tree = await vault.git.run(['rev-parse', 'HEAD^{tree}']);
  for (const value of ['HEAD', commit.slice(0, 8), '--help', '../x', commit.toUpperCase(), 'f'.repeat(40), dangling, tree]) {
    await assert.rejects(vault.wikiSnapshot({ commit: value, pageKeys: ['entity:atlas'] }));
  }
  for (const pageKeys of [[], ['entity:atlas', 'entity:atlas'], Array.from({ length: 26 }, (_, i) => `entity:${i}`), ['entity:missing']]) {
    await assert.rejects(vault.wikiSnapshot({ commit, pageKeys }));
  }
  const path = join(vault.root, wikiPagePath('entity:atlas')), before = await readFile(path);
  await writeFile(path, Buffer.concat([before, Buffer.from('\nmanual edit')]));
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), /managed changes/);
  await writeFile(path, before);
  await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] });
});

test('Wiki snapshot: tenant/read/scope boundaries and secret opt-in remain current before decryption', async t => {
  const { vault, root, key, llm, commit } = await fixture(t, 'secret', 'user');
  const tenantId = (await vault.config()).tenantId;
  for (const principal of [
    { ...localAdminPrincipal(), permissions: [] },
    { ...localAdminPrincipal(), tenantId: 'different-tenant' },
    { ...localAdminPrincipal(), tenantId, scopes: ['project'] as Scope[] },
    { ...localAdminPrincipal(), tenantId, maxSensitivity: 'internal' as Sensitivity },
  ]) {
    const restricted = new MemoryVault(root, { principal, masterKey: key, llm });
    await assert.rejects(restricted.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], includeSecret: true }));
  }
  const decrypt = vault.encryption.decrypt.bind(vault.encryption); let decrypts = 0;
  vault.encryption.decrypt = async (...args) => { decrypts++; return decrypt(...args); };
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }));
  assert.equal(decrypts, 0, 'opting out must not decrypt confidential records first');
  const result = await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], includeSecret: true });
  assert.match(result.pages[0]!.body, /snapshot-original-v1/);
  assert.doesNotMatch(await readFile(join(root, result.pages[0]!.path), 'utf8'), /snapshot-original-v1/);
  await vault.encryption.erase(result.sources[0]!.id);
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], includeSecret: true }));
});

test('Wiki snapshot: current revocation, expired old pages and removed historical dependencies fail rather than return partial knowledge', async t => {
  const { vault, commit, first } = await fixture(t);
  const root = await vault.get(wikiPageId('entity:atlas'));
  root.meta.links = []; root.meta.dependencies = {}; root.body = 'Current independent wording, with its retained evidence.';
  await save(vault, root);
  await vault.wikiRevoke(`source:${first.evidenceId}`, 'Synthetic source summary withdrawn');
  assert.ok((await vault.wikiCatalog()).some(page => page.key === 'entity:atlas'), 'current root remains usable without its old link');
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), { code: 'NOT_FOUND' });
  await vault.wikiRevoke('entity:atlas', 'Synthetic root withdrawn');
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), { code: 'NOT_FOUND' });
  const other = await fixture(t), page = await other.vault.get(wikiPageId('entity:atlas'));
  page.meta.expiresAt = '2000-01-01T00:00:00.000Z'; await save(other.vault, page);
  await assert.rejects(other.vault.wikiSnapshot({ commit: other.commit, pageKeys: ['entity:atlas'] }));
});

test('Wiki snapshot: historical tenant/config and historical provenance are validated, not just current metadata', async t => {
  const { vault, root, commit } = await fixture(t), configPath = join(root, 'agent-memory.json'), original = await readFile(configPath, 'utf8');
  await writeFile(configPath, JSON.stringify({ ...JSON.parse(original), tenantId: 'other-historical-tenant' }));
  const foreign = await vault.git.commit('synthetic foreign historical config', vault.principal, ['agent-memory.json']);
  await writeFile(configPath, original); await vault.git.commit('restore synthetic config', vault.principal, ['agent-memory.json']);
  await assert.rejects(vault.wikiSnapshot({ commit: foreign!, pageKeys: ['entity:atlas'] }), { code: 'NOT_FOUND' });
  const page = await vault.get(wikiPageId('entity:atlas')), originalPage = { ...page, meta: { ...page.meta } };
  page.meta.evidence = ['evidence/../../agent-memory.json'];
  const bad = await save(vault, page);
  await save(vault, originalPage);
  await assert.rejects(vault.wikiSnapshot({ commit: bad!, pageKeys: ['entity:atlas'] }));
  await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] });
});

test('Wiki snapshot: current rules and historical rule revisions both remain required', async t => {
  const { vault, first } = await fixture(t);
  await vault.wikiSetRules({ scope: 'project', sensitivity: 'internal', purpose: 'Synthetic rule version one', instructions: 'Preserve sources.' });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const commit = await vault.git.run(['rev-parse', 'HEAD']);
  const rule = (await vault.wikiRules())[0]!;
  await vault.wikiSetRules({ scope: 'project', sensitivity: 'internal', purpose: 'Synthetic rule version two', instructions: 'Preserve uncertainty.', expectedRevision: 1 });
  const result = await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] });
  assert.deepEqual(result.rules, [{ id: rule.meta.id, revision: 1 }]);
  assert.doesNotMatch(JSON.stringify(result.rules), /Preserve sources|instructions/);
  await rm(join(vault.root, rule.path)); await vault.git.commit('synthetic rule removed', vault.principal, ['wiki']);
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }));
});

test('Wiki snapshot: writer waits for the read; owned cancellation releases the lock and later work succeeds', async t => {
  const { vault, commit } = await fixture(t), run = vault.git.run.bind(vault.git);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  let pause = true;
  vault.git.run = async (args, options) => {
    args = args.filter(arg => arg !== '--no-replace-objects');
    if (pause && args[0] === 'cat-file' && args[1] === 'blob') { pause = false; started(); await gate; }
    return run(args, options);
  };
  const reading = vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] });
  await entered;
  let written = false;
  const writing = vault.capture({ content: 'Synthetic concurrent source', extract: false }).then(value => { written = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(written, false);
  release(); const snapshot = await reading, saved = await writing;
  assert.equal(snapshot.authorityHead, commit); assert.equal(await run(['rev-parse', 'HEAD']), saved.commit);
  const controller = new AbortController(); let cancel = true;
  vault.git.run = async (args, options) => {
    args = args.filter(arg => arg !== '--no-replace-objects');
    const result = await run(args, options);
    if (cancel && args[0] === 'ls-tree') { cancel = false; controller.abort(); }
    return result;
  };
  await assert.rejects(withOperation(controller.signal, () => vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] })), { code: 'OPERATION_CANCELLED' });
  vault.git.run = run;
  await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] });
  await vault.capture({ content: 'Synthetic after cancelled read', extract: false });
});

test('Wiki snapshot: detects external authority movement and pending recovery without changing canonical data', async t => {
  const { vault, commit } = await fixture(t), run = vault.git.run.bind(vault.git); let reads = 0;
  vault.git.run = async (args, options) => {
    args = args.filter(arg => arg !== '--no-replace-objects');
    if (args[0] === 'rev-parse' && ++reads === 2) return '0'.repeat(40);
    return run(args, options);
  };
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), /revision changed/);
  vault.git.run = run;
  await writeFile(join(vault.root, '.amem', 'sync-intent.json'), '{}');
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), { code: 'TRANSACTION_RECOVERY_FAILED' });
  await rm(join(vault.root, '.amem', 'sync-intent.json'));
  await mkdir(join(vault.root, '.amem', 'erasures'), { recursive: true });
  await writeFile(join(vault.root, '.amem', 'erasures', 'synthetic.json'), '{}');
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), { code: 'TRANSACTION_RECOVERY_FAILED' });
  await rm(join(vault.root, '.amem', 'erasures', 'synthetic.json'));
  assert.equal(await run(['rev-parse', 'HEAD']), commit);
});

test('Wiki snapshot: explicit and parent cancellation compose, and historical expiration is not hidden by a current extension', async t => {
  const { vault } = await fixture(t), page = await vault.get(wikiPageId('entity:atlas'));
  page.meta.expiresAt = '2000-01-01T00:00:00.000Z'; const expired = await save(vault, page);
  delete page.meta.expiresAt; await save(vault, page);
  await assert.rejects(vault.wikiSnapshot({ commit: expired!, pageKeys: ['entity:atlas'] }));
  const commit = await vault.git.run(['rev-parse', 'HEAD']), controller = new AbortController(); controller.abort();
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(withOperation(controller.signal, () => vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], signal: new AbortController().signal })), { code: 'OPERATION_CANCELLED' });
  await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], signal: new AbortController().signal });
});

test('Wiki snapshot: blob/document budgets and unsafe paths fail before unbounded object reads', async () => {
  const config = defaultVaultConfig('Synthetic sizes', 'synthetic-vault'), hash = '1'.repeat(40);
  let blobSize = 1, blobReads = 0, mode = '100644';
  const git = new GitStore('unused-synthetic-root');
  git.run = async args => {
    args = args.filter(arg => arg !== '--no-replace-objects');
    if (args[0] === 'config') return '';
    if (args[0] === 'rev-parse') return hash;
    if (args.includes('status') || args[0] === 'merge-base') return '';
    if (args[0] === 'ls-tree') return `${mode} blob ${hash} ${blobSize}\t${args.at(-1)!.slice(':(literal)'.length)}\0`;
    if (args[0] === 'cat-file' && args[1] === '-t') return 'commit';
    blobReads++; return JSON.stringify(config);
  };
  let reader = await snapshotReader(git, hash, config);
  blobSize = 10_000_001; await assert.rejects(reader.read('evidence/a.md'), { code: 'CONTENT_TOO_LARGE' }); assert.equal(blobReads, 1);
  blobSize = 1; reader = await snapshotReader(git, hash, config); blobSize = 10_000_000;
  await reader.read('evidence/a.md'); await assert.rejects(reader.read('evidence/b.md'), { code: 'CONTENT_TOO_LARGE' });
  blobSize = 1; reader = await snapshotReader(git, hash, config);
  for (let i = 0; i < 199; i++) await reader.read(`evidence/${i}.md`);
  await assert.rejects(reader.read('evidence/overflow.md'), { code: 'CONTENT_TOO_LARGE' });
  reader = await snapshotReader(git, hash, config); mode = '120000'; const count = blobReads;
  await assert.rejects(reader.read('evidence/symlink.md'), { code: 'NOT_FOUND' }); assert.equal(blobReads, count);
  for (const path of ['../secret.md', 'wiki/../secret.md', 'wiki/a\\b.md', 'wiki/a\n.md', 'wiki/a:other.md', 'wiki/.git/secret.md', 'agent-memory.json']) assert.throws(() => assertSnapshotPath(path));
});

test('Wiki snapshot: ordinary memory effective dates still restrict historical legacy reads', async t => {
  const { vault, first } = await fixture(t), at = new Date().toISOString();
  const memory = { path: 'wiki/synthetic-memory.md', body: 'Synthetic retained ordinary memory.', meta: {
    id: 'mem-aaaaaaaaaaaa', type: 'memory', key: 'Synthetic ordinary rule', kind: 'fact', scope: 'project', sensitivity: 'internal',
    createdAt: at, updatedAt: at, validatedAt: at, confidence: 0.9, status: 'active', evidence: [first.evidencePath], conditions: [], tags: [], revision: 1,
  } };
  const commit = await save(vault, memory);
  const result = await vault.wikiSnapshot({ commit: commit!, pageKeys: ['legacy:mem-aaaaaaaaaaaa'] });
  assert.equal(result.pages[0]!.meta.type, 'memory'); assert.equal(result.pages[0]!.body, memory.body);
  await vault.setMemoryValidity('mem-aaaaaaaaaaaa', { validFrom: '2099-01-01T00:00:00.000Z', validUntil: null, expectedRevision: 1 });
  await assert.rejects(vault.wikiSnapshot({ commit: commit!, pageKeys: ['legacy:mem-aaaaaaaaaaaa'] }), { code: 'NOT_FOUND' });
});

test('Wiki snapshot: an old secret classification is not bypassed by a currently lower-classified replacement', async t => {
  const { vault, root, key, llm, commit } = await fixture(t, 'secret');
  const page = await vault.get(wikiPageId('entity:atlas')), source = await vault.capture({ content: 'Current public replacement source.', scope: 'project', sensitivity: 'public', extract: false });
  page.meta.sensitivity = 'internal'; page.meta.evidence = [source.evidencePath]; page.meta.links = []; page.meta.dependencies = {};
  page.body = 'Current ordinary wording without prior confidential details.';
  await save(vault, page);
  const limited = new MemoryVault(root, { masterKey: key, llm, principal: { ...localAdminPrincipal(), tenantId: (await vault.config()).tenantId, permissions: ['read'], maxSensitivity: 'internal' } });
  let decrypts = 0;
  const decrypt = limited.encryption.decrypt.bind(limited.encryption);
  limited.encryption.decrypt = async (...args) => { decrypts++; return decrypt(...args); };
  await assert.rejects(limited.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], includeSecret: true }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal(decrypts, 0);
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }));
  assert.match(JSON.stringify((await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'], includeSecret: true })).pages), /snapshot-original-v1/);
});

test('Wiki snapshot: PDF sources validate without returning raw original bytes in the result', async t => {
  const { vault, root } = await fixture(t), path = join(root, 'synthetic.pdf'), bytes = syntheticPdf(['Synthetic PDF snapshot text.']);
  await writeFile(path, bytes);
  const source = await applyPdfImport(vault, await previewPdfImport(path));
  await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
  const commit = await vault.git.run(['rev-parse', 'HEAD']);
  const result = await vault.wikiSnapshot({ commit, pageKeys: [`source:${source.evidenceId}`] });
  assert.match(JSON.stringify(result.pages), /Synthetic PDF snapshot text/);
  assert.doesNotMatch(JSON.stringify(result), /pdfOriginal|JVBER/);
  assert.equal(JSON.stringify(result).includes(bytes.toString('base64')), false);
});

test('Wiki snapshot: expiration crossing during final authority checks rejects the whole view', async t => {
  const { vault } = await fixture(t), page = await vault.get(wikiPageId('entity:atlas'));
  const now = Date.now, timestamp = now();
  page.meta.links = []; page.meta.dependencies = {}; page.body = 'Independent synthetic expiring page.';
  page.meta.expiresAt = new Date(timestamp + 60_000).toISOString();
  const commit = await save(vault, page), run = vault.git.run.bind(vault.git); let reads = 0;
  vault.git.run = async (args, options) => {
    args = args.filter(arg => arg !== '--no-replace-objects');
    if (args[0] === 'rev-parse' && ++reads === 2) Date.now = () => timestamp + 120_000;
    return run(args, options);
  };
  try { await assert.rejects(vault.wikiSnapshot({ commit: commit!, pageKeys: ['entity:atlas'] }), { code: 'NOT_FOUND' }); }
  finally { Date.now = now; vault.git.run = run; }
});

test('Wiki snapshot: dependent-page budget refuses a complete oversized graph instead of truncation', async t => {
  const { vault, first } = await fixture(t), original = await vault.get(wikiPageId('entity:atlas'));
  for (let i = 0; i < 51; i++) {
    const key = `entity:chain-${i}`, next = `entity:chain-${(i + 1) % 51}`;
    const page = { path: wikiPagePath(key), body: 'Synthetic bounded chain.', meta: { ...original.meta, id: wikiPageId(key), key, links: [next], dependencies: { [next]: 1 }, evidence: [first.evidencePath] } };
    await writeFile(join(vault.root, page.path), serializeMarkdown(page.meta, page.body));
  }
  const commit = await vault.git.commit('synthetic oversized dependency graph', vault.principal, ['wiki']);
  await assert.rejects(vault.wikiSnapshot({ commit: commit!, pageKeys: ['entity:chain-0'] }), { code: 'CONTENT_TOO_LARGE' });
});

test('Wiki snapshot: compiled CLI returns a versioned local view and rejects symbolic refs', async t => {
  const { vault, commit } = await fixture(t), exec = promisify(execFile);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_')));
  const args = ['dist/cli.js', 'wiki', 'snapshot', 'entity:atlas', '--commit', commit, '--root', vault.root];
  const result = await exec(process.execPath, args, { env });
  assert.equal(JSON.parse(result.stdout).commit, commit);
  await assert.rejects(exec(process.execPath, args.map(value => value === commit ? 'HEAD' : value), { env }));
});

test('Wiki snapshot: replace refs cannot substitute pinned content; graft and partial-clone settings are rejected without fetch', async t => {
  const { vault, commit } = await fixture(t);
  const page = await vault.get(wikiPageId('entity:atlas')); page.body = 'Synthetic replacement body, not original.';
  await save(vault, page);
  const replacement = await vault.git.run(['rev-parse', 'HEAD']);
  await vault.git.run(['replace', commit, replacement]);
  const result = await vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] });
  assert.match(result.pages.find(record => record.meta.id === page.meta.id)!.body, /snapshot-original-v1/);
  assert.doesNotMatch(result.pages.find(record => record.meta.id === page.meta.id)!.body, /Synthetic replacement body/);
  await vault.git.run(['replace', '-d', commit]);
  await vault.git.run(['config', 'remote.synthetic.promisor', 'true']);
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), /local full history/);
  await vault.git.run(['config', '--unset', 'remote.synthetic.promisor']);
  await mkdir(join(vault.git.gitDir, 'info'), { recursive: true });
  await writeFile(join(vault.git.gitDir, 'info', 'grafts'), '');
  await assert.rejects(vault.wikiSnapshot({ commit, pageKeys: ['entity:atlas'] }), /local full history/);
});

for (const boundary of ['expiresAt', 'validUntil', 'abort'] as const) {
  test(`Wiki snapshot: lock cleanup crossing ${boundary} rejects after the actual lock release`, async t => {
    const { vault, first } = await fixture(t), timestamp = Date.now(), originalNow = Date.now;
    let pageKeys = ['entity:atlas'];
    if (boundary === 'expiresAt') {
      const page = await vault.get(wikiPageId('entity:atlas'));
      page.meta.expiresAt = new Date(timestamp + 60_000).toISOString(); page.meta.links = []; page.meta.dependencies = {};
      page.body = 'Synthetic expiring page with no linked page.'; await save(vault, page);
    } else if (boundary === 'validUntil') {
      const at = new Date(timestamp).toISOString();
      await save(vault, { path: 'wiki/cleanup-memory.md', body: 'Synthetic current interval.', meta: {
        id: 'mem-bbbbbbbbbbbb', type: 'memory', kind: 'fact', key: 'Cleanup interval', scope: 'project', sensitivity: 'internal',
        createdAt: at, updatedAt: at, validatedAt: at, confidence: 0.9, status: 'active', evidence: [first.evidencePath], conditions: [], tags: [], revision: 1,
        validUntil: new Date(timestamp + 60_000).toISOString(),
      } });
      pageKeys = ['legacy:mem-bbbbbbbbbbbb'];
    }
    const commit = await vault.git.run(['rev-parse', 'HEAD']), controller = new AbortController(), originalRm = fsPromises.rm;
    let injected = false;
    const hook = t.mock.method(fsPromises, 'rm', async (...args: Parameters<typeof fsPromises.rm>) => {
      if (!injected && String(args[0]) === join(vault.root, '.amem', 'write.lock')) {
        injected = true;
        if (boundary === 'abort') controller.abort(); else Date.now = () => timestamp + 120_000;
      }
      return originalRm(...args);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(vault.wikiSnapshot({ commit, pageKeys, signal: controller.signal }), { code: boundary === 'abort' ? 'OPERATION_CANCELLED' : 'NOT_FOUND' });
      assert.equal(injected, true);
    } finally { Date.now = originalNow; hook.mock.restore(); syncBuiltinESMExports(); }
    await vault.capture({ content: `Synthetic after ${boundary} cleanup`, extract: false });
  });
}

test('Wiki snapshot: a head change during the final status check cannot pass as stable authority', async () => {
  const config = defaultVaultConfig('Synthetic final status', 'synthetic-vault'), hash = '1'.repeat(40);
  let head = hash, statuses = 0;
  const git = new GitStore('unused-final-status-fixture');
  git.run = async args => {
    args = args.filter(arg => arg !== '--no-replace-objects');
    if (args[0] === 'config' || args[0] === 'merge-base') return '';
    if (args[0] === 'rev-parse') return head;
    if (args.includes('status')) { if (++statuses === 2) head = '2'.repeat(40); return ''; }
    if (args[0] === 'ls-tree') return `100644 blob ${hash} 100\tagent-memory.json\0`;
    if (args[0] === 'cat-file' && args[1] === '-t') return 'commit';
    return JSON.stringify(config);
  };
  const reader = await snapshotReader(git, hash, config);
  await assert.rejects(reader.finish(), /revision changed/);
});
