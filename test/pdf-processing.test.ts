import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { processPdfPages } from '../src/pdf-processing.js';
import { assertPdfPageProcessing, inspectPdfPng, type PdfProcessorConfig } from '../src/pdf-processing-schema.js';
import { withOperation } from '../src/operation.js';
import { sha256 } from '../src/utils.js';

const posix = { skip: process.platform === 'win32' };
async function fixture(t: TestContext, mode = 'normal') {
  const root = await mkdtemp(join(process.cwd(), '.scratch/pdf-processing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workRoot = join(root, 'private'), languageData = join(root, 'languages'), renderer = join(root, 'renderer.mjs'), ocr = join(root, 'ocr.mjs');
  await mkdir(workRoot, { mode: 0o700 }); await mkdir(languageData); await writeFile(join(languageData, 'eng.traineddata'), 'synthetic-language-data');
  const marker = join(root, 'started.json'), trace = join(root, 'trace.jsonl'), image = png();
  const common = `#!${process.execPath}\nimport fs from 'node:fs'; import {spawn} from 'node:child_process';
const args = process.argv.slice(2), mode = ${JSON.stringify(mode)};
const trace = ${JSON.stringify(trace)}, marker = ${JSON.stringify(marker)};
fs.appendFileSync(trace, JSON.stringify({args, env: Object.keys(process.env).filter(k => /AMEM_|OPENAI_API_KEY/.test(k))}) + '\\n');\n`;
  await writeFile(renderer, common + `
if (args[0] === '-v') { console.error('pdftoppm version '+(mode === 'version-overflow' ? '26.'+'1'.repeat(90) : '26.05.0')); process.exit(0); }
fs.writeFileSync(marker, JSON.stringify({pid: process.pid}));
if (mode === 'block') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
else if (mode === 'overflow') { process.stdout.write(Buffer.alloc(2000001)); setInterval(() => {}, 1000); }
else if (mode === 'cache-overflow') { fs.writeFileSync(process.env.TMPDIR+'/font-cache/oversized.cache',Buffer.alloc(4000001));process.stdout.write(Buffer.from(${JSON.stringify(image.toString('base64'))},'base64')); }
else if (mode === 'helper') { const helper=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});helper.unref();fs.writeFileSync(marker,JSON.stringify({pid:process.pid,helperPid:helper.pid}));process.stdout.write(Buffer.from(${JSON.stringify(image.toString('base64'))},'base64')); }
else process.stdout.write(Buffer.from(${JSON.stringify(image.toString('base64'))}, 'base64'));
`, { mode: 0o700 });
  await writeFile(ocr, common + `
if (args[0] === '--version') { console.log('tesseract 5.5.1'); process.exit(0); }
if (mode === 'bad-utf8') process.stdout.write(Buffer.from([255]));
else process.stdout.write('SYNTHETIC OCR — not a recognition quality test.\\n');
`, { mode: 0o700 });
  const host: PdfProcessorConfig = { version: 1, workRoot, renderer, ocr, languageData };
  return { root, host, marker, trace, bytes: Buffer.from('%PDF-1.7\nSynthetic local-only input, not parsed by these process fixtures.\n%%EOF'), image };
}

test('PDF processor: strict PNG structure, bounded inflation and integrity refuse malformed image output', () => {
  const image = png(); assert.deepEqual(inspectPdfPng(image), { width: 2, height: 2 });
  for (const value of [Buffer.alloc(0), image.subarray(0, -1), Buffer.concat([image, Buffer.from('extra')])]) assert.throws(() => inspectPdfPng(value), { code: 'VALIDATION_FAILED' });
  const corrupt = Buffer.from(image); corrupt[corrupt.length - 1]! ^= 1;
  assert.throws(() => inspectPdfPng(corrupt), { code: 'VALIDATION_FAILED' });
  assert.throws(() => inspectPdfPng(png(1601, 1)), { code: 'CONTENT_TOO_LARGE' });
});

test('PDF processor: PNG rejects high-bit chunk names and unconsumed IDAT bytes even with valid CRCs', () => {
  const image = png(), header = image.subarray(16, 29);
  const rawName = Buffer.concat([image.subarray(0, 8), chunk(Buffer.from([0xc9, 0x48, 0x44, 0x52]), header), image.subarray(33)]);
  assert.throws(() => inspectPdfPng(rawName), { code: 'VALIDATION_FAILED' });
  const tail = Buffer.concat([image.subarray(0, 33), chunk('IDAT', Buffer.concat([deflateSync(Buffer.alloc(14)), Buffer.from('hidden-tail')])), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => inspectPdfPng(tail), { code: 'VALIDATION_FAILED' });
});

test('PDF processor: explicit selection uses fixed arguments and records complete images/OCR without inherited model credentials', posix, async t => {
  const f = await fixture(t), before = Buffer.from(f.bytes), prior = process.env.AMEM_LLM_API_KEY;
  process.env.AMEM_LLM_API_KEY = 'SYNTHETIC_NO_INHERIT';
  t.after(() => { if (prior === undefined) delete process.env.AMEM_LLM_API_KEY; else process.env.AMEM_LLM_API_KEY = prior; });
  const { record } = await processPdfPages(f.bytes, 3, { pages: [3, 1], languages: ['eng'] }, f.host);
  assertPdfPageProcessing(record); assert.deepEqual(record.pages.map(page => page.number), [3, 1]);
  assert.equal(record.sourceSha256, createHash('sha256').update(f.bytes).digest('hex')); assert.deepEqual(f.bytes, before);
  for (const page of record.pages) { assert.deepEqual(Buffer.from(page.data, 'base64'), f.image); assert.match(page.ocrText!, /SYNTHETIC OCR/); assert.equal(page.ocrSha256, sha256(page.ocrText!)); }
  assert.doesNotMatch(JSON.stringify(record), new RegExp(f.root)); assert.doesNotMatch(JSON.stringify(record), /SYNTHETIC_NO_INHERIT/);
  const trace = (await readFile(f.trace, 'utf8')).trim().split('\n').map(value => JSON.parse(value));
  assert.equal(trace.length, 6); for (const entry of trace) assert.deepEqual(entry.env, []);
  assert.deepEqual(trace[2].args.slice(0, 8), ['-f','3','-l','3','-scale-to','1600','-singlefile','-png']);
  assert.equal(trace[3].args[1], 'stdout'); assert.deepEqual(trace[3].args.slice(2, 9), ['--tessdata-dir', f.host.languageData, '-l', 'eng', '--psm', '3', 'txt']);
  assert.deepEqual((await readdir(f.host.workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
  for (const change of [(value: typeof record) => { value.pages[0]!.sha256 = '0'.repeat(64); },
    (value: typeof record) => { value.pages[0]!.ocrText = 'altered'; }, (value: typeof record) => { value.selection.pages = [1, 3]; }]) {
    const altered = structuredClone(record); change(altered); assert.throws(() => assertPdfPageProcessing(altered), { code: 'VALIDATION_FAILED' });
  }
});

test('PDF processor: render-only mode never runs an OCR binary and profile changes refuse a retained result', posix, async t => {
  const f = await fixture(t), result = await processPdfPages(f.bytes, 1, { pages: [1] }, { ...f.host, ocr: join(f.root, 'missing-ocr') });
  assert.equal(result.record.ocr, undefined); assert.equal(result.record.pages[0]!.ocrText, undefined);
  await writeFile(f.host.renderer, '\n// changed processor\n', { flag: 'a' });
  await assert.rejects(result.verifyProfile(), { code: 'VALIDATION_FAILED' });
});

test('PDF processor: oversized complete version tokens are refused rather than retaining a shorter prefix', posix, async t => {
  const f = await fixture(t, 'version-overflow');
  await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1] }, f.host), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.deepEqual((await readdir(f.host.workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
});

test('PDF processor: unavailable languages, strict options and nonprivate work roots refuse before native execution', posix, async t => {
  const f = await fixture(t);
  for (const selected of [{ pages: [1, 1] }, { pages: [0] }, { pages: [2] }, { pages: [1], command: 'unsafe' }, { pages: [1], languages: ['../outside'] }]) {
    await assert.rejects(processPdfPages(f.bytes, 1, selected, f.host), { code: 'VALIDATION_FAILED' });
  }
  await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1], languages: ['chi_sim'] }, f.host), { code: 'DEPENDENCY_UNAVAILABLE' });
  await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1] }, { ...f.host, args: ['unsafe'] } as PdfProcessorConfig), { code: 'VALIDATION_FAILED' });
  await chmod(f.host.workRoot, 0o755); await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1] }, f.host), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.equal(existsSync(f.trace), false);
});

