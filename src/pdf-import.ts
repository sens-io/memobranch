import { constants, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { readImportPreview, serializeImportPreview } from './directory-import.js';
import { cancellationError, combineSignals, operationSignal, throwIfCancelled, withOperation } from './operation.js';
import { assertPdfEvidence, pdfHeader, processedPdfHeader, pdfProcessingSha256, PDF_EXTRACTION_WARNING, PDF_PROCESSING_WARNING, PDF_MAX_BYTES, PDF_MAX_CHARACTERS, PDF_MAX_PAGES } from './pdf-evidence.js';
import { processPdfPages } from './pdf-processing.js';
import { pdfPageProcessingSchema, pdfProcessingSelectionSchema, pdfProcessorConfigSchema, type PdfPageProcessing, type PdfProcessingSelection, type PdfProcessorConfig } from './pdf-processing-schema.js';
import { authorize } from './policy.js';
import type { PdfOriginal, Scope, Sensitivity } from './types.js';
import { sha256 } from './utils.js';
import type { MemoryVault } from './vault.js';

export interface PdfTextImportPlan {
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
const processingSummarySchema = pdfPageProcessingSchema.omit({ pages: true }).extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(pdfPageProcessingSchema.shape.pages.element.omit({ data: true, ocrText: true }).extend({ ocrCharacters: z.number().int().min(0).max(40_000).optional() })).min(1).max(5),
});
const processedPlanSchema = z.object({
  version: z.literal(2), kind: z.literal('local-pdf'), path: z.string().min(1).max(4096), sourceUri: z.string().min(1).max(16_384),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(8).max(PDF_MAX_BYTES), parser: z.string().max(200),
  pages: z.array(z.object({ number: z.number().int().min(1).max(PDF_MAX_PAGES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    characters: z.number().int().min(0).max(PDF_MAX_CHARACTERS), empty: z.boolean() }).strict()).min(1).max(PDF_MAX_PAGES),
  warnings: z.array(z.string().max(1000)).max(250), revision: z.string().regex(/^[a-f0-9]{64}$/), processing: processingSummarySchema,
}).strict();
export interface PdfProcessedImportPlan extends Omit<PdfTextImportPlan, 'version'> {
  version: 2;
  processing: z.infer<typeof processingSummarySchema>;
}
export type PdfImportPlan = PdfTextImportPlan | PdfProcessedImportPlan;
export interface PdfPreviewOptions {
  signal?: AbortSignal; timeoutMs?: number;
  /** Local operator selection; never register these options on a server tool. */
  processing?: PdfProcessingSelection;
  /** Trusted host configuration, separate from every serialized preview. */
  processor?: PdfProcessorConfig;
}
export interface PdfImportOptions extends PdfPreviewOptions { scope?: Scope; sensitivity?: Sensitivity }

/** Local API/CLI only. Never expose caller-selected paths through server tools. */
export async function previewPdfImport(path: string, options: PdfPreviewOptions = {}): Promise<PdfImportPlan> {
  return run(options, async () => (await inspect(path, timeout(options), processingOptions(options))).plan);
}
export const serializePdfImportPlan = (plan: PdfImportPlan): string => serializeImportPreview(plan);
export const readPdfImportPlan = async (path: string): Promise<PdfImportPlan> => await readImportPreview(path) as PdfImportPlan;

export async function applyPdfImport(vault: MemoryVault, input: PdfImportPlan, options: PdfImportOptions = {}) {
  return run(options, async () => {
    const config = await vault.config(), scope = options.scope ?? 'project', sensitivity = options.sensitivity ?? 'internal';
    authorize(vault.principal, 'write', { tenantId: config.tenantId, scope, sensitivity });
    if (!input || (input.version !== 1 && input.version !== 2) || input.kind !== 'local-pdf' || typeof input.path !== 'string') {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid PDF import preview');
    }
    // Freeze the request before any native work. Unknown processing fields refuse before execution.
    const plan = structuredClone(input);
    if (plan.version === 2) {
      serializePdfImportPlan(plan);
      if (!processedPlanSchema.safeParse(plan).success) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid PDF processing preview');
    }
    if (plan.version === 1 && (options.processing !== undefined || options.processor !== undefined)) throw new AgentMemoryError('VALIDATION_FAILED', 'Text-only PDF preview cannot add processing at apply time');
    if (plan.version === 2 && options.processing !== undefined && JSON.stringify(options.processing) !== JSON.stringify(plan.processing.selection)) throw new AgentMemoryError('VALIDATION_FAILED', 'PDF processing selection changed; create a new preview');
    const selected = processingOptions(plan.version === 2 ? { processor: options.processor!, processing: plan.processing.selection } : {});
    const current = await inspect(plan.path, timeout(options), selected);
    if (JSON.stringify(plan) !== JSON.stringify(current.plan)) throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source, parser or preview changed; create a new preview');
    throwIfCancelled();
    const capture = { content: current.content, pdfOriginal: current.original, sourceUri: current.plan.sourceUri, scope, sensitivity, extract: false };
    if (plan.version === 1) return vault.capture(capture);
    return vault.capturePdfImport(capture, {
      revalidate: async () => {
        const latest = await vault.config();
        if (latest.tenantId !== config.tenantId) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'PDF destination tenant changed; prepare again');
        authorize(vault.principal, 'write', { tenantId: latest.tenantId, scope, sensitivity });
        await current.revalidate();
      },
      validate: () => { authorize(vault.principal, 'write', { tenantId: config.tenantId, scope, sensitivity }); current.validate(); },
    });
  });
}

