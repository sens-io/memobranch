import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AgentMemoryError } from './errors.js';
import { readImportPreview, serializeImportPreview } from './directory-import.js';
import { cancellationError, combineSignals, operationSignal, throwIfCancelled, withOperation } from './operation.js';
import { assertPdfEvidence, pdfHeader, PDF_EXTRACTION_WARNING, PDF_MAX_BYTES, PDF_MAX_CHARACTERS, PDF_MAX_PAGES } from './pdf-evidence.js';
import { authorize } from './policy.js';
import type { PdfOriginal, Scope, Sensitivity } from './types.js';
import { sha256 } from './utils.js';
import type { MemoryVault } from './vault.js';

export interface PdfImportPlan {
  version: 1;
  kind: 'local-pdf';
  path: string;
  sourceUri: string;
  sha256: string;
  bytes: number;
  parser: string;
  pages: Array<{ number: number; sha256: string; characters: number; empty: boolean }>;
  warnings: string[];
  revision: string;
}
export interface PdfPreviewOptions { signal?: AbortSignal; timeoutMs?: number }
export interface PdfImportOptions extends PdfPreviewOptions { scope?: Scope; sensitivity?: Sensitivity }

/** Local API/CLI only. Never expose caller-selected paths through server tools. */
export async function previewPdfImport(path: string, options: PdfPreviewOptions = {}): Promise<PdfImportPlan> {
  return run(options, async () => (await inspect(path, timeout(options))).plan);
}
export const serializePdfImportPlan = (plan: PdfImportPlan): string => serializeImportPreview(plan);
export const readPdfImportPlan = async (path: string): Promise<PdfImportPlan> => await readImportPreview(path) as PdfImportPlan;

export async function applyPdfImport(vault: MemoryVault, input: PdfImportPlan, options: PdfImportOptions = {}) {
  return run(options, async () => {
    const config = await vault.config(), scope = options.scope ?? 'project', sensitivity = options.sensitivity ?? 'internal';
    authorize(vault.principal, 'write', { tenantId: config.tenantId, scope, sensitivity });
    if (!input || input.version !== 1 || input.kind !== 'local-pdf' || typeof input.path !== 'string') {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid PDF import preview');
    }
    const current = await inspect(input.path, timeout(options));
    if (JSON.stringify(input) !== JSON.stringify(current.plan)) throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source, parser or preview changed; create a new preview');
    throwIfCancelled();
    return vault.capture({ content: current.content, pdfOriginal: current.original, sourceUri: current.plan.sourceUri, scope, sensitivity, extract: false });
  });
}

/** Exact bytes are returned only after an ordinary authorized canonical record read. */
export async function readPdfOriginal(vault: MemoryVault, evidenceId: string): Promise<Buffer> {
  const document = await vault.get(evidenceId), source = (document.meta as { pdfOriginal?: unknown }).pdfOriginal;
  if (document.meta.type !== 'evidence' || !source) throw new AgentMemoryError('NOT_FOUND', 'PDF original is unavailable');
  assertPdfEvidence(source, document.body.slice(`# Evidence ${document.meta.id}\n\n`.length));
  return Buffer.from(source.data, 'base64');
}

function timeout(options: PdfPreviewOptions): number {
  const value = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) throw new AgentMemoryError('VALIDATION_FAILED', 'PDF timeout must be 1–120000 ms');
  return value;
}
async function run<T>(options: PdfPreviewOptions, action: () => Promise<T>): Promise<T> {
  if (!options.signal) return action();
  const signals = [operationSignal(), options.signal].filter((value): value is AbortSignal => value !== undefined);
  if (!signals.length) return action();
  const combined = combineSignals(signals);
  try { return await withOperation(combined.signal, action); } finally { combined.dispose(); }
}

