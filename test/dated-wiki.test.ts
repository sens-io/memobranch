import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fsPromises, { readFile, readdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import type { GitRunOptions } from '../src/git-store.js';
import { serializeMarkdown } from '../src/markdown.js';
import { localAdminPrincipal } from '../src/policy.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId } from '../src/wiki-schema.js';
import { after, atGitTime, before, fixture, masterKey, pageKey } from './dated-wiki-fixture.js';

test('dated Wiki: normalized recorded time selects complete old graph without changing explicit-hash shape, files, index or refs', async t => {
  const { vault, versions, input, calls } = await fixture(t);
  const head = await vault.git.run(['rev-parse', 'HEAD']), index = await readFile(join(vault.git.gitDir, 'index')), count = calls();
  const bytes = await Promise.all(versions.map(version => readFile(join(vault.root, version.evidencePath))));
  const result = await vault.wikiSnapshot(input), explicit = await vault.wikiSnapshot({ commit: versions[0]!.commit, pageKeys: [pageKey] });
  assert.equal(result.commit, versions[0]!.commit); assert.equal(result.authorityHead, head);
  assert.deepEqual(result.selection, { kind: 'git-committer-time', at: '2026-01-15T00:00:00.000Z',
    committedAt: '2026-01-10T00:00:00.000Z', traversal: 'first-parent', scannedCommits: result.selection!.scannedCommits });
  assert.ok(result.selection!.scannedCommits > 1); assert.deepEqual(result.pages, explicit.pages);
  assert.equal('selection' in explicit, false); assert.equal(result.pages.find(page => page.meta.id === wikiPageId(pageKey))!.body, versions[0]!.body);
  assert.equal(result.pages.find(page => page.meta.id === wikiPageId(pageKey))!.currentRevision, 2);
  assert.doesNotMatch(JSON.stringify(result.sources), /DATED_WIKI_/); assert.match(result.warnings.join(' '), /mutable Git committer/);
  assert.equal(calls(), count); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.deepEqual(await readFile(join(vault.git.gitDir, 'index')), index);
  for (const [i, version] of versions.entries()) assert.deepEqual(await readFile(join(vault.root, version.evidencePath)), bytes[i]);
  assert.equal((await vault.wikiSnapshot({ ...input, at: '2026-01-10T08:00:00+08:00' })).commit, versions[0]!.commit, 'inclusive timestamp and tied commits choose last ancestry entry');
  assert.equal((await vault.wikiSnapshot({ ...input, at: after })).commit, head);
  const future = await vault.wikiSnapshot({ ...input, at: '2099-01-01T00:00:00Z' }); assert.equal(future.commit, head); assert.equal(future.selection!.scannedCommits, 1);
});

test('dated Wiki: invalid, missing and ambiguous selectors never choose a fallback version', async t => {
  const { vault, input, versions } = await fixture(t), head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const at of ['2026-01-15', '2026-02-30T00:00:00Z', '2026-01-15T00:00:00.0001Z', 'tomorrow', '2026-01-15T00:00:00', '', '--all']) {
    await assert.rejects(vault.wikiSnapshot({ ...input, at }), { code: 'VALIDATION_FAILED' });
  }
  for (const value of [{ pageKeys: [pageKey] }, { ...input, commit: versions[0]!.commit }, { ...input, actor: 'admin' }, { ...input, pageKeys: [pageKey, pageKey] }]) {
    await assert.rejects(vault.wikiSnapshot(value as any), { code: 'VALIDATION_FAILED' });
  }
  await assert.rejects(vault.wikiSnapshot({ ...input, at: '2025-12-31T23:59:59Z' }), { code: 'NOT_FOUND' });
  await assert.rejects(vault.wikiSnapshot({ ...input, at: '2026-01-05T00:00:00Z' }), { code: 'NOT_FOUND' }, 'selected initialization lacks this page; do not substitute later content');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('dated Wiki: author time is ignored and backwards committer clocks remain ancestry-first without --until', async t => {
  const { vault, input } = await fixture(t);
  await atGitTime('2026-01-25T00:00:00Z', () => vault.git.run(['commit', '--allow-empty', '--no-gpg-sign', '-m', 'synthetic late committer'], { actor: vault.principal }), '2026-01-02T00:00:00Z');
  assert.equal((await vault.wikiSnapshot({ ...input, at: '2026-01-21T00:00:00Z' })).selection!.committedAt, '2026-01-20T00:00:00.000Z');
  await atGitTime('2026-01-12T00:00:00Z', () => vault.git.run(['commit', '--allow-empty', '--no-gpg-sign', '-m', 'synthetic backwards committer'], { actor: vault.principal }));
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await vault.wikiSnapshot(input)).commit, head, 'newest ancestry entry can have an older clock than its parent');
  const older = await vault.wikiSnapshot({ ...input, at: before });
  assert.equal(older.selection!.committedAt, '2026-01-10T00:00:00.000Z', 'future-dated parents cannot hide an older eligible ancestor');
});

