import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { withOperation } from './operation.js';
import { authorize, type Permission } from './policy.js';
import { settingsSchema } from './settings.js';
import { memoryKinds, scopes, sensitivities } from './types.js';
import { MemoryVault, type MemoryVaultOptions } from './vault.js';
import { webHtml, webCss, webScript } from './web-ui.js';
import { mergeOptionsSchema } from './wiki-merge.js';
import { wikiSnapshotToolSchema } from './wiki-tool.js';
import { experiencePlanSchema, experienceSuiteSchema, type ExperienceRunner } from './experience.js';
import { experienceCaptureToolSchema, experiencePrepareToolSchema, experienceExportToolSchema } from './experience-tool.js';
import { availabilityAtSchema, availabilityObserveSchema } from './knowledge-availability.js';

const text = z.string().trim().min(1).max(100_000);
// HTTP bytes bound allocation; the core owns configurable content characters.
const content = z.string().trim().min(1);
const id = z.string().trim().min(1).max(300);
const empty = z.object({}).strict();
const classified = { scope: z.enum(scopes), sensitivity: z.enum(sensitivities) };
const confirmed = { confirm: z.literal(true) };
const reason = { id, reason: text, ...confirmed };
const jobId = z.string().regex(/^wj-[a-f0-9]{32}$/);
const jobReference = z.object({ id: jobId }).strict();
const smallRequestBytes = 1_048_576;
const reviewRequestBytes = 16 * smallRequestBytes;

interface Route { permission: Permission; run(vault: MemoryVault, input: unknown): Promise<unknown> }
function route<T>(permission: Permission, schema: z.ZodType<T>, action: (vault: MemoryVault, data: T) => Promise<unknown>): Route {
  return { permission, async run(vault, input) {
    authorize(vault.principal, permission);
    const result = schema.safeParse(input);
    if (!result.success) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid request fields');
    return action(vault, result.data);
  } };
}