async function inspect(input: string, timeoutMs: number) {
  throwIfCancelled();
  if (typeof input !== 'string' || !input.trim()) throw new AgentMemoryError('VALIDATION_FAILED', 'An explicit local PDF path is required');
  const path = resolve(input);
  if (await realpath(path) !== path) throw new AgentMemoryError('VALIDATION_FAILED', 'PDF import does not follow symbolic links');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  let identity: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source must be a regular file');
    if (before.size > PDF_MAX_BYTES) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF source exceeds 5 MB');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      throwIfCancelled(); const chunk = Buffer.alloc(Math.min(65536, PDF_MAX_BYTES + 1 - size));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null); if (!bytesRead) break;
      size += bytesRead; if (size > PDF_MAX_BYTES) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF source exceeds 5 MB');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await file.stat(), entry = await lstat(path);
    if (entry.isSymbolicLink() || entry.ino !== after.ino || entry.dev !== after.dev || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || await realpath(path) !== path) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source changed while reading');
    }
    bytes = Buffer.concat(chunks);
    identity = after;
  } finally { await file.close(); }
  if (!bytes.subarray(0, 8).toString('ascii').match(/^%PDF-\d\.\d/) || !bytes.toString('latin1').trimEnd().endsWith('%%EOF')) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source has no supported header or final EOF marker');
  }
  const parsed = await parse(bytes, timeoutMs);
  throwIfCancelled();
  const current = await lstat(path);
  if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || current.size !== identity.size
    || current.mtimeMs !== identity.mtimeMs || current.ctimeMs !== identity.ctimeMs || await realpath(path) !== path) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source changed during parsing');
  }
  const emptyPages = parsed.pages.flatMap((text, index) => text ? [] : [index + 1]);
  const source = { sha256: createHash('sha256').update(bytes).digest('hex'), pages: parsed.pages.length, parser: parsed.parser, emptyPages };
  const content = (pdfHeader(source) + '\n' + parsed.pages.map((text, index) => `## Page ${index + 1}\n\n${text || '[No extractable text; OCR not run.]'}`).join('\n\n')).trim();
  if (content.length > PDF_MAX_CHARACTERS) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF extraction exceeds 200000 characters');
  const original: PdfOriginal = { version: 1, mediaType: 'application/pdf', encoding: 'base64', bytes: bytes.length, ...source,
    data: bytes.toString('base64'), extractionSha256: sha256(content) };
  assertPdfEvidence(original, content);
  const payload = { version: 1 as const, kind: 'local-pdf' as const, path, sourceUri: pathToFileURL(path).href,
    sha256: source.sha256, bytes: bytes.length, parser: parsed.parser,
    pages: parsed.pages.map((text, index) => ({ number: index + 1, sha256: sha256(text), characters: text.length, empty: !text })),
    warnings: [PDF_EXTRACTION_WARNING, ...emptyPages.map(page => `Page ${page}: no extractable text; OCR not run.`)] };
  const plan = { ...payload, revision: sha256(JSON.stringify(payload)) }; serializePdfImportPlan(plan);
  throwIfCancelled();
  return { plan, original, content };
}

async function parse(bytes: Buffer, milliseconds: number): Promise<{ pages: string[]; parser: string }> {
  throwIfCancelled();
  // Source-based development still executes the same built worker tested by installed consumers.
  const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? '../dist/pdf-worker.js' : './pdf-worker.js', import.meta.url), {
    workerData: new Uint8Array(bytes), execArgv: [], stdout: true, stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });
  // Do not expose source/parser diagnostics through stdout, stderr or error text.
  worker.stdout.resume(); worker.stderr.resume();
  const signal = operationSignal();
  try {
    return await new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: AgentMemoryError, value?: { pages: string[]; parser: string }) => {
        if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value!);
      };
      const abort = () => finish(cancellationError());
      const timer = setTimeout(() => finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'PDF parsing exceeded its deadline')), milliseconds);
      signal?.addEventListener('abort', abort, { once: true });
      worker.once('message', (value: { error?: string; pages?: unknown; parser?: unknown }) => {
        if (signal?.aborted) { abort(); return; }
        if (value.error) {
          const code = value.error === 'CONTENT_TOO_LARGE' ? 'CONTENT_TOO_LARGE' : 'VALIDATION_FAILED';
          finish(new AgentMemoryError(code, value.error === 'TEXTLESS' ? 'PDF has no extractable text; OCR was not run' : 'PDF is unreadable, encrypted or exceeds extraction limits')); return;
        }
        if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > PDF_MAX_PAGES
          || value.pages.some(text => typeof text !== 'string') || typeof value.parser !== 'string') {
          finish(new AgentMemoryError('VALIDATION_FAILED', 'PDF worker returned an invalid extraction')); return;
        }
        finish(undefined, { pages: value.pages as string[], parser: value.parser });
      });
      worker.once('error', () => finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'PDF worker failed or exceeded its memory limit')));
      worker.once('exit', () => finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'PDF worker exited before returning an extraction')));
      if (signal?.aborted) abort();
    });
  } finally { await worker.terminate(); }
}
