import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { applyPdfImport, previewPdfImport, readPdfImportPlan, readPdfOriginal, serializePdfImportPlan } from '../src/pdf-import.js';
import { assertEvidenceDocument } from '../src/evidence.js';
import { LlmClient } from '../src/llm.js';
import { parseMarkdown } from '../src/markdown.js';
import { withOperation } from '../src/operation.js';
import { localAdminPrincipal } from '../src/policy.js';
import type { EvidenceMeta, PdfOriginal } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';
import { VaultTransaction } from '../src/transaction.js';
import { syntheticPdf, unicodePdf } from './pdf-fixture.js';

async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/pdf-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source.pdf'), bytes = syntheticPdf(['Synthetic source page one.', '', 'Synthetic source page three.']);
  await writeFile(path, bytes);
  const vault = new MemoryVault(join(root, 'vault'), { masterKey: '61'.repeat(32), llm: new LlmClient({ apiKey: '', embeddingModel: '' }) });
  await vault.initialize('PDF fixture');
  return { root, path, bytes, vault };
}

test('PDF: preview omits bodies/bytes; apply preserves page numbers, exact original and evidence-only/idempotent writes', async t => {
  const { path, bytes, vault } = await fixture(t);
  const plan = await previewPdfImport(path);
  assert.equal(plan.pages.length, 3); assert.equal(plan.pages[1]!.empty, true);
  assert.match(plan.parser, /^unpdf\/1\.7\.0 PDF\.js\//);
  assert.match(plan.warnings.join('\n'), /Page 2.*OCR not run/);
  assert.doesNotMatch(JSON.stringify(plan), /Synthetic source|JVBER/);
  const result = await applyPdfImport(vault, plan);
  const document = await vault.get(result.evidenceId);
  assert.match(document.body, /## Page 1\n\nSynthetic source page one\.[\s\S]*## Page 2\n\n\[No extractable text; OCR not run\.\][\s\S]*## Page 3/);
  assert.equal(document.meta.digestVersion, 3);
  assert.deepEqual(await readPdfOriginal(vault, result.evidenceId), bytes);
  assert.deepEqual(await readFile(path), bytes);
  assert.equal((await vault.listRecords({ collection: 'candidates' })).total, 0);
  assert.equal((await vault.wikiCatalog()).length, 0);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  assert.deepEqual({ duplicate: (await applyPdfImport(vault, plan)).duplicate, head: await vault.git.run(['rev-parse', 'HEAD']) }, { duplicate: true, head });
});

test('PDF: drift and modified preview fail before writes; changed source becomes a distinct version', async t => {
  const { path, vault } = await fixture(t), plan = await previewPdfImport(path);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  for (const input of [{ ...plan, revision: '0'.repeat(64) }, { ...plan, pages: [] }, { ...plan, warnings: [] }, { ...plan, parser: 'untrusted' }]) {
    await assert.rejects(applyPdfImport(vault, input), /preview changed/);
  }
  await writeFile(path, syntheticPdf(['Changed source version.']));
  await assert.rejects(applyPdfImport(vault, plan), /preview changed/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const first = await applyPdfImport(vault, await previewPdfImport(path));
  await writeFile(path, syntheticPdf(['Another source version.']));
  const second = await applyPdfImport(vault, await previewPdfImport(path));
  assert.notEqual(first.evidenceId, second.evidenceId);
  assert.equal((await vault.sourceTimeline(plan.sourceUri)).total, 2);
});

test('PDF: source/header/textless/page/byte limits and symlinks reject without evidence', async t => {
  const { path, root, vault } = await fixture(t);
  for (const [bytes, code] of [
    [Buffer.from('not a PDF'), 'VALIDATION_FAILED'], [Buffer.from('%PDF-1.7\n%%EOF'), 'VALIDATION_FAILED'],
    [syntheticPdf(['']), 'VALIDATION_FAILED'], [syntheticPdf(Array(101).fill('page')), 'CONTENT_TOO_LARGE'],
    [syntheticPdf(['x'.repeat(200_001)], '', 0.001), 'CONTENT_TOO_LARGE'],
    [Buffer.alloc(5_000_001), 'CONTENT_TOO_LARGE'],
  ] as const) {
    await writeFile(path, bytes); await assert.rejects(previewPdfImport(path), { code });
  }
  const link = join(root, 'link.pdf'); await symlink(path, link);
  await assert.rejects(previewPdfImport(link), /symbolic links/);
  await assert.rejects(previewPdfImport(root), /regular file/);
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 0);
});

test('PDF: embedded Unicode mappings preserve Chinese text and parser-based character limits', async t => {
  const { path, vault } = await fixture(t), text = '中文页码与来源 PDF';
  await writeFile(path, unicodePdf(text));
  const captured = await applyPdfImport(vault, await previewPdfImport(path));
  assert.ok((await vault.get(captured.evidenceId)).body.includes(text));
});

test('PDF: password-protected synthetic sources fail and encryption key removal covers text and original together', async t => {
  const { path, vault } = await fixture(t), saved = await applyPdfImport(vault, await previewPdfImport(path), { sensitivity: 'secret' });
  await vault.encryption.erase(saved.evidenceId);
  await assert.rejects(readPdfOriginal(vault, saved.evidenceId));
  const encrypted = await readFile(new URL('./fixtures/pdf-password.base64', import.meta.url), 'utf8');
  await writeFile(path, Buffer.from(encrypted.trim(), 'base64'));
  await assert.rejects(previewPdfImport(path), { code: 'VALIDATION_FAILED' });
});

test('PDF: deadline/cancellation stop owned parsing without writes and a later independent call still works', async t => {
  const { path, vault } = await fixture(t), plan = await previewPdfImport(path);
  await assert.rejects(previewPdfImport(path, { timeoutMs: 1 }), { code: 'DEPENDENCY_UNAVAILABLE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(applyPdfImport(vault, plan, { signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  const running = new AbortController(), pending = previewPdfImport(path, { signal: running.signal });
  setTimeout(() => running.abort(), 10);
  await assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
  await assert.rejects(withOperation(controller.signal, () => previewPdfImport(path)), { code: 'OPERATION_CANCELLED' });
  assert.equal((await previewPdfImport(path)).pages.length, 3);
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 0);
  for (const timeoutMs of [0, -1, 120001, NaN]) await assert.rejects(previewPdfImport(path, { timeoutMs }), { code: 'VALIDATION_FAILED' });
});

test('PDF: tenant/write/scope/sensitivity are checked before source reads; original follows record encryption and read authority', async t => {
  const { path, bytes, vault } = await fixture(t), plan = await previewPdfImport(path), tenantId = (await vault.config()).tenantId;
  const reader = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId, permissions: ['read'], scopes: ['public'], maxSensitivity: 'public' } });
  const foreign = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId: 'foreign' } });
  await assert.rejects(applyPdfImport(reader, { ...plan, path: '/nonexistent' }), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(applyPdfImport(foreign, plan), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(applyPdfImport(reader, plan, { sensitivity: 'secret' }), { code: 'AUTHORIZATION_DENIED' });
  const result = await applyPdfImport(vault, plan, { scope: 'user', sensitivity: 'secret' });
  const raw = await readFile(join(vault.root, result.evidencePath), 'utf8');
  assert.doesNotMatch(raw, /JVBER|Synthetic source|Original SHA-256|pdfOriginal/);
  assert.equal((await reader.listRecords({ collection: 'evidence' })).total, 0);
  await assert.rejects(readPdfOriginal(reader, result.evidenceId));
  assert.deepEqual(await readPdfOriginal(vault, result.evidenceId), bytes);
});

