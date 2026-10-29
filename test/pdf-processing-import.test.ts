import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { assertEvidenceDocument, modelDocument } from '../src/evidence.js';
import { LlmClient } from '../src/llm.js';
import { parseMarkdown } from '../src/markdown.js';
import { operationSignal } from '../src/operation.js';
import { applyPdfImport, previewPdfImport, readPdfOriginal, readPdfPage, type PdfProcessedImportPlan } from '../src/pdf-import.js';
import { localAdminPrincipal } from '../src/policy.js';
import { VaultTransaction } from '../src/transaction.js';
import type { EvidenceMeta, PdfProcessedOriginal } from '../src/types.js';
import { withFileLock } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { syntheticPdf } from './pdf-fixture.js';

const posix = { skip: process.platform === 'win32' };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t: TestContext, text = ['', '', '']) {
  const root = await mkdtemp(join(process.cwd(), '.scratch/pdf-processed-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source.pdf'), original = syntheticPdf(text), image = png(); await writeFile(path, original);
  const renderer = join(root, 'renderer.mjs'), ocr = join(root, 'ocr.mjs'), languageData = join(root, 'languages'), workRoot = join(root, 'work');
  await mkdir(languageData); await mkdir(workRoot, { mode: 0o700 }); await writeFile(join(languageData, 'eng.traineddata'), 'SYNTHETIC_LANGUAGE');
  const output = join(root, 'ocr.txt'), trace = join(root, 'trace'); await writeFile(output, 'SYNTHETIC recognized text');
  await writeFile(renderer, `#!${process.execPath}\nimport fs from 'node:fs';if(process.argv[2]==='-v'){console.error('pdftoppm version 26.05.0');}else{fs.appendFileSync(${JSON.stringify(trace)},'render\\n');process.stdout.write(Buffer.from('${image.toString('base64')}','base64'));}`, { mode: 0o700 });
  await writeFile(ocr, `#!${process.execPath}\nimport fs from 'node:fs';if(process.argv[2]==='--version'){console.log('tesseract 5.5.1');}else{fs.appendFileSync(${JSON.stringify(trace)},'ocr\\n');process.stdout.write(fs.readFileSync(${JSON.stringify(output)}));}`, { mode: 0o700 });
  const processor = { version: 1 as const, renderer, ocr, languageData, workRoot }, processing = { pages: [2], languages: ['eng'] };
  const vault = new MemoryVault(join(root, 'vault'), { masterKey: '72'.repeat(32), llm: new LlmClient({ apiKey: '', embeddingModel: '' }) });
  await vault.initialize('Processed PDF fixture');
  return { root, path, original, image, output, trace, vault, processor, processing };
}

test('Processed PDF: image-only selection preserves exact original/page, explicit coverage and idempotent evidence-only capture', posix, async t => {
  const f = await fixture(t);
  await assert.rejects(previewPdfImport(f.path), /no extractable text/);
  const plan = await previewPdfImport(f.path, f) as PdfProcessedImportPlan;
  assert.equal(plan.version, 2); assert.deepEqual(plan.processing.selection.pages, [2]);
  assert.equal(plan.processing.pages[0]!.ocrCharacters, 'SYNTHETIC recognized text'.length);
  assert.doesNotMatch(JSON.stringify(plan), /SYNTHETIC recognized|JVBER|iVBOR|renderer\.mjs|languages\/eng/);
  assert.match(plan.warnings.join('\n'), /Page 1: not rendered/);
  const saved = await applyPdfImport(f.vault, plan, { processor: f.processor });
  const record = await f.vault.get(saved.evidenceId), source = (record.meta as unknown as EvidenceMeta).pdfOriginal!;
  assert.equal(record.meta.digestVersion, 5); assert.equal(source.version, 2);
  assert.match(record.body, /Pages not rendered: 1, 3/); assert.match(record.body, /OCR \(unverified\):\n\nSYNTHETIC recognized text/);
  assert.deepEqual(await readPdfOriginal(f.vault, saved.evidenceId), f.original);
  assert.deepEqual(await readPdfPage(f.vault, saved.evidenceId, 2), f.image);
  await assert.rejects(readPdfPage(f.vault, saved.evidenceId, 1), { code: 'NOT_FOUND' });
  assert.deepEqual(await readFile(f.path), f.original); assert.equal((await f.vault.wikiCatalog()).length, 0);
  assert.equal((await f.vault.listRecords({ collection: 'candidates' })).total, 0);
  const head = await f.vault.git.run(['rev-parse', 'HEAD']);
  const retry = await applyPdfImport(f.vault, plan, { processor: f.processor });
  assert.equal(retry.duplicate, true); assert.equal(retry.commit, null); assert.equal(await f.vault.git.run(['rev-parse', 'HEAD']), head);
});

test('Processed PDF: mixed text layers, render-only selection and empty OCR remain distinguishable', posix, async t => {
  const f = await fixture(t, ['Text layer first page', '', 'Text layer last page']);
  const plan = await previewPdfImport(f.path, { processor: f.processor, processing: { pages: [2] } });
  const saved = await applyPdfImport(f.vault, plan, { processor: f.processor });
  const record = await f.vault.get(saved.evidenceId);
  assert.match(record.body, /Text layer first page/); assert.match(record.body, /Text layer last page/);
  assert.match(record.body, /Rendered only; OCR not run/); assert.match(record.body, /Page not rendered; OCR not run/);
  assert.equal((await readFile(f.trace, 'utf8')).includes('ocr'), false);
  await writeFile(f.output, '');
  const empty = await previewPdfImport(f.path, f), captured = await applyPdfImport(f.vault, empty, { processor: f.processor });
  assert.match(empty.warnings.join('\n'), /Page 2: no recognized text/);
  assert.match((await f.vault.get(captured.evidenceId)).body, /No recognized text/);
});

test('Processed PDF: strict selections, host separation and unsupported preview fields refuse before native execution', posix, async t => {
  const f = await fixture(t), head = await f.vault.git.run(['rev-parse', 'HEAD']);
  for (const processing of [{ pages: [0] }, { pages: [1, 1] }, { pages: [4] }, { pages: [1], args: ['untrusted'] }]) {
    await assert.rejects(previewPdfImport(f.path, { processor: f.processor, processing } as any), { code: 'VALIDATION_FAILED' });
  }
  await assert.rejects(previewPdfImport(f.path, { processor: f.processor }), { code: 'VALIDATION_FAILED' });
  assert.equal(existsSync(f.trace), false);
  const plan = await previewPdfImport(f.path, f); await rm(f.trace);
  await assert.rejects(applyPdfImport(f.vault, plan), { code: 'VALIDATION_FAILED' });
  await assert.rejects(applyPdfImport(f.vault, { ...plan, command: '/arbitrary' } as any, { processor: f.processor }), { code: 'VALIDATION_FAILED' });
  const forged = structuredClone(plan) as any; forged.processing.selection.renderer = '/arbitrary';
  await assert.rejects(applyPdfImport(f.vault, forged, { processor: f.processor }), { code: 'VALIDATION_FAILED' });
  assert.equal(existsSync(f.trace), false); assert.equal(await f.vault.git.run(['rev-parse', 'HEAD']), head);
});

test('Processed PDF: output, language, executable and source drift refuse old previews without evidence', posix, async t => {
  const f = await fixture(t), plan = await previewPdfImport(f.path, f), head = await f.vault.git.run(['rev-parse', 'HEAD']);
  for (const [path, changed] of [[f.output, Buffer.from('different recognition')], [join(f.processor.languageData, 'eng.traineddata'), Buffer.from('different language')],
    [f.processor.renderer, Buffer.concat([await readFile(f.processor.renderer), Buffer.from('\n// changed executable\n')])], [f.path, syntheticPdf(['different source', '', ''])]] as const) {
    const original = await readFile(path); await writeFile(path, changed);
    try { await assert.rejects(applyPdfImport(f.vault, plan, { processor: f.processor }), /preview changed/); }
    finally { await writeFile(path, original); }
    assert.equal(await f.vault.git.run(['rev-parse', 'HEAD']), head);
  }
  assert.equal((await f.vault.listRecords({ collection: 'evidence' })).total, 0);
});

test('Processed PDF: metadata, image/OCR provenance, stripped discriminators and digest downgrades cannot retain identity', posix, async t => {
  const f = await fixture(t), saved = await applyPdfImport(f.vault, await previewPdfImport(f.path, f), { processor: f.processor });
  const original = { ...parseMarkdown<Record<string, unknown>>(await readFile(join(f.vault.root, saved.evidencePath), 'utf8')), path: saved.evidencePath };
  assertEvidenceDocument(original);
  const changes: Array<(source: PdfProcessedOriginal) => void> = [
    value => { value.processing.sourceSha256 = '0'.repeat(64); }, value => { value.processing.pages[0]!.data = 'AAAA'; },
    value => { value.processing.pages[0]!.ocrText = 'changed recognition'; }, value => { value.processing.renderer.sha256 = '0'.repeat(64); },
    value => { value.processing.ocr!.languages[0]!.sha256 = '0'.repeat(64); }, value => { value.processing.selection.pages = [3]; },
    value => { (value as any).version = 1; delete (value as any).processing; },
  ];
  for (const change of changes) { const record = structuredClone(original); change(record.meta.pdfOriginal as PdfProcessedOriginal); assert.throws(() => assertEvidenceDocument(record), { code: 'VALIDATION_FAILED' }); }
  for (const digestVersion of [undefined, 2, 3, 4]) {
    const record = structuredClone(original); record.meta.digestVersion = digestVersion;
    assert.throws(() => assertEvidenceDocument(record), { code: 'VALIDATION_FAILED' });
  }
  const omitted = structuredClone(original); delete omitted.meta.pdfOriginal; assert.throws(() => assertEvidenceDocument(omitted), { code: 'VALIDATION_FAILED' });
});

test('Processed PDF: exact original and page share secret encryption, tenant/scope/read permissions and key erasure', posix, async t => {
  const f = await fixture(t), plan = await previewPdfImport(f.path, f), tenantId = (await f.vault.config()).tenantId;
  const reader = new MemoryVault(f.vault.root, { principal: { ...localAdminPrincipal(), tenantId, permissions: ['read'], scopes: ['public'], maxSensitivity: 'public' } });
  await assert.rejects(applyPdfImport(reader, { ...plan, path: '/nonexistent' }, { processor: f.processor }), { code: 'AUTHORIZATION_DENIED' });
  const saved = await applyPdfImport(f.vault, plan, { processor: f.processor, sensitivity: 'secret', scope: 'user' });
  const raw = await readFile(join(f.vault.root, saved.evidencePath), 'utf8'); assert.doesNotMatch(raw, /pdfOriginal|JVBER|iVBOR|SYNTHETIC recognized/);
  await assert.rejects(readPdfOriginal(reader, saved.evidenceId)); await assert.rejects(readPdfPage(reader, saved.evidenceId, 2));
  const foreign = new MemoryVault(f.vault.root, { principal: { ...localAdminPrincipal(), tenantId: 'foreign' } });
  await assert.rejects(readPdfPage(foreign, saved.evidenceId, 2), { code: 'AUTHORIZATION_DENIED' });
  assert.deepEqual(await readPdfPage(f.vault, saved.evidenceId, 2), f.image);
  await f.vault.encryption.erase(saved.evidenceId); await assert.rejects(readPdfOriginal(f.vault, saved.evidenceId)); await assert.rejects(readPdfPage(f.vault, saved.evidenceId, 2));
});

test('Processed PDF: a prior local media read never adds blobs to model input or approves Wiki knowledge', posix, async t => {
  const f = await fixture(t), saved = await applyPdfImport(f.vault, await previewPdfImport(f.path, f), { processor: f.processor });
  await readPdfOriginal(f.vault, saved.evidenceId); await readPdfPage(f.vault, saved.evidenceId, 2);
  const record = await f.vault.get(saved.evidenceId), serialized = JSON.stringify(modelDocument(record));
  assert.doesNotMatch(serialized, /pdfOriginal|iVBOR|JVBER/); let calls = 0;
  f.vault.llm.wiki = async <T>(_operation: Parameters<LlmClient['wiki']>[0], input: object): Promise<T> => {
    calls++; const text = JSON.stringify(input); assert.doesNotMatch(text, /pdfOriginal|iVBOR|JVBER/); assert.match(text, /SYNTHETIC recognized text/);
    return { pages: [{ key: `source:${saved.evidenceId}`, pageType: 'source', title: 'Processed PDF', summary: 'Unverified OCR.', body: 'Recognized source text remains unverified.',
      evidenceIds: [saved.evidenceId], links: [], status: 'active', conditions: [], uncertainty: ['OCR may be wrong.'] }] } as T;
  };
  assert.ok((await f.vault.wikiIngest({ evidenceIds: [saved.evidenceId] })).plan);
  assert.equal(calls, 1); assert.equal((await f.vault.wikiCatalog()).length, 0);
});

for (const changed of ['source', 'profile', 'permission'] as const) test(`Processed PDF: ${changed} drift while waiting for the actual destination writer refuses capture`, { ...posix, timeout: 20_000 }, async t => {
  const f = await fixture(t), plan = await previewPdfImport(f.path, f), head = await f.vault.git.run(['rev-parse', 'HEAD']);
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
  const owner = withFileLock(join(f.vault.root, '.amem/write.lock'), async () => { entered(); await hold; }); await ready;
  const pending = applyPdfImport(f.vault, plan, { processor: f.processor }).then(value => ({ value }), error => ({ error }));
  try {
    await until(async () => (await readdir(join(f.vault.root, '.amem/write.lock.queue'))).length === 2);
    if (changed === 'source') await writeFile(f.path, syntheticPdf(['changed while queued', '', '']));
    if (changed === 'profile') await writeFile(join(f.processor.languageData, 'eng.traineddata'), 'CHANGED_WHILE_QUEUED');
    if (changed === 'permission') f.vault.principal.permissions = ['read'];
  } finally { release(); await owner; }
  const result = await pending; assert.ok('error' in result); assert.equal(result.error.code, changed === 'permission' ? 'AUTHORIZATION_DENIED' : 'VALIDATION_FAILED');
  f.vault.principal.permissions = localAdminPrincipal().permissions;
  assert.equal(await f.vault.git.run(['rev-parse', 'HEAD']), head); assert.equal((await f.vault.listRecords({ collection: 'evidence' })).total, 0);
});

test('Processed PDF: original/page rollback and actual ready-commit recovery preserve exact encrypted bytes', posix, async t => {
  const f = await fixture(t), plan = await previewPdfImport(f.path, f), head = await f.vault.git.run(['rev-parse', 'HEAD']), write = VaultTransaction.prototype.write;
  try {
    VaultTransaction.prototype.write = async function (path, content) { await write.call(this, path, content); if (path.startsWith('evidence/')) throw new Error('synthetic processed evidence write failure'); };
    await assert.rejects(applyPdfImport(f.vault, plan, { processor: f.processor, sensitivity: 'secret' }), /processed evidence write failure/);
  } finally { VaultTransaction.prototype.write = write; }
  assert.equal(await f.vault.git.run(['rev-parse', 'HEAD']), head); assert.deepEqual(await readdir(join(f.vault.root, '.amem/transactions')), []);
  const commit = f.vault.git.commit;
  try { f.vault.git.commit = async () => { throw new Error('synthetic processed ready failure'); }; await assert.rejects(applyPdfImport(f.vault, plan, { processor: f.processor, sensitivity: 'secret' }), /processed ready failure/); }
  finally { f.vault.git.commit = commit; }
  assert.equal((await readdir(join(f.vault.root, '.amem/transactions'))).length, 1);
  const reopened = new MemoryVault(f.vault.root, { masterKey: '72'.repeat(32) }); assert.equal((await reopened.recover()).replayed.length, 1);
  const listing = await reopened.listRecords({ collection: 'evidence' }); assert.equal(listing.total, 1);
  assert.deepEqual(await readPdfOriginal(reopened, listing.items[0]!.id), f.original); assert.deepEqual(await readPdfPage(reopened, listing.items[0]!.id, 2), f.image);
});

for (const boundary of ['ready', 'commit']) test(`Processed PDF: cancellation at ${boundary} reports the actual durable capture receipt`, posix, async t => {
  const f = await fixture(t), plan = await previewPdfImport(f.path, f), controller = new AbortController();
  const head = await f.vault.git.run(['rev-parse', 'HEAD']), commit = f.vault.git.commit.bind(f.vault.git); let receipt: unknown;
  t.mock.method(f.vault.git, 'commit', async (...args: Parameters<typeof commit>) => {
    assert.equal(operationSignal(), undefined); if (boundary === 'ready') controller.abort();
    const result = await commit(...args); if (boundary === 'commit') controller.abort(); return result;
  });
  await assert.rejects(applyPdfImport(f.vault, plan, { processor: f.processor, signal: controller.signal, sensitivity: 'secret' }), (error: any) => {
    assert.equal(error.code, 'OPERATION_CANCELLED'); assert.equal(error.safeDetails?.committed?.length, 1);
    assert.equal(error.safeDetails.committed[0].operation, 'capture'); receipt = error.safeDetails.committed[0].commit; return true;
  });
  assert.equal(receipt, await f.vault.git.run(['rev-parse', 'HEAD']));
  assert.equal(await f.vault.git.run(['rev-list', '--count', `${head}..HEAD`]), '1');
  const listing = await f.vault.listRecords({ collection: 'evidence' }); assert.equal(listing.total, 1);
  assert.deepEqual(await readPdfOriginal(f.vault, listing.items[0]!.id), f.original); assert.deepEqual(await readPdfPage(f.vault, listing.items[0]!.id, 2), f.image);
  const retry = await applyPdfImport(f.vault, plan, { processor: f.processor, sensitivity: 'secret' });
  assert.equal(retry.duplicate, true); assert.equal(retry.commit, null);
});

const suffix = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const crashWorker = `
import {appendFileSync} from 'node:fs';
import {MemoryVault} from ${JSON.stringify(new URL('../src/vault' + suffix, import.meta.url).href)};
import {LlmClient} from ${JSON.stringify(new URL('../src/llm' + suffix, import.meta.url).href)};
import {applyPdfImport} from ${JSON.stringify(new URL('../src/pdf-import' + suffix, import.meta.url).href)};
import {VaultTransaction} from ${JSON.stringify(new URL('../src/transaction' + suffix, import.meta.url).href)};
const [root,encodedPlan,encodedHost,boundary] = process.argv.slice(1);
for(const method of ['embed','extractMemories','answer','wiki']) LlmClient.prototype[method]=async()=>{appendFileSync(root+'/.amem/pdf-model-calls',method+'\\n');throw new Error('Unexpected model entrypoint');};
const vault=new MemoryVault(root,{masterKey:'72'.repeat(32)});
async function stop(at){if(at!==boundary)return;await new Promise(resolve=>process.send({boundary:at},resolve));process.kill(process.pid,'SIGKILL');await new Promise(()=>{});}
const write=VaultTransaction.prototype.write;
VaultTransaction.prototype.write=async function(path,content){await write.call(this,path,content);if(path.startsWith('evidence/'))await stop('evidence');if(path==='log.md')await stop('log');};
const commit=vault.git.commit.bind(vault.git);vault.git.commit=async(...args)=>{await stop('ready');return commit(...args);};
const run=vault.git.run.bind(vault.git);vault.git.run=async(...args)=>{const value=await run(...args);if(args[0][0]==='commit')await stop('commit');return value;};
try{await applyPdfImport(vault,JSON.parse(encodedPlan),{processor:JSON.parse(encodedHost),sensitivity:'secret'});await new Promise(resolve=>process.send({unexpected:'completed'},resolve));}
catch(error){await new Promise(resolve=>process.send({error:{code:error.code,message:error.message}},resolve));}
process.disconnect();
`;
for (const boundary of ['evidence', 'log', 'ready', 'commit']) test(`Processed PDF: actual SIGKILL after ${boundary} restores or completes exact immutable media`, { ...posix, timeout: 30_000 }, async t => {
  const f = await fixture(t), plan = await previewPdfImport(f.path, f), head = await f.vault.git.run(['rev-parse', 'HEAD']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  const child = spawn(process.execPath, [...(suffix === '.ts' ? ['--import', 'tsx'] : []), '--input-type=module', '--eval', crashWorker,
    f.vault.root, JSON.stringify(plan), JSON.stringify(f.processor), boundary], { env, stdio: ['ignore','pipe','pipe','ipc'] });
  const messages: unknown[] = []; let stderr = ''; child.stdout!.resume(); child.stderr!.on('data', value => { stderr += value.toString(); }); child.on('message', value => messages.push(value));
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  const stopped = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); }).finally(() => clearTimeout(timer));
  assert.deepEqual(stopped, { code: null, signal: 'SIGKILL' }, stderr); assert.deepEqual(messages, [{ boundary }], stderr);
  assert.equal(existsSync(join(f.vault.root, '.amem/pdf-model-calls')), false);
  const pending = await readdir(join(f.vault.root, '.amem/transactions')); assert.equal(pending.length, 1);
  const durable = boundary === 'ready' || boundary === 'commit';
  assert.equal(JSON.parse(await readFile(join(f.vault.root, '.amem/transactions', pending[0]!), 'utf8')).phase, durable ? 'ready' : 'writing');
  const reopened = new MemoryVault(f.vault.root, { masterKey: '72'.repeat(32) }), recovered = await reopened.recover();
  assert.equal(recovered.rolledBack.length, durable ? 0 : 1); assert.equal(recovered.replayed.length, durable ? 1 : 0);
  if (!durable) assert.equal(await reopened.git.run(['rev-parse', 'HEAD']), head);
  const saved = await applyPdfImport(reopened, plan, { processor: f.processor, sensitivity: 'secret' });
  assert.equal(saved.duplicate, durable); assert.equal(saved.commit === null, durable);
  assert.deepEqual(await readPdfOriginal(reopened, saved.evidenceId), f.original); assert.deepEqual(await readPdfPage(reopened, saved.evidenceId, 2), f.image);
  assert.equal(await reopened.git.run(['rev-list', '--count', `${head}..HEAD`]), '1');
  assert.equal((await reopened.listRecords({ collection: 'evidence' })).total, 1);
  assert.deepEqual(await reopened.recover(), { rolledBack: [], replayed: [], commits: [] });
  assert.equal((await applyPdfImport(reopened, plan, { processor: f.processor, sensitivity: 'secret' })).commit, null);
  assert.deepEqual(await readdir(join(reopened.root, '.amem/transactions')), []);
  assert.deepEqual(await readFile(f.path), f.original);
});