const routes: Record<string, Route> = {
  'experience-capture': route('write', experienceCaptureToolSchema, (vault, { trace, scope, sensitivity }) => vault.experienceCapture(trace, {
    ...(scope === undefined ? {} : { scope }), ...(sensitivity === undefined ? {} : { sensitivity }),
  })),
  'experience-prepare': route('write', experiencePrepareToolSchema, (vault, { proposal }) => vault.experiencePrepare(proposal)),
  'experience-export': route('review', experienceExportToolSchema, (vault, { validationId, ...selection }) => vault.experienceExport(validationId, selection)),
  'experience-records': route('read', z.object({ kind: z.enum(['trace', 'validation']),
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20),
    includeSensitive: z.boolean().default(false), includeSecret: z.boolean().default(false),
  }).strict(), async (vault, { kind, offset, limit, ...selection }) => {
    const identity = JSON.stringify(vault.principal); let tenantId = '';
    const result = await settledRead(vault, async () => {
      tenantId = (await vault.config()).tenantId;
      return vault.listRecords({ collection: 'evidence', offset, limit, selection,
        query: kind === 'trace' ? 'MEMOBRANCH_EXPERIENCE_TRACE_V1' : 'MEMOBRANCH_EXPERIENCE_VALIDATION_V1' });
    });
    authorize(vault.principal, 'read', { tenantId });
    if (JSON.stringify(vault.principal) !== identity) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'Experience listing authority changed');
    for (const item of result.items) authorize(vault.principal, 'read', { tenantId,
      scope: item.scope as typeof scopes[number], sensitivity: item.sensitivity as typeof sensitivities[number] });
    return result;
  }),
  session: route('read', empty, async vault => ({ principal: vault.principal, name: (await vault.settings()).values.name })),
  records: route('read', z.object({ collection: z.enum(['evidence', 'candidates', 'memories']),
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(30),
    query: z.string().max(200).default(''), status: z.string().max(30).default(''),
  }).strict(), (vault, data) => vault.listRecords(data)),
  get: route('read', z.object({ id }).strict(), (vault, data) => vault.get(data.id)),
  'memories-at': route('read', z.object({ at: z.string().min(1).max(64), key: z.string().min(1).max(512).optional(),
    includeUnknown: z.boolean().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(),
  }).strict(), (vault, { at, ...options }) => vault.memoriesAt(at, options)),
  'memory-validity': route('review', z.object({ id, validFrom: z.string().max(64).nullable(), validUntil: z.string().max(64).nullable(),
    expectedRevision: z.number().int().min(1), ...confirmed }).strict(), (vault, { id, confirm: _confirm, ...options }) => vault.setMemoryValidity(id, options)),
  capture: route('write', z.object({ content, ...classified }).strict(), (vault, data) => vault.capture({ ...data, extract: false })),
  propose: route('write', z.object({ key: id, statement: content, kind: z.enum(memoryKinds), ...classified,
    confidence: z.number().min(0).max(1), explicit: z.boolean(), evidence: z.array(id).max(100),
  }).strict(), (vault, { evidence, ...data }) => vault.propose({ ...data, conditions: [], tags: [] }, evidence)),
  approve: route('review', z.object({ id, ...confirmed }).strict(), (vault, data) => vault.approve(data.id)),
  reject: route('review', z.object(reason).strict(), (vault, data) => vault.reject(data.id, data.reason)),
  forget: route('review', z.object(reason).strict(), (vault, data) => vault.forget(data.id, data.reason)),
  settings: route('read', empty, vault => vault.settings()),
  'settings-save': route('admin', z.object({ values: settingsSchema, revision: z.string().regex(/^[a-f0-9]{64}$/), ...confirmed }).strict(),
    (vault, data) => vault.updateSettings(data.values, data.revision)),
  catalog: route('read', empty, vault => vault.wikiCatalog()),
  'wiki-snapshot': route('read', wikiSnapshotToolSchema, (vault, data) => vault.wikiSnapshot(data)),
  'wiki-observe': route('write', availabilityObserveSchema, (vault, data) => vault.wikiObserveAvailability(data)),
  'wiki-as-known-at': route('read', availabilityAtSchema, (vault, data) => vault.wikiAsKnownAt(data)),
  'merge-prepare': route('write', mergeOptionsSchema.omit({ signal: true }), (vault, data) => vault.wikiMergePrepare(data)),
  'jobs-list': route('read', empty, vault => vault.wikiJobs()),
  'jobs-show': route('read', jobReference, (vault, data) => vault.wikiJob(data.id)),
  'jobs-enqueue': route('write', z.object({ evidenceIds: z.array(z.string().regex(/^ev-[a-f0-9]{12,64}$/)).min(1).max(40),
    maxPages: z.number().int().min(1).max(40).optional(), ...confirmed }).strict(),
    (vault, data) => vault.wikiEnqueue({ evidenceIds: data.evidenceIds, ...(data.maxPages === undefined ? {} : { maxPages: data.maxPages }) })),
  'jobs-cancel': route('write', z.object({ id: jobId, ...confirmed }).strict(), (vault, data) => vault.wikiCancelJob(data.id)),
  'jobs-retry': route('write', z.object({ id: jobId, ...confirmed }).strict(), (vault, data) => vault.wikiRetryJob(data.id)),
  'jobs-remove': route('write', z.object({ id: jobId, ...confirmed }).strict(), (vault, data) => vault.wikiRemoveJob(data.id)),
  'jobs-review': route('read', jobReference, (vault, data) => vault.wikiReviewJob(data.id)),
  'jobs-apply': route('review', z.object({ id: jobId, proof: z.string().regex(/^[a-f0-9]{64}$/), ...confirmed }).strict(),
    (vault, data) => vault.wikiApplyJob(data.id, data.proof)),
  rules: route('read', empty, vault => vault.wikiRules()),
  'rules-save': route('maintain', z.object({ purpose: text, instructions: text, ...classified,
    expectedRevision: z.number().int().min(0), ...confirmed }).strict(),
    (vault, { confirm: _confirm, ...data }) => vault.wikiSetRules(data)),
  ingest: route('write', z.object({ evidenceIds: z.array(id).min(1).max(100) }).strict(), (vault, data) => vault.wikiIngest({ ...data, apply: false })),
  apply: route('review', z.object({ plan: z.unknown(), ...confirmed }).strict(), (vault, data) => vault.wikiApply(data.plan)),
  preview: route('read', z.object({ plan: z.unknown() }).strict(), (vault, data) => vault.wikiPreview(data.plan)),
  correct: route('write', z.object({ key: id, instruction: content, expectedRevision: z.number().int().min(1) }).strict(), (vault, data) => vault.wikiCorrect(data.key, data.instruction, { expectedRevision: data.expectedRevision })),
  explain: route('read', z.object({ query: text }).strict(), (vault, data) => vault.explain(data.query)),
  query: route('read', z.object({ question: text }).strict(), (vault, data) => vault.wikiQuery(data.question)),
  file: route('write', z.object({ result: z.unknown(), title: id, pageType: z.enum(['query', 'comparison']) }).strict(),
    (vault, data) => vault.wikiFile(data.result, { title: data.title, pageType: data.pageType, apply: false })),
  lint: route('maintain', z.object({ semantic: z.boolean() }).strict(), (vault, data) => vault.wikiLint(data)),
  revoke: route('review', z.object(reason).strict(), (vault, data) => vault.wikiRevoke(data.id, data.reason)),
  history: route('read', empty, vault => vault.history(30)),
  doctor: route('maintain', empty, vault => vault.doctor()),
  reindex: route('maintain', z.object(confirmed).strict(), vault => vault.reindex(false)),
  recover: route('maintain', z.object(confirmed).strict(), vault => vault.recover()),
  'remote-status': route('sync', empty, vault => vault.remoteStatus(false)),
  sync: route('sync', z.object({ push: z.boolean(), ...confirmed }).strict(), (vault, data) => vault.sync({ push: data.push })),
};