test('dated Wiki: side-parent dates cannot independently select an unmerged version', async t => {
  const { vault, input, versions } = await fixture(t), main = await vault.git.run(['rev-parse', 'HEAD']), tree = await vault.git.run(['rev-parse', 'HEAD^{tree}']);
  const side = await atGitTime('2026-01-14T00:00:00Z', () => vault.git.run(['commit-tree', tree, '-p', versions[0]!.commit, '-m', 'synthetic side state'], { actor: vault.principal }));
  const merge = await atGitTime('2026-01-30T00:00:00Z', () => vault.git.run(['commit-tree', tree, '-p', main, '-p', side, '-m', 'synthetic merge'], { actor: vault.principal }));
  await vault.git.run(['update-ref', 'HEAD', merge, main]);
  const result = await vault.wikiSnapshot(input);
  assert.equal(result.commit, versions[0]!.commit); assert.notEqual(result.commit, side);
  assert.equal(result.pages.find(page => page.meta.id === wikiPageId(pageKey))!.body, versions[0]!.body);
  assert.equal((await vault.wikiSnapshot({ ...input, at: '2026-01-30T00:00:00Z' })).commit, merge);
});

test('dated Wiki: bounded traversal, explicit formatting and Git safety precede any historical body read', async t => {
  const { vault, input, versions } = await fixture(t); const original = vault.git.run.bind(vault.git); let mode = 'overflow', logs = 0;
  const hook = t.mock.method(vault.git, 'run', async (args: string[], options?: GitRunOptions) => {
    if (!args.includes('log')) return original(args, options);
    logs++; assert.ok(args.includes('--no-replace-objects')); assert.ok(args.includes('--first-parent'));
    for (const flag of ['--max-count=2001', '--no-notes', '--no-show-signature', '--no-patch']) assert.ok(args.includes(flag));
    assert.ok(!args.some((arg: string) => arg.startsWith('--until')));
    const late = `${versions[1]!.commit}\0${after}`;
    if (mode === 'overflow') return Array(2001).fill(late).join('\n');
    if (mode === 'boundary') return [...Array(1999).fill(late), `${versions[0]!.commit}\0${before}`, late].join('\n');
    return 'malformed local log output';
  });
  await assert.rejects(vault.wikiSnapshot(input), { code: 'CONTENT_TOO_LARGE' });
  mode = 'boundary'; assert.equal((await vault.wikiSnapshot(input)).selection!.scannedCommits, 2000);
  mode = 'invalid'; await assert.rejects(vault.wikiSnapshot(input), { code: 'VALIDATION_FAILED' });
  const count = logs;
  await original(['config', 'remote.synthetic.promisor', 'true']);
  try { await assert.rejects(vault.wikiSnapshot(input), /without grafts or partial-clone/); assert.equal(logs, count); }
  finally { await original(['config', '--unset', 'remote.synthetic.promisor']); hook.mock.restore(); }
});