/** Exact bytes are returned only after an ordinary authorized canonical record read. */
export async function readPdfOriginal(vault: MemoryVault, evidenceId: string): Promise<Buffer> {
  const document = await vault.get(evidenceId), source = (document.meta as { pdfOriginal?: unknown }).pdfOriginal;
  if (document.meta.type !== 'evidence' || !source) throw new AgentMemoryError('NOT_FOUND', 'PDF original is unavailable');
  assertPdfEvidence(source, document.body.slice(`# Evidence ${document.meta.id}\n\n`.length));
  return Buffer.from(source.data, 'base64');
}

/** Bounded local media read; authorization and integrity are inherited from the canonical record. */
export async function readPdfPage(vault: MemoryVault, evidenceId: string, number: number): Promise<Buffer> {
  if (!Number.isSafeInteger(number) || number < 1 || number > PDF_MAX_PAGES) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid retained PDF page number');
  const document = await vault.get(evidenceId), original = (document.meta as { pdfOriginal?: unknown }).pdfOriginal;
  if (document.meta.type !== 'evidence' || !original) throw new AgentMemoryError('NOT_FOUND', 'Processed PDF page is unavailable');
  assertPdfEvidence(original, document.body.slice(`# Evidence ${document.meta.id}\n\n`.length));
  const page = original.version === 2 ? original.processing.pages.find(page => page.number === number) : undefined;
  if (!page) throw new AgentMemoryError('NOT_FOUND', 'This PDF page was not retained');
  return Buffer.from(page.data, 'base64');
}

function processingOptions(options: PdfPreviewOptions) {
  if (options.processing === undefined && options.processor === undefined) return undefined;
  const selection = pdfProcessingSelectionSchema.safeParse(options.processing), host = pdfProcessorConfigSchema.safeParse(options.processor);
  if (!selection.success || !host.success) throw new AgentMemoryError('VALIDATION_FAILED', 'Explicit PDF pages and separate host processor configuration are required');
  return { selection: selection.data, host: host.data };
}