// These routes never perform canonical mutations. Use the cross-process writer
// lock, not just an HTTP queue, so CLI/Harness writers also remain invisible
// until their transaction settles. Existing mutations already own this lock.
const snapshotRoutes = new Set(['session', 'records', 'get', 'settings', 'catalog', 'rules',
  'ingest', 'query', 'file', 'lint', 'history', 'doctor', 'reindex', 'remote-status']);

async function settledRead<T>(vault: MemoryVault, action: () => Promise<T>, diagnostics = false, permission: Permission = 'read'): Promise<T> {
  return vault.withReadSnapshot(action, permission, diagnostics);
}

export interface WebHandle {
  url: string;
  token: string;
  stop(): Promise<void>;
}

/** Local single-operator adapter. Credentials are never accepted through request bodies. */
export interface WebOptions extends MemoryVaultOptions { port?: number; experienceRunner?: ExperienceRunner }
export async function startWebServer(root: string, options: WebOptions = {}): Promise<WebHandle> {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AgentMemoryError('CONFIG_INVALID', 'Web port must be between 0 and 65535');
  const { port: _port, experienceRunner, ...vaultOptions } = options;
  if (experienceRunner !== undefined && typeof experienceRunner !== 'function') throw new AgentMemoryError('CONFIG_INVALID', 'Experience evaluator must be trusted application code');
  const initial = new MemoryVault(root, vaultOptions);
  await settledRead(initial, () => initial.settings(), true); // Recovery diagnostics remain reachable.
  const logo = await readFile(new URL('../assets/logo.png', import.meta.url));
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(`Bearer ${token}`);
  const active = new Set<AbortController>();
  const pending = new Set<Promise<void>>();
  const workers = new Set<AbortController>();
  const operations: Record<string, Route> = { ...routes,
    'experience-status': route('read', empty, async () => ({ evaluatorAvailable: typeof experienceRunner === 'function' })),
    'experience-validate': route('review', z.object({ plan: experiencePlanSchema, suite: experienceSuiteSchema,
      includeSensitive: z.boolean().optional(), includeSecret: z.boolean().optional(),
      timeoutMs: z.number().int().min(100).max(120_000).optional(), ...confirmed,
    }).strict(), (vault, { plan, suite, confirm: _confirm, timeoutMs, ...selection }) => {
      if (!experienceRunner) throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'No trusted experience evaluator is configured');
      return vault.experienceValidate(plan, suite, experienceRunner, { ...selection, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    }),
    'jobs-run': route('write', z.object({ id: jobId, ...confirmed }).strict(), async (vault, data) => {
      if (stopping || workers.size) throw new AgentMemoryError('LOCK_TIMEOUT', 'A Web attempt is active or stopping');
      // Reserve before awaiting, including preflight, so simultaneous requests
      // cannot start unbounded background work. The core still owns the claim.
      const controller = new AbortController();
      workers.add(controller);
      let launched = false;
      try {
        const state = await vault.wikiJob(data.id);
        if (state.status !== 'queued') throw new AgentMemoryError('VALIDATION_FAILED', 'Only queued Wiki jobs can be started');
        if (stopping || controller.signal.aborted) throw new AgentMemoryError('OPERATION_CANCELLED', 'Web server is stopping');
        // A fresh context deliberately does not inherit the HTTP disconnect
        // signal. Persisted status, not this acknowledgement, is authoritative.
        const task = withOperation(controller.signal, () => vault.wikiRunJob({ id: data.id, signal: controller.signal }))
          .then(() => {}, () => {})
          .finally(() => { workers.delete(controller); pending.delete(task); });
        pending.add(task);
        launched = true;
        return { id: data.id, accepted: true };
      } finally { if (!launched) workers.delete(controller); }
    }),
  };
  let authority = '';
  let stopping = false;
  const server = createServer((req, res) => {
    const task = handle(req, res).catch(() => { res.destroy(); });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 32;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (stopping) return send(res, 503, { error: { code: 'STOPPING', message: 'Server is stopping' } });
    if (req.headers.host !== authority) return send(res, 403, { error: { code: 'AUTHORIZATION_DENIED', message: 'Invalid host' } });
    const path = req.url ?? '/';
    if (req.method === 'GET' && path === '/assets/logo.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(logo);
      return;
    }
    if (req.method === 'GET' && (path === '/' || path === '/app.js' || path === '/style.css')) {
      res.setHeader('Content-Type', path === '/' ? 'text/html; charset=utf-8' : path === '/app.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      res.end(path === '/' ? webHtml : path === '/app.js' ? webScript : webCss);
      return;
    }
    if (req.method !== 'POST' || !path.startsWith('/api/')) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (req.headers.origin !== `http://${authority}` || supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes)) {
      return send(res, 403, { error: { code: 'AUTHORIZATION_DENIED', message: 'Invalid token or origin' } });
    }
    if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return send(res, 415, { error: { code: 'VALIDATION_FAILED', message: 'JSON required' } });
    const name = path.slice(5);
    const operation = Object.hasOwn(operations, name) ? operations[name] : undefined;
    if (!operation) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    if (active.size >= 8) return send(res, 429, { error: { code: 'BUSY', message: 'Too many active operations' } });
    const controller = new AbortController();
    active.add(controller);
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    const timeout = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, 120_000);
    timeout.unref();
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      const maximum = name === 'apply' || name === 'file' || name === 'preview' || name === 'experience-validate' ? reviewRequestBytes : smallRequestBytes;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > maximum) {
          send(res, 413, { error: { code: 'CONTENT_TOO_LARGE', message: 'Request exceeds the operation byte limit' } });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      let input: unknown;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid JSON'); }
      const result = await withOperation(controller.signal, () => {
        const vault = new MemoryVault(root, vaultOptions);
        const action = () => operation.run(vault, input);
        return snapshotRoutes.has(name) ? settledRead(vault, action, name === 'doctor' || name === 'session', operation.permission) : action();
      });
      // A successful preview must be resubmittable through the same adapter.
      // Fail closed before showing a plan that can never pass its approval route.
      if (name === 'ingest' || name === 'file' || name === 'lint' || name === 'correct' || name === 'merge-prepare') {
        const preview = result as { plan?: unknown; plans?: unknown[] };
        for (const plan of preview.plan ? [preview.plan] : preview.plans ?? []) {
          assertReviewBytes({ plan, confirm: true });
        }
      }
      if (name === 'preview') assertReviewBytes(result);
      if (name === 'jobs-review') assertReviewBytes(result);
      if (name === 'wiki-snapshot' || name === 'merge-prepare' || name === 'wiki-as-known-at') assertReviewBytes({ result });
      if (name === 'query') assertReviewBytes({ result, title: '界'.repeat(300), pageType: 'comparison' });
      if (name === 'experience-prepare') assertReviewBytes({ plan: result, suite: { name: '', cases: [] }, confirm: true });
      if (name === 'experience-export' || name === 'experience-validate') assertReviewBytes(result);
      send(res, 200, { result });
    } catch (error) {
      const normalized = toAgentMemoryError(error);
      const status = normalized.code === 'AUTHORIZATION_DENIED' ? 403 : normalized.code === 'NOT_FOUND' ? 404 : normalized.code === 'OPERATION_CANCELLED' ? 408 : 400;
      // Errors may embed content or transport URLs; expose stable codes and committed outcomes only.
      send(res, status, { error: { code: normalized.code,
        message: normalized.code === 'VALIDATION_FAILED' ? 'Invalid input or stale state; reload and check the form' : normalized.code,
        ...(normalized.code === 'OPERATION_CANCELLED' && normalized.safeDetails?.committed ? { committed: normalized.safeDetails.committed } : {}),
        ...(name === 'experience-validate' ? safeCompletedValidation(normalized.safeDetails?.completedValidation) : {}),
        ...(name === 'wiki-observe' ? safeCompletedAvailability(normalized.safeDetails?.completedAvailability) : {}),
      } });
    } finally {
      clearTimeout(timeout);
      res.off('close', abort);
      active.delete(controller);
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No listening address'));
      authority = `127.0.0.1:${address.port}`;
      resolve();
    });
  });
  let stopped: Promise<void> | undefined;
  return { url: `http://${authority}`, token, stop() {
    stopped ??= (async () => {
      stopping = true;
      for (const controller of active) controller.abort();
      for (const controller of workers) controller.abort();
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      // Close unfinished request bodies too, then await safe vault transaction cleanup.
      server.closeAllConnections();
      await Promise.allSettled([...pending]);
      await closed;
    })();
    return stopped;
  } };
}

function safeCompletedValidation(value: unknown): { completedValidation?: { evidenceId: string; commit: string | null } } {
  const parsed = z.object({ evidenceId: z.string().regex(/^ev-[a-f0-9]{12}$/), commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).nullable() }).strict().safeParse(value);
  return parsed.success ? { completedValidation: parsed.data } : {};
}

function safeCompletedAvailability(value: unknown): { completedAvailability?: { evidenceId: string; commit: string | null } } {
  const result = safeCompletedValidation(value).completedValidation;
  return result ? { completedAvailability: result } : {};
}

function assertReviewBytes(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > reviewRequestBytes) {
    throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Wiki preview exceeds the Web review transport budget');
  }
}

function send(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