test('dated Wiki: current authority, confidential opt-in and destroyed keys cannot be bypassed by an old date', async t => {
  const { vault, input, versions, llm } = await fixture(t, 'secret');
  const identity = { ...localAdminPrincipal(), tenantId: (await vault.config()).tenantId, permissions: ['read'] as const };
  for (const principal of [{ ...identity, permissions: [] }, { ...identity, tenantId: 'foreign' },
    { ...identity, scopes: ['public'] as const }, { ...identity, maxSensitivity: 'internal' as const }]) {
    const reader = new MemoryVault(vault.root, { principal: { ...principal, permissions: [...principal.permissions], scopes: [...principal.scopes] }, masterKey, llm });
    await assert.rejects(reader.wikiSnapshot({ ...input, includeSecret: true }), error => !String(error).includes('DATED_WIKI_'));
  }
  const decrypt = vault.encryption.decrypt.bind(vault.encryption); let decrypts = 0;
  vault.encryption.decrypt = async (...args) => { decrypts++; return decrypt(...args); };
  await assert.rejects(vault.wikiSnapshot(input)); assert.equal(decrypts, 0);
  assert.ok((await vault.wikiSnapshot({ ...input, includeSecret: true })).pages.length);
  await vault.encryption.erase(versions[0]!.evidenceId);
  await assert.rejects(vault.wikiSnapshot({ ...input, includeSecret: true }), error => !String(error).includes('DATED_WIKI_'));
  const other = await fixture(t); await other.vault.wikiRevoke(pageKey, 'Synthetic current withdrawal');
  await assert.rejects(other.vault.wikiSnapshot(other.input), { code: 'NOT_FOUND' });
});

test('dated Wiki: external HEAD change after date resolution refuses a partial view without undoing the external commit', async t => {
  const { vault, input } = await fixture(t), original = vault.git.run.bind(vault.git); let external = '';
  const hook = t.mock.method(vault.git, 'run', async (args: string[], options?: GitRunOptions) => {
    const result = await original(args, options);
    if (args.includes('log') && !external) {
      await original(['commit', '--allow-empty', '--no-gpg-sign', '-m', 'synthetic external change'], { actor: vault.principal });
      external = await original(['rev-parse', 'HEAD']);
    }
    return result;
  });
  await assert.rejects(vault.wikiSnapshot(input), /revision changed/); hook.mock.restore();
  assert.ok(external); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), external);
  assert.equal((await vault.wikiSnapshot(input)).authorityHead, external);
});

test('dated Wiki: actual asynchronous lock release still checks historical expiry', async t => {
  const { vault, input } = await fixture(t), now = Date.now, deadline = now() + 60_000;
  const pages = await Promise.all((await vault.wikiCatalog()).map(page => vault.get(page.id)));
  for (const page of pages) { page.meta.expiresAt = new Date(deadline).toISOString(); await writeFile(join(vault.root, page.path), serializeMarkdown(page.meta, page.body)); }
  await atGitTime('2026-01-12T00:00:00Z', () => vault.git.commit('synthetic dated expiring snapshot', vault.principal));
  for (const page of pages) { delete page.meta.expiresAt; await writeFile(join(vault.root, page.path), serializeMarkdown(page.meta, page.body)); }
  await atGitTime('2026-01-20T00:00:00Z', () => vault.git.commit('synthetic current extended deadline', vault.principal));
  assert.ok((await vault.wikiSnapshot(input)).selection, 'The same complete historical graph is valid before the cleanup deadline injection');
  const original = fsPromises.rm; let injected = false;
  const hook = t.mock.method(fsPromises, 'rm', async (...args: Parameters<typeof fsPromises.rm>) => {
    if (!injected && String(args[0]) === join(vault.root, '.amem/write.lock')) { injected = true; Date.now = () => deadline + 1; }
    return original(...args);
  }); syncBuiltinESMExports();
  try { await assert.rejects(vault.wikiSnapshot(input), { code: 'NOT_FOUND' }); assert.equal(injected, true); }
  finally { Date.now = now; hook.mock.restore(); syncBuiltinESMExports(); }
  assert.ok((await vault.wikiSnapshot(input)).selection);
});

test('dated Wiki: cancelling a real lock waiter preserves its owner and later reads succeed', async t => {
  const { vault, input } = await fixture(t), lock = join(vault.root, '.amem/write.lock'), head = await vault.git.run(['rev-parse', 'HEAD']);
  let entered!: () => void, release!: () => void;
  const acquired = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const owner = withFileLock(lock, async () => { entered(); await gate; }); const controller = new AbortController();
  try {
    await acquired;
    const pending = vault.wikiSnapshot({ ...input, signal: controller.signal }); const check = assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
    const until = Date.now() + 4000;
    while ((await readdir(`${lock}.queue`)).length < 2) { assert.ok(Date.now() < until); await delay(10); }
    controller.abort(); await check; assert.equal((await readdir(`${lock}.queue`)).length, 1); assert.equal(existsSync(lock), true);
    assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  } finally { controller.abort(); release(); await owner; }
  assert.ok((await vault.wikiSnapshot(input)).selection);
});