test('PDF processor: changed or removed language/processor files invalidate retained output without raw path errors', posix, async t => {
  const f = await fixture(t), result = await processPdfPages(f.bytes, 1, { pages: [1], languages: ['eng'] }, f.host);
  await writeFile(join(f.host.languageData!, 'eng.traineddata'), 'changed');
  await assert.rejects(result.verifyProfile(), { code: 'VALIDATION_FAILED' });
  await rm(f.host.renderer); await assert.rejects(result.verifyProfile(), { code: 'VALIDATION_FAILED' });
});

test('PDF processor: malformed or oversized stale owner metadata is bounded and never authorizes deletion', posix, async t => {
  const f = await fixture(t), directory = join(f.host.workRoot, 'pdf-owned-foreign'); await mkdir(directory, { mode: 0o700 });
  const owner = join(directory, 'owner.json'); await writeFile(owner, Buffer.alloc(1001, 32));
  await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1] }, f.host), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.equal((await readFile(owner)).length, 1001); assert.equal(existsSync(f.trace), false);
  await writeFile(owner, JSON.stringify({ version: 1, pid: process.pid, extra: true }));
  await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1] }, f.host), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.equal(existsSync(owner), true);
  const external = join(f.root, 'external-owner'); await writeFile(external, 'UNRELATED_OWNER_REMAINS'); await rm(owner); await symlink(external, owner);
  await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1] }, f.host), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.equal(await readFile(external, 'utf8'), 'UNRELATED_OWNER_REMAINS'); assert.equal(existsSync(owner), true);
});

