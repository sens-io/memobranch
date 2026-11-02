import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readImportPreview, serializeImportPreview } from './directory-import.js';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { combineSignals, operationSignal, throwIfCancelled, withOperation } from './operation.js';
import { authorize } from './policy.js';
import type { Scope, Sensitivity } from './types.js';
import { sha256 } from './utils.js';
import type { CaptureResult, MemoryVault } from './vault.js';
import { fetchPublicWebSource, publicWebUrl, type WebReadOptions, type WebSource } from './web-source.js';

const mediaTypes = ['text/plain', 'text/markdown', 'text/html', 'application/xhtml+xml'] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const documentSchema = z.strictObject({ url: z.string().min(1).max(4096), finalUrl: z.string().min(1).max(4096),
  mediaType: z.enum(mediaTypes), bytes: z.number().int().min(1).max(1_000_000), sha256: hash });
const planSchema = z.strictObject({ version: z.literal(1), kind: z.literal('public-web-import'),
  documents: z.array(documentSchema).min(1).max(20), totalBytes: z.number().int().min(1).max(5_000_000), revision: hash });

export type WebImportPlan = z.infer<typeof planSchema>;
export interface WebPreviewOptions { signal?: AbortSignal; timeoutMs?: number }
export interface WebImportProgress { completed: number; total: number; sourceUri: string; result: CaptureResult }
export interface WebImportOptions extends WebPreviewOptions {
  scope?: Scope;
  sensitivity?: Sensitivity;
  onProgress?: (progress: WebImportProgress) => void | Promise<void>;
}

type Reader = (url: string, options: WebReadOptions) => Promise<WebSource>;

/** Internal test seam: not exported from the package root or selectable by CLI/environment. */
export function createWebImportWorkflow(reader: Reader) {
  const preflight = async (inputs: string[], options: WebPreviewOptions) => {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 20) throw invalid('Web import requires 1–20 explicit URLs');
    const urls = inputs.map(input => publicWebUrl(input).href);
    if (new Set(urls).size !== urls.length) throw invalid('Web import URLs must be unique after normalization');
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw invalid('Invalid web source timeout');
    const deadline = new AbortController();
    const parents = [operationSignal(), options.signal].filter((signal): signal is AbortSignal => Boolean(signal));
    const combined = combineSignals([...parents, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(), 60_000);
    try {
      return await withOperation(combined.signal, async () => {
        const sources: WebSource[] = [];
        let totalBytes = 0;
        for (const url of urls) {
          throwIfCancelled();
          if (totalBytes >= 5_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Web import exceeds its 5 MB total byte limit');
          const source = await reader(url, { signal: combined.signal, timeoutMs, maxBytes: Math.min(1_000_000, 5_000_000 - totalBytes) });
          throwIfCancelled();
          const parsed = documentSchema.safeParse(summary(source));
          if (!parsed.success || source.url !== url || publicWebUrl(source.finalUrl).href !== source.finalUrl ||
              typeof source.content !== 'string' || !source.content.trim() || source.content.includes('\0') ||
              Buffer.byteLength(source.content, 'utf8') !== source.bytes || createHash('sha256').update(source.content, 'utf8').digest('hex') !== source.sha256) {
            throw invalid('Web source returned invalid provenance or source bytes');
          }
          totalBytes += source.bytes;
          if (totalBytes > 5_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Web import exceeds its 5 MB total byte limit');
          sources.push(source);
        }
        const payload = { version: 1 as const, kind: 'public-web-import' as const, documents: sources.map(summary), totalBytes };
        const plan = { ...payload, revision: sha256(JSON.stringify(payload)) };
        serializeImportPreview(plan);
        return { sources, plan };
      });
    } catch (error) {
      if (deadline.signal.aborted && !parents.some(signal => signal.aborted)) throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Web import preflight deadline exceeded');
      throw error;
    } finally { clearTimeout(timer); combined.dispose(); }
  };

  const preview = async (urls: string[], options: WebPreviewOptions = {}): Promise<WebImportPlan> => (await preflight(urls, options)).plan;
  const applySnapshot = async (vault: MemoryVault, input: unknown, options: WebImportOptions) => {
    const config = await vault.config();
    const scope = options.scope ?? 'project';
    const sensitivity = options.sensitivity ?? 'internal';
    authorize(vault.principal, 'write', { tenantId: config.tenantId, scope, sensitivity });
    const expected = checkedPlan(input);
    const current = await preflight(expected.documents.map(document => document.url), options);
    if (JSON.stringify(current.plan) !== JSON.stringify(expected)) throw invalid('Web sources changed; inspect a new preview before importing');
    const contents = current.sources.map(source => JSON.stringify({ type: 'web-source', version: 1, ...summary(source), content: source.content }));
    if (contents.some(content => content.length > config.limits.maxContentCharacters)) {
      throw new AgentMemoryError('CONTENT_TOO_LARGE', 'A web source envelope exceeds the vault content limit');
    }
    const entries: WebImportProgress[] = [];
    try {
      for (const [index, source] of current.sources.entries()) {
        throwIfCancelled();
        const result = await vault.capture({ content: contents[index]!, sourceUri: source.url, scope, sensitivity, extract: false });
        const progress = { completed: index + 1, total: current.sources.length, sourceUri: source.url, result };
        entries.push(progress);
        await options.onProgress?.(progress);
      }
      return { status: 'completed' as const, total: current.sources.length, entries, interruptedCommits: [] };
    } catch (error) {
      const failure = toAgentMemoryError(error);
      return { status: failure.code === 'OPERATION_CANCELLED' ? 'cancelled' as const : 'failed' as const,
        total: current.sources.length, entries, interruptedCommits: failure.safeDetails?.committed ?? [],
        error: { code: failure.code, message: 'Web import stopped; completed evidence remains saved. Revalidate the unchanged preview to retry.' } };
    }
  };
  const apply = async (vault: MemoryVault, input: unknown, options: WebImportOptions = {}) => {
    if (!options.signal) return applySnapshot(vault, input, options);
    const parent = operationSignal();
    const combined = combineSignals(parent ? [parent, options.signal] : [options.signal]);
    try { return await withOperation(combined.signal, () => applySnapshot(vault, input, options)); }
    finally { combined.dispose(); }
  };
  return { preview, apply };
}

function summary(source: WebSource): WebImportPlan['documents'][number] {
  return { url: source.url, finalUrl: source.finalUrl, mediaType: source.mediaType as typeof mediaTypes[number], bytes: source.bytes, sha256: source.sha256 };
}

function checkedPlan(input: unknown): WebImportPlan {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw invalid('Invalid public web import preview');
  const { revision, ...payload } = parsed.data;
  if (payload.documents.some(document => publicWebUrl(document.url).href !== document.url || publicWebUrl(document.finalUrl).href !== document.finalUrl) ||
      new Set(payload.documents.map(document => document.url)).size !== payload.documents.length ||
      payload.totalBytes !== payload.documents.reduce((total, document) => total + document.bytes, 0) || sha256(JSON.stringify(payload)) !== revision) {
    throw invalid('Web import preview was modified; create a new preview');
  }
  return parsed.data;
}

const workflow = createWebImportWorkflow(fetchPublicWebSource);
export const previewWebImport = workflow.preview;
export const applyWebImport = workflow.apply;
export async function readWebImportPlan(path: string): Promise<WebImportPlan> { return checkedPlan(await readImportPreview(path)); }
export function serializeWebImportPlan(plan: WebImportPlan): string { return serializeImportPreview(checkedPlan(plan)); }
function invalid(message: string) { return new AgentMemoryError('VALIDATION_FAILED', message); }
