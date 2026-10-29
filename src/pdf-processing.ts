import { AsyncResource } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, opendir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AgentMemoryError } from './errors.js';
import { terminateGit as stopOwnedGroup } from './git-store.js';
import { cancellationError, operationSignal, throwIfCancelled } from './operation.js';
import { sha256, withFileLock } from './utils.js';
import { assertPdfPageProcessing, inspectPdfPng, pdfProcessingSelectionSchema, pdfProcessorConfigSchema,
  PDF_IMAGE_MAX_BYTES, PDF_IMAGE_MAX_EDGE, PDF_IMAGES_MAX_BYTES, PDF_IMAGES_MAX_PIXELS,
  type PdfPageProcessing, type PdfProcessingSelection, type PdfProcessorConfig } from './pdf-processing-schema.js';

/** Internal local-only processor. The PDF importer must separately validate/capture evidence. */
export async function processPdfPages(input: Buffer, pageCount: number, requested: PdfProcessingSelection, host: PdfProcessorConfig, timeoutMs = 10_000) {
  throwIfCancelled();
  const selected = pdfProcessingSelectionSchema.safeParse(requested), configured = pdfProcessorConfigSchema.safeParse(host);
  if (!selected.success || !configured.success || !Buffer.isBuffer(input) || input.length > 5_000_000 || !input.subarray(0, 5).equals(Buffer.from('%PDF-'))
    || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 100 || selected.data.pages.some(number => number > pageCount)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) invalid();
  const selection = selected.data, config = configured.data, bytes = Buffer.from(input);
  const workRoot = await directory(config.workRoot, true);
  const renderer = await executable(config.renderer);
  const ocr = selection.languages ? await executable(config.ocr) : undefined;
  const languageRoot = selection.languages ? await directory(config.languageData) : undefined;
  const fontRoot = config.fontDirectory ? await directory(config.fontDirectory) : undefined;
  const fonts = await fontProfile(fontRoot);
  const languages = await Promise.all((selection.languages ?? []).map(async name => ({ name, sha256: await fileHash(join(languageRoot!, name + '.traineddata'), 64_000_000) })));
  const verifyProfile = async () => {
    try {
      throwIfCancelled();
      if (await realpath(config.renderer) !== renderer.path || await fileHash(renderer.path, 128_000_000) !== renderer.sha256) changed();
      if (ocr && (await realpath(config.ocr!) !== ocr.path || await fileHash(ocr.path, 128_000_000) !== ocr.sha256 || await realpath(config.languageData!) !== languageRoot)) changed();
      for (const item of languages) if (await fileHash(join(languageRoot!, item.name + '.traineddata'), 64_000_000) !== item.sha256) changed();
      if (fontRoot && await realpath(config.fontDirectory!) !== fontRoot || JSON.stringify(await fontProfile(fontRoot)) !== JSON.stringify(fonts)) changed();
      await directory(config.workRoot, true); throwIfCancelled();
    } catch (error) { if (error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED') throw error; changed(); }
  };
  const record = await withFileLock(join(workRoot, 'pdf-processing.lock'), async () => {
    await cleanStale(workRoot);
    throwIfCancelled();
    const temporary = await mkdtemp(join(workRoot, 'pdf-owned-'));
    try {
      await writeFile(join(temporary, 'owner.json'), JSON.stringify({ version: 1, pid: process.pid }), { flag: 'wx', mode: 0o600 });
      await writeFile(join(temporary, 'source.pdf'), bytes, { flag: 'wx', mode: 0o600 });
      const cache = join(temporary, 'font-cache'); await mkdir(cache, { mode: 0o700 });
      await writeFile(join(temporary, 'fonts.conf'), `<?xml version="1.0"?><fontconfig><reset-dirs/>${fontRoot ? '<dir>' + xml(fontRoot) + '</dir>' : ''}<cachedir>${xml(cache)}</cachedir></fontconfig>`, { flag: 'wx', mode: 0o600 });
      // One deadline covers all owned native executions; queue/fingerprinting are separate.
      const end = performance.now() + timeoutMs;
      const environment = { PATH: process.platform === 'win32' ? process.env.PATH : '/usr/bin:/bin',
        ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        LANG: 'C', LC_ALL: 'C', TMPDIR: temporary, TEMP: temporary, TMP: temporary, OMP_THREAD_LIMIT: '1', OMP_NUM_THREADS: '1',
        FONTCONFIG_FILE: join(temporary, 'fonts.conf'), FONTCONFIG_PATH: temporary, XDG_CACHE_HOME: cache };
      const run = async (path: string, args: string[], limit: number) => {
        const value = await execute(path, args, temporary, environment, end, limit); await fontCache(cache, false); return value;
      };
      const rendererVersion = version(await run(renderer.path, ['-v'], 8192), /^pdftoppm version (\S+)/m);
      const ocrVersion = ocr ? version(await run(ocr.path, ['--version'], 8192), /^tesseract (\S+)/m) : undefined;
      const pages: PdfPageProcessing['pages'] = []; let totalBytes = 0, pixels = 0;
      for (const number of selection.pages) {
        throwIfCancelled();
        const image = (await run(renderer.path, ['-f', String(number), '-l', String(number), '-scale-to', String(PDF_IMAGE_MAX_EDGE), '-singlefile', '-png', join(temporary, 'source.pdf')], PDF_IMAGE_MAX_BYTES)).out;
        const size = inspectPdfPng(image);
        totalBytes += image.length; pixels += size.width * size.height;
        if (totalBytes > PDF_IMAGES_MAX_BYTES || pixels > PDF_IMAGES_MAX_PIXELS) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete selected PDF images exceed limits');
        let ocrText: string | undefined;
        if (ocr) {
          const path = join(temporary, 'page.png');
          await writeFile(path, image, { flag: 'wx', mode: 0o600 });
          try {
            const output = (await run(ocr.path, [path, 'stdout', '--tessdata-dir', languageRoot!, '-l', selection.languages!.join('+'), '--psm', '3', 'txt'], 160_000)).out;
            try { ocrText = new TextDecoder('utf-8', { fatal: true }).decode(output).trim(); } catch { invalid(); }
            if (ocrText.includes('\0')) invalid();
            if (ocrText.length > 40_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF OCR page exceeds the character limit');
          } finally { await rm(path, { force: true }); }
        }
        pages.push({ number, ...size, mediaType: 'image/png', bytes: image.length, sha256: createHash('sha256').update(image).digest('hex'), data: image.toString('base64'),
          ...(ocrText === undefined ? {} : { ocrText, ocrSha256: sha256(ocrText) }) });
      }
      const result: PdfPageProcessing = { version: 1, sourceSha256: createHash('sha256').update(bytes).digest('hex'), selection,
        renderer: { sha256: renderer.sha256, version: rendererVersion, fonts }, ...(ocr ? { ocr: { sha256: ocr.sha256, version: ocrVersion!, languages } } : {}), pages };
      assertPdfPageProcessing(result); await verifyProfile(); return result;
    } finally { await removeOwned(temporary); }
  });
  await verifyProfile();
  return { record, verifyProfile };
}

async function executable(input: string | undefined) {
  if (!input || !isAbsolute(input) || input.includes('\0')) unavailable();
  try {
    const path = await realpath(input), stat = await lstat(path);
    if (!stat.isFile() || process.platform !== 'win32' && !(stat.mode & 0o111)) unavailable();
    return { path, sha256: await fileHash(path, 128_000_000) };
  } catch (error) { if (error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED') throw error; unavailable(); }
}
async function directory(input: string | undefined, privateRoot = false): Promise<string> {
  if (!input || !isAbsolute(input) || input.includes('\0')) unavailable();
  try {
    const path = await realpath(input), stat = await lstat(path);
    if (!stat.isDirectory() || privateRoot && (path !== input || process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid!()))) unavailable();
    return path;
  } catch { unavailable(); }
}
async function fileHash(path: string, maximum: number): Promise<string> {
  throwIfCancelled();
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat(); if (!before.isFile() || before.size > maximum) unavailable();
      const hash = createHash('sha256'); let total = 0;
      while (true) {
        throwIfCancelled(); const buffer = Buffer.alloc(65536), { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break; total += bytesRead; if (total > maximum) unavailable(); hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await file.stat(), entry = await lstat(path);
      if (entry.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || total !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || entry.ino !== after.ino || entry.dev !== after.dev) changed();
      return hash.digest('hex');
    } finally { await file.close(); }
  } catch (error) { if (error instanceof AgentMemoryError) throw error; unavailable(); }
}
async function fontProfile(root: string | undefined) {
  if (!root) return [];
  const entries = [];
  for await (const entry of await opendir(root)) { if (entries.length >= 32 || !entry.isFile() || !/^[^/\\\0]{1,200}\.(?:ttf|otf)$/i.test(entry.name)) unavailable(); entries.push(entry); }
  if (!entries.length) unavailable();
  let bytes = 0;
  const result: Array<{ name: string; sha256: string }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(root, entry.name), before = await lstat(path); bytes += before.size; if (bytes > 128_000_000) unavailable();
    const digest = await fileHash(path, 32_000_000), after = await lstat(path);
    if (before.size !== after.size || before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) changed();
    result.push({ name: entry.name, sha256: digest });
  }
  return result;
}

function execute(path: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, end: number, maximum: number): Promise<{ out: Buffer; err: Buffer }> {
  throwIfCancelled(); if (performance.now() >= end) timedOut();
  const signal = operationSignal();
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { cwd, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = []; let outBytes = 0, errBytes = 0, failure: unknown, closing: Promise<void> | undefined;
    const stop = (reason?: unknown) => {
      failure ??= reason;
      closing ??= stopOwnedGroup(child).catch(() => { failure = new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Could not stop owned PDF processor processes'); });
    };
    const abort = AsyncResource.bind(() => stop(cancellationError()));
    const timer = setTimeout(() => stop(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'PDF processing exceeded its execution deadline')), Math.max(1, end - performance.now()));
    child.stdout!.on('data', (chunk: Buffer) => { outBytes += chunk.length; if (outBytes > maximum) stop(new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF processor exceeded its complete output limit')); else out.push(chunk); });
    child.stderr!.on('data', (chunk: Buffer) => { errBytes += chunk.length; if (errBytes > 65536) stop(new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF processor diagnostics exceeded limits')); else err.push(chunk); });
    child.once('error', () => { failure ??= new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Local PDF processor could not start'); });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); stop();
      void closing!.then(() => {
        if (failure) reject(failure);
        else if (signal?.aborted) reject(cancellationError());
        else if (code !== 0) reject(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Local PDF processor failed'));
        else resolve({ out: Buffer.concat(out), err: Buffer.concat(err) });
      });
    });
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}

async function cleanStale(root: string) {
  const owned: string[] = []; let entries = 0;
  for await (const entry of await opendir(root)) {
    if (++entries > 512) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF work directory scan exceeds limits');
    if (/^pdf-owned-[a-zA-Z0-9]+$/.test(entry.name)) owned.push(entry.name);
    if (owned.length > 8) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Too many pending PDF processing directories');
  }
  for (const name of owned) {
    const path = join(root, name);
    if (!await ownedDirectory(path)) unavailable();
    const marker = await owner(join(path, 'owner.json'));
    try { process.kill(marker.pid as number, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') await removeOwned(path); }
  }
  if ((await readdir(root)).filter(name => /^pdf-owned-[a-zA-Z0-9]+$/.test(name)).length >= 8) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Too many live PDF processing directories');
}
async function owner(path: string): Promise<{ version: 1; pid: number }> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat(); if (!before.isFile() || before.nlink !== 1 || before.size > 1000) unavailable();
      const buffer = Buffer.alloc(1001), { bytesRead } = await file.read(buffer, 0, buffer.length, 0), after = await file.stat(), entry = await lstat(path);
      if (bytesRead > 1000 || bytesRead !== after.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || entry.isSymbolicLink() || entry.dev !== after.dev || entry.ino !== after.ino) unavailable();
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
      if (!value || Object.keys(value).sort().join(',') !== 'pid,version' || value.version !== 1 || !Number.isSafeInteger(value.pid) || value.pid < 1 || value.pid > 2147483647) unavailable();
      return value;
    } finally { await file.close(); }
  } catch { unavailable(); }
}
async function ownedDirectory(path: string) {
  const stat = await lstat(path);
  return stat.isDirectory() && !stat.isSymbolicLink() && (process.platform === 'win32' || stat.uid === process.getuid!() && !(stat.mode & 0o077));
}
async function removeOwned(path: string) {
  if (!await ownedDirectory(path)) unavailable();
  for (const name of await readdir(path)) {
    if (name === 'font-cache') { await fontCache(join(path, name), true); continue; }
    if (!['owner.json', 'source.pdf', 'page.png', 'fonts.conf'].includes(name)) unavailable();
    const stat = await lstat(join(path, name)); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) unavailable();
  }
  await rm(path, { recursive: true });
}
async function fontCache(path: string, remove: boolean) {
  if (!await ownedDirectory(path)) unavailable();
  let total = 0, count = 0;
  for await (const { name } of await opendir(path)) {
    if (++count > (remove ? 4096 : 64)) unavailable();
    if (name !== 'CACHEDIR.TAG' && !/^[a-zA-Z0-9._-]{1,200}$/.test(name)) unavailable();
    const file = join(path, name), stat = await lstat(file); total += stat.size;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) unavailable();
    if (!remove && (stat.size > 4_000_000 || total > 8_000_000)) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF font cache exceeds accepted work-file limits');
  }
  if (remove) await rm(path, { recursive: true });
}
function xml(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function version(value: { out: Buffer; err: Buffer }, pattern: RegExp) {
  const match = pattern.exec(Buffer.concat([value.out, value.err]).toString('utf8'));
  if (!match || !/^[0-9][0-9a-zA-Z.+_-]{0,79}$/.test(match[1]!)) unavailable(); return match[1]!;
}
function unavailable(): never { throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Local PDF processors, language data or private work directory are unavailable or invalid'); }
function changed(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Local PDF processor or language profile changed; prepare again'); }
function invalid(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid explicit PDF processing selection or configuration'); }
function timedOut(): never { throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'PDF processing exceeded its execution deadline'); }