test('PDF: encoded original, digest version and extraction metadata cannot be changed independently of evidence identity', async t => {
  const { path, vault } = await fixture(t), result = await applyPdfImport(vault, await previewPdfImport(path));
  const raw = await readFile(join(vault.root, result.evidencePath), 'utf8');
  const original = { ...parseMarkdown<Record<string, unknown>>(raw), path: result.evidencePath };
  assertEvidenceDocument(original);
  for (const modify of [
    (source: PdfOriginal) => { source.data = Buffer.from('%PDF-1.7 different bytes %%EOF').toString('base64'); },
    (source: PdfOriginal) => { source.bytes++; }, (source: PdfOriginal) => { source.sha256 = '0'.repeat(64); },
    (source: PdfOriginal) => { source.pages++; }, (source: PdfOriginal) => { source.parser = 'unpdf/1.7.0 PDF.js/0.0'; },
    (source: PdfOriginal) => { source.extractionSha256 = '0'.repeat(64); }, (source: PdfOriginal) => { source.emptyPages = [3, 2]; },
  ]) {
    const doc = structuredClone(original); modify(doc.meta.pdfOriginal as PdfOriginal);
    assert.throws(() => assertEvidenceDocument(doc), { code: 'VALIDATION_FAILED' });
  }
  const removed = structuredClone(original); delete removed.meta.pdfOriginal;
  assert.throws(() => assertEvidenceDocument(removed), { code: 'VALIDATION_FAILED' });
  removed.meta.digestVersion = 2;
  assert.throws(() => assertEvidenceDocument(removed), { code: 'VALIDATION_FAILED' });
  const textOnly = await vault.capture({ content: 'ordinary source' });
  await assert.rejects(readPdfOriginal(vault, textOnly.evidenceId), { code: 'NOT_FOUND' });
});