function processingSummary(processing: PdfPageProcessing) {
  const { pages, ...profile } = processing;
  return { ...profile, sha256: pdfProcessingSha256(processing), pages: pages.map(({ data: _data, ocrText, ...page }) => ({ ...page, ...(ocrText === undefined ? {} : { ocrCharacters: ocrText.length }) })) };
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

async function inspect(input: string, timeoutMs: number, processing?: ReturnType<typeof processingOptions>) {
  const sourceFile = await readSource(input), { path, bytes } = sourceFile;
  let identity = sourceFile.identity;
  const parsed = await parse(bytes, timeoutMs, processing !== undefined);
  throwIfCancelled();
  validateSource(path, identity);
  const emptyPages = parsed.pages.flatMap((text, index) => text ? [] : [index + 1]);
  const source = { sha256: createHash('sha256').update(bytes).digest('hex'), pages: parsed.pages.length, parser: parsed.parser, emptyPages };
  const processed = processing ? await processPdfPages(bytes, source.pages, processing.selection, processing.host, timeoutMs) : undefined;
  const content = ((processed ? processedPdfHeader(source, processed.record) : pdfHeader(source)) + '\n' + parsed.pages.map((text, index) => {
    const page = processed?.record.pages.find(page => page.number === index + 1);
    if (!processed) return `## Page ${index + 1}\n\n${text || '[No extractable text; OCR not run.]'}`;
    return `## Page ${index + 1}\n\n### Text layer\n\n${text || '[No extractable text.]'}\n\n### Local page processing\n\n${page ? `Rendered PNG SHA-256: ${page.sha256}\n\n${processed.record.ocr ? `OCR (unverified):\n\n${page.ocrText || '[No recognized text.]'}` : '[Rendered only; OCR not run.]'}` : '[Page not rendered; OCR not run.]'}`;
  }).join('\n\n')).trim();
  if (content.length > PDF_MAX_CHARACTERS) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF extraction exceeds 200000 characters');
  const base = { mediaType: 'application/pdf' as const, encoding: 'base64' as const, bytes: bytes.length, ...source,
    data: bytes.toString('base64'), extractionSha256: sha256(content) };
  const original: PdfOriginal = processed ? { ...base, version: 2, processing: processed.record } : { ...base, version: 1 };
  assertPdfEvidence(original, content);
  const payload = { version: processed ? 2 as const : 1 as const, kind: 'local-pdf' as const, path, sourceUri: pathToFileURL(path).href,
    sha256: source.sha256, bytes: bytes.length, parser: parsed.parser,
    pages: parsed.pages.map((text, index) => ({ number: index + 1, sha256: sha256(text), characters: text.length, empty: !text })),
    warnings: processed ? [PDF_PROCESSING_WARNING, ...emptyPages.map(page => `Page ${page}: no extractable text layer.`),
      ...parsed.pages.flatMap((_, index) => processed.record.selection.pages.includes(index + 1) ? [] : [`Page ${index + 1}: not rendered; OCR not run.`]),
      ...processed.record.pages.flatMap(page => page.ocrText === '' ? [`Page ${page.number}: no recognized text.`] : [])]
      : [PDF_EXTRACTION_WARNING, ...emptyPages.map(page => `Page ${page}: no extractable text; OCR not run.`)],
    ...(processed ? { processing: processingSummary(processed.record) } : {}) };
  const plan = { ...payload, revision: sha256(JSON.stringify(payload)) } as PdfImportPlan; serializePdfImportPlan(plan);
  const revalidate = async () => {
    const current = await readSource(path);
    if (!current.bytes.equals(bytes)) throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source changed before capture');
    identity = current.identity;
    await processed?.verifyProfile(); validateSource(path, identity); throwIfCancelled();
  };
  const validate = () => { throwIfCancelled(); validateSource(path, identity); };
  await revalidate();
  return { plan, original, content, revalidate, validate };
}

async function readSource(input: string) {
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
  return { path, bytes, identity };
}

function validateSource(path: string, identity: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }) {
  const current = lstatSync(path);
  if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || current.size !== identity.size
    || current.mtimeMs !== identity.mtimeMs || current.ctimeMs !== identity.ctimeMs || realpathSync(path) !== path) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'PDF source changed during processing or capture');
  }
}

async function parse(bytes: Buffer, milliseconds: number, allowTextless = false): Promise<{ pages: string[]; parser: string }> {
  throwIfCancelled();
  // Source-based development still executes the same built worker tested by installed consumers.
  const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? '../dist/pdf-worker.js' : './pdf-worker.js', import.meta.url), {
    workerData: allowTextless ? { data: new Uint8Array(bytes), allowTextless: true } : new Uint8Array(bytes), execArgv: [], stdout: true, stderr: true,
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