test('PDF processor: explicitly chosen fallback fonts are fingerprinted and later changes invalidate the profile', posix, async t => {
  const f = await fixture(t), fonts = join(f.root, 'fonts'); await mkdir(fonts); await writeFile(join(fonts, 'chosen.ttf'), 'synthetic-font-fixture');
  const result = await processPdfPages(f.bytes, 1, { pages: [1] }, { ...f.host, fontDirectory: fonts });
  assert.deepEqual(result.record.renderer.fonts, [{ name: 'chosen.ttf', sha256: sha256('synthetic-font-fixture') }]);
  await writeFile(join(fonts, 'chosen.ttf'), 'changed-font'); await assert.rejects(result.verifyProfile(), { code: 'VALIDATION_FAILED' });
});

for (const mode of ['overflow', 'bad-utf8', 'cache-overflow']) {
  test(`PDF processor: ${mode} refuses complete output and cleans owned files`, posix, async t => {
    const f = await fixture(t, mode);
    await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1], languages: ['eng'] }, f.host), { code: mode === 'bad-utf8' ? 'VALIDATION_FAILED' : 'CONTENT_TOO_LARGE' });
    assert.deepEqual((await readdir(f.host.workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
  });
}

test('PDF processor: cancellation stops an actual TERM-ignoring process and preserves unrelated files/processes', posix, async t => {
  const f = await fixture(t, 'block'), controller = new AbortController();
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const otherClosed = new Promise(resolve => other.once('close', resolve)); t.after(async () => { other.kill('SIGKILL'); await otherClosed; });
  const foreign = join(f.host.workRoot, 'unrelated.txt'); await writeFile(foreign, 'preserve');
  const outcome = withOperation(controller.signal, () => processPdfPages(f.bytes, 1, { pages: [1] }, f.host)).then(value => ({ value }), error => ({ error }));
  await until(() => existsSync(f.marker)); const { pid } = JSON.parse(await readFile(f.marker, 'utf8'));
  controller.abort(); const result = await outcome; assert.ok('error' in result); assert.equal(result.error.code, 'OPERATION_CANCELLED');
  assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
  assert.doesNotThrow(() => process.kill(other.pid!, 0)); assert.equal(await readFile(foreign, 'utf8'), 'preserve');
  assert.deepEqual((await readdir(f.host.workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
});

test('PDF processor: execution deadline stops a real blocked child and removes owned work', posix, async t => {
  const f = await fixture(t, 'block'), start = performance.now();
  await assert.rejects(processPdfPages(f.bytes, 1, { pages: [1] }, f.host, 2000), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.ok(performance.now() - start < 6000); assert.equal(existsSync(f.marker), true);
  assert.deepEqual((await readdir(f.host.workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
});

test('PDF processor: normal leader exit also stops its actual background helper', posix, async t => {
  const f = await fixture(t, 'helper'); await processPdfPages(f.bytes, 1, { pages: [1] }, f.host);
  const { helperPid } = JSON.parse(await readFile(f.marker, 'utf8'));
  const state = await promisify(execFile)('/bin/ps', ['-p', String(helperPid), '-o', 'stat='], { timeout: 1000 }).then(value => value.stdout.trim(), error => {
    if (error.code === 1 && !error.stdout?.trim()) return ''; throw error;
  });
  assert.ok(!state || /^[ZX]/.test(state), `Helper must be absent or nonexecuting, observed ${state}`);
  assert.deepEqual((await readdir(f.host.workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
});

test('PDF processor: verified dead owners are cleaned while another live owner directory remains unchanged', posix, async t => {
  const f = await fixture(t); await processPdfPages(f.bytes, 1, { pages: [1] }, f.host);
  const { pid } = JSON.parse(await readFile(f.marker, 'utf8'));
  assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
  const dead = join(f.host.workRoot, 'pdf-owned-dead'), live = join(f.host.workRoot, 'pdf-owned-live');
  for (const [path, ownerPid] of [[dead, pid], [live, process.pid]] as const) {
    await mkdir(path, { mode: 0o700 }); await writeFile(join(path, 'owner.json'), JSON.stringify({ version: 1, pid: ownerPid }));
    await writeFile(join(path, 'source.pdf'), 'SYNTHETIC_OWNER_DATA');
  }
  await processPdfPages(f.bytes, 1, { pages: [1] }, f.host);
  assert.equal(existsSync(dead), false); assert.equal(await readFile(join(live, 'source.pdf'), 'utf8'), 'SYNTHETIC_OWNER_DATA');
  assert.deepEqual(JSON.parse(await readFile(join(live, 'owner.json'), 'utf8')), { version: 1, pid: process.pid });
});

test('PDF processor: cancelling a real queued call preserves its owner; the next queued call then completes', { ...posix, timeout: 20_000 }, async t => {
  const a = await fixture(t, 'block'), b = await fixture(t), ownerController = new AbortController(), waiterController = new AbortController();
  const owner = withOperation(ownerController.signal, () => processPdfPages(a.bytes, 1, { pages: [1] }, a.host)).then(value => ({ value }), error => ({ error }));
  let waiter: Promise<any> | undefined, next: Promise<any> | undefined;
  try {
    await until(() => existsSync(a.marker)); const { pid } = JSON.parse(await readFile(a.marker, 'utf8'));
    const host = { ...b.host, workRoot: a.host.workRoot }, queue = join(a.host.workRoot, 'pdf-processing.lock.queue');
    waiter = withOperation(waiterController.signal, () => processPdfPages(b.bytes, 1, { pages: [1] }, host)).then(value => ({ value }), error => ({ error }));
    await untilAsync(async () => (await readdir(queue)).length === 2);
    assert.equal(existsSync(b.trace), false); waiterController.abort(); assert.equal((await waiter).error?.code, 'OPERATION_CANCELLED');
    assert.doesNotThrow(() => process.kill(pid, 0)); assert.equal((await readdir(queue)).length, 1);
    next = processPdfPages(b.bytes, 1, { pages: [1] }, host).then(value => ({ value }), error => ({ error }));
    await untilAsync(async () => (await readdir(queue)).length === 2); assert.equal(existsSync(b.trace), false);
    ownerController.abort(); const stopped = await owner; assert.ok('error' in stopped); assert.equal(stopped.error.code, 'OPERATION_CANCELLED');
    const completed = await next; assert.ok(completed.value?.record); assert.equal(completed.error, undefined);
    assert.deepEqual((await readdir(a.host.workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
  } finally { waiterController.abort(); ownerController.abort(); await waiter; await owner; await next; }
});

function png(width = 2, height = 2) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const chunks = [chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height, 0))), chunk('IEND', Buffer.alloc(0))];
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), ...chunks]);
}
function chunk(type: string | Buffer, data: Buffer) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); Buffer.from(type).copy(result, 4); data.copy(result, 8);
  let crc = 0xffffffff; for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
async function until(condition: () => boolean) { const end = performance.now() + 5000; while (!condition()) { assert.ok(performance.now() < end, 'Expected actual processor start'); await delay(10); } }
async function untilAsync(condition: () => Promise<boolean>) { const end = performance.now() + 5000; while (!await condition()) { assert.ok(performance.now() < end, 'Expected actual processor queue contender'); await delay(10); } }
