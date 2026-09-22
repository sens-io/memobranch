import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { withOperation } from './operation.js';
import { authorize, type Permission } from './policy.js';
import { settingsSchema } from './settings.js';
import { memoryKinds, scopes, sensitivities } from './types.js';
import { MemoryVault, type MemoryVaultOptions } from './vault.js';
import { webHtml, webCss, webScript } from './web-ui.js';

const text = z.string().trim().min(1).max(100_000);
const id = z.string().trim().min(1).max(300);
const empty = z.object({}).strict();
const classified = { scope: z.enum(scopes), sensitivity: z.enum(sensitivities) };
const confirmed = { confirm: z.literal(true) };
const reason = { id, reason: text, ...confirmed };

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
  session: route('read', empty, async vault => ({ principal: vault.principal, name: (await vault.settings()).values.name })),
  records: route('read', z.object({ collection: z.enum(['evidence', 'candidates', 'memories']),
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(30),
    query: z.string().max(200).default(''), status: z.string().max(30).default(''),
  }).strict(), (vault, data) => vault.listRecords(data)),
  get: route('read', z.object({ id }).strict(), (vault, data) => vault.get(data.id)),
  capture: route('write', z.object({ content: text, ...classified }).strict(), (vault, data) => vault.capture({ ...data, extract: false })),
  propose: route('write', z.object({ key: id, statement: text, kind: z.enum(memoryKinds), ...classified,
    confidence: z.number().min(0).max(1), explicit: z.boolean(), evidence: z.array(id).max(100),
  }).strict(), (vault, { evidence, ...data }) => vault.propose({ ...data, conditions: [], tags: [] }, evidence)),
  approve: route('review', z.object({ id, ...confirmed }).strict(), (vault, data) => vault.approve(data.id)),
  reject: route('review', z.object(reason).strict(), (vault, data) => vault.reject(data.id, data.reason)),
  forget: route('review', z.object(reason).strict(), (vault, data) => vault.forget(data.id, data.reason)),
  settings: route('read', empty, vault => vault.settings()),
  'settings-save': route('admin', z.object({ values: settingsSchema, revision: z.string().regex(/^[a-f0-9]{64}$/), ...confirmed }).strict(),
    (vault, data) => vault.updateSettings(data.values, data.revision)),
  catalog: route('read', empty, vault => vault.wikiCatalog()),
  rules: route('read', empty, vault => vault.wikiRules()),
  'rules-save': route('maintain', z.object({ purpose: text, instructions: text, ...classified,
    expectedRevision: z.number().int().min(0), ...confirmed }).strict(),
    (vault, { confirm: _confirm, ...data }) => vault.wikiSetRules(data)),
  ingest: route('write', z.object({ evidenceIds: z.array(id).min(1).max(100) }).strict(), (vault, data) => vault.wikiIngest({ ...data, apply: false })),
  apply: route('review', z.object({ plan: z.unknown(), ...confirmed }).strict(), (vault, data) => vault.wikiApply(data.plan)),
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

export interface WebHandle {
  url: string;
  token: string;
  stop(): Promise<void>;
}

/** Local single-operator adapter. Credentials are never accepted through request bodies. */
export async function startWebServer(root: string, options: MemoryVaultOptions & { port?: number } = {}): Promise<WebHandle> {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AgentMemoryError('CONFIG_INVALID', 'Web port must be between 0 and 65535');
  const { port: _port, ...vaultOptions } = options;
  const initial = new MemoryVault(root, vaultOptions);
  await initial.settings(); // Validate the vault, tenant and baseline read authority before listening.
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(`Bearer ${token}`);
  const active = new Set<AbortController>();
  const pending = new Set<Promise<void>>();
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
    const operation = Object.hasOwn(routes, path.slice(5)) ? routes[path.slice(5)] : undefined;
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
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 1_048_576) {
          send(res, 413, { error: { code: 'CONTENT_TOO_LARGE', message: 'Request exceeds 1 MiB' } });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      let input: unknown;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid JSON'); }
      const result = await withOperation(controller.signal, () => operation.run(new MemoryVault(root, vaultOptions), input));
      send(res, 200, { result });
    } catch (error) {
      const normalized = toAgentMemoryError(error);
      const status = normalized.code === 'AUTHORIZATION_DENIED' ? 403 : normalized.code === 'NOT_FOUND' ? 404 : normalized.code === 'OPERATION_CANCELLED' ? 408 : 400;
      // Errors may embed content or transport URLs; expose stable codes and committed outcomes only.
      send(res, status, { error: { code: normalized.code,
        message: normalized.code === 'VALIDATION_FAILED' ? 'Invalid input or stale state; reload and check the form' : normalized.code,
        ...(normalized.code === 'OPERATION_CANCELLED' && normalized.safeDetails?.committed ? { committed: normalized.safeDetails.committed } : {}),
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
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      // Close unfinished request bodies too, then await safe vault transaction cleanup.
      server.closeAllConnections();
      await Promise.allSettled([...pending]);
      await closed;
    })();
    return stopped;
  } };
}

function send(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