test('Processed PDF: real CLI previews, applies and exclusively exports bounded original/page files', posix, async t => {
  const f = await fixture(t), config = join(f.root, 'host.json'), planFile = join(f.root, 'plan.json'), cli = join(process.cwd(), 'dist/cli.js'), exec = promisify(execFile);
  await writeFile(config, JSON.stringify(f.processor));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  const run = (args: string[]) => exec(process.execPath, [cli, ...args], { env });
  const preview = await run(['import','pdf-preview',f.path,'--processor-config',config,'--pages','2','--ocr-languages','eng']); await writeFile(planFile, preview.stdout);
  const saved = JSON.parse((await run(['import','pdf-apply','--plan',planFile,'--processor-config',config,'--root',f.vault.root])).stdout);
  const originalFile = join(f.root, 'export.pdf'), pageFile = join(f.root, 'export.png');
  await run(['import','pdf-original',saved.evidenceId,'--output',originalFile,'--root',f.vault.root]);
  await run(['import','pdf-page',saved.evidenceId,'--page','2','--output',pageFile,'--root',f.vault.root]);
  assert.equal(hash(await readFile(originalFile)), hash(f.original)); assert.deepEqual(await readFile(pageFile), f.image);
  await assert.rejects(run(['import','pdf-page',saved.evidenceId,'--page','2','--output',pageFile,'--root',f.vault.root]), /EEXIST/);
  assert.deepEqual(await readFile(pageFile), f.image);
});

function png() {
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(14))), chunk('IEND', Buffer.alloc(0))]);
}
function chunk(type: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
  let crc = 0xffffffff; for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
async function until(condition: () => Promise<boolean>) { const end = performance.now() + 10_000; while (!await condition()) { assert.ok(performance.now() < end, 'Expected actual destination writer queue'); await delay(10); } }