test('PDF: no action URL is requested and Wiki gets page text/identity, never the original bytes', async t => {
  const { path, vault } = await fixture(t); let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('not allowed'); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); t.after(() => new Promise<void>(done => server.close(() => done())));
  const port = (server.address() as { port: number }).port;
  const bytes = syntheticPdf(['Model source text.'], `/OpenAction << /S /URI /URI (http://127.0.0.1:${port}/do-not-open) >>`);
  await writeFile(path, bytes);
  const result = await applyPdfImport(vault, await previewPdfImport(path));
  const document = await vault.get(result.evidenceId), source = (document.meta as unknown as EvidenceMeta).pdfOriginal!;
  let calls = 0;
  vault.llm.wiki = async <T>(_op: Parameters<LlmClient['wiki']>[0], input: object): Promise<T> => {
    calls++; const serialized = JSON.stringify(input);
    assert.doesNotMatch(serialized, /pdfOriginal/); assert.equal(serialized.includes(source.data), false);
    assert.match(serialized, /## Page 1/); assert.match(serialized, /Model source text/);
    return { pages: [{ key: `source:${result.evidenceId}`, pageType: 'source', title: 'PDF source', summary: 'Source summary.', body: 'A summary of the source.',
      evidenceIds: [result.evidenceId], links: [], status: 'active', conditions: [], uncertainty: ['PDF extraction is not visual validation.'] }] } as T;
  };
  const prepared = await vault.wikiIngest({ evidenceIds: [result.evidenceId] });
  assert.ok(prepared.plan); assert.equal(calls, 1); assert.equal(requests, 0);
  assert.equal((await vault.wikiCatalog()).length, 0, 'model planning is not approval');
});

test('PDF: real CLI round-trips its preview, imports the original, and bounds plan reads', async t => {
  const { path, root, bytes, vault } = await fixture(t), exec = promisify(execFile), cli = join(process.cwd(), 'dist/cli.js');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  const preview = await exec(process.execPath, [cli, 'import', 'pdf-preview', path], { env });
  const plan = join(root, 'plan.json'); await writeFile(plan, preview.stdout);
  assert.deepEqual(await readPdfImportPlan(plan), JSON.parse(preview.stdout));
  assert.equal(serializePdfImportPlan(JSON.parse(preview.stdout)), preview.stdout);
  const applied = await exec(process.execPath, [cli, 'import', 'pdf-apply', '--plan', plan, '--root', vault.root], { env });
  assert.deepEqual(await readPdfOriginal(vault, JSON.parse(applied.stdout).evidenceId), bytes);
  await writeFile(plan, Buffer.alloc(1_000_001));
  await assert.rejects(readPdfImportPlan(plan), { code: 'CONTENT_TOO_LARGE' });
});

test('PDF: a failed original write rolls back; a ready commit interruption replays exact encrypted evidence', async t => {
  const { path, vault, bytes } = await fixture(t), plan = await previewPdfImport(path), head = await vault.git.run(['rev-parse', 'HEAD']);
  const write = VaultTransaction.prototype.write;
  try {
    VaultTransaction.prototype.write = async function (target, content) {
      await write.call(this, target, content);
      if (target.startsWith('evidence/')) throw new Error('synthetic post-write interruption');
    };
    await assert.rejects(applyPdfImport(vault, plan, { sensitivity: 'secret' }), /post-write interruption/);
  } finally { VaultTransaction.prototype.write = write; }
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 0);
  assert.deepEqual(await readdir(join(vault.root, '.amem/transactions')), []);
  const commit = vault.git.commit;
  try {
    vault.git.commit = async () => { throw new Error('synthetic ready-commit interruption'); };
    await assert.rejects(applyPdfImport(vault, plan, { sensitivity: 'secret' }), /ready-commit interruption/);
  } finally { vault.git.commit = commit; }
  assert.equal((await readdir(join(vault.root, '.amem/transactions'))).length, 1);
  const reopened = new MemoryVault(vault.root, { masterKey: '61'.repeat(32) });
  const recovered = await reopened.recover(); assert.equal(recovered.replayed.length, 1);
  const listing = await reopened.listRecords({ collection: 'evidence' }); assert.equal(listing.total, 1);
  assert.deepEqual(await readPdfOriginal(reopened, listing.items[0]!.id), bytes);
  assert.deepEqual(await readdir(join(vault.root, '.amem/transactions')), []);
});
