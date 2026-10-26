import { timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { LlmClient } from './llm.js';
import { throwIfCancelled, withOperation } from './operation.js';
import type { Principal } from './policy.js';
import { SharedWikiReader, sharedWikiSnapshotSchema } from './shared-wiki.js';
import { cloudAttenuationSchema, cloudHostPathSchema, parseCloudJson, readCloudAccounts, readCloudHostFile,
  type CloudWikiAccount, type CloudWikiAttenuation } from './shared-wiki-cloud-config.js';
import { sensitivities } from './types.js';
import { sha256 } from './utils.js';
import { MemoryVault } from './vault.js';

const maximumRequestBytes = 65_536;
const maximumResponseBytes = 21_000_000;
const catalogSchema = z.object({ attenuation: cloudAttenuationSchema }).strict();
const snapshotSchema = sharedWikiSnapshotSchema.extend({ expectedCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  attenuation: cloudAttenuationSchema }).strict();
const optionsSchema = z.object({ configPath: cloudHostPathSchema, host: z.string().refine(value => isIP(value) !== 0).default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(0), publicOrigin: z.string().max(2048).optional(),
  tls: z.object({ certificatePath: cloudHostPathSchema, keyPath: cloudHostPathSchema }).strict().optional(),
  limits: z.object({ requestTimeoutMs: z.number().int().min(100).max(120_000).default(30_000),
    maxConcurrent: z.number().int().min(1).max(32).default(16),
    perAccountConcurrent: z.number().int().min(1).max(8).default(2),
    requestsPerMinute: z.number().int().min(1).max(6000).default(120),
    perAccountRequestsPerMinute: z.number().int().min(1).max(600).default(60),
  }).strict().prefault({}),
}).strict();

export type CloudWikiServerOptions = z.input<typeof optionsSchema> & { env?: NodeJS.ProcessEnv };
export interface CloudWikiServerHandle { url: string; stop(): Promise<void> }

/** A separate read service. Never expose the local management adapter as a cloud service. */
export async function startCloudWikiServer(input: CloudWikiServerOptions): Promise<CloudWikiServerHandle> {
  const { env = process.env, ...raw } = input ?? {};
  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success) throw new AgentMemoryError('CONFIG_INVALID', 'Invalid cloud Wiki service options');
  const options = parsed.data, loopback = options.host === '127.0.0.1' || options.host === '::1';
  if (!loopback && (!options.tls || !options.publicOrigin)) throw new AgentMemoryError('CONFIG_INVALID', 'Public cloud Wiki listeners require TLS and a public origin');
  const configuredOrigin = options.publicOrigin === undefined ? undefined : origin(options.publicOrigin, Boolean(options.tls));
  await readCloudAccounts(options.configPath); // Validate only the host account file, not account resources.
  let material: { cert: Buffer; key: Buffer } | undefined;
  if (options.tls) material = { cert: await readCloudHostFile(options.tls.certificatePath, 1_000_000), key: await readCloudHostFile(options.tls.keyPath, 1_000_000) };
  const active = new Set<AbortController>(), pending = new Set<Promise<void>>();
  const accounts = new Map<string, { active: number; budget: Budget }>();
  const globalBudget = new Budget(options.limits.requestsPerMinute);
  let stopping = false, authority = '', url = '';
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const task = handle(request, response).catch(() => { response.destroy(); });
    pending.add(task); void task.finally(() => pending.delete(task));
  };
  let server;
  try { server = material ? createHttpsServer({ ...material, minVersion: 'TLSv1.2' }, handler) : createHttpServer(handler); }
  catch { throw new AgentMemoryError('CONFIG_INVALID', 'Cloud Wiki TLS configuration is invalid'); }
  server.headersTimeout = 10_000; server.requestTimeout = options.limits.requestTimeoutMs;
  server.keepAliveTimeout = 5_000; server.maxConnections = 64; server.maxHeadersCount = 40;
  // Include sockets still in the TLS handshake in shutdown, rather than waiting for their timeout.
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const fail = (status: number, code: string) => send(res, status, { error: { code, message: code } });
    if (stopping) return fail(503, 'OPERATION_CANCELLED');
    if (!globalBudget.take()) return fail(429, 'LOCK_TIMEOUT');
    if (req.headers.host !== authority || countHeader(req, 'host') !== 1 || countHeader(req, 'origin') > 0) return fail(403, 'AUTHORIZATION_DENIED');
    if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { status: 'ok' });
    if (req.method !== 'POST') return fail(405, 'VALIDATION_FAILED');
    if (req.url !== '/v1/shared-wiki/catalog' && req.url !== '/v1/shared-wiki/snapshot') return fail(404, 'NOT_FOUND');
    if (countHeader(req, 'authorization') !== 1 || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(req.headers.authorization ?? '')) return fail(401, 'AUTHORIZATION_DENIED');
    if (countHeader(req, 'content-type') !== 1 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) return fail(415, 'VALIDATION_FAILED');
    if (active.size >= options.limits.maxConcurrent) return fail(429, 'LOCK_TIMEOUT');
    const controller = new AbortController(); active.add(controller);
    const abort = () => { if (!res.writableFinished) controller.abort(); };
    res.once('close', abort);
    const timeout = setTimeout(() => {
      controller.abort();
      if (!req.complete || res.headersSent) res.destroy();
    }, options.limits.requestTimeoutMs); timeout.unref();
    let accountState: { active: number; budget: Budget } | undefined;
    try {
      await withOperation(controller.signal, async () => {
        const initial = await readCloudAccounts(options.configPath), tokenHash = sha256(req.headers.authorization!.slice(7));
        let account: CloudWikiAccount | undefined;
        for (const candidate of initial.accounts) {
          if (timingSafeEqual(Buffer.from(candidate.tokenSha256, 'hex'), Buffer.from(tokenHash, 'hex'))) account = candidate;
        }
        if (!account) return fail(401, 'AUTHORIZATION_DENIED');
        // IDs can rotate indefinitely in the host file; do not retain an unbounded historical rate map.
        for (const [id, state] of accounts) if (!state.active && !initial.accounts.some(item => item.id === id)) accounts.delete(id);
        accountState = accounts.get(account.id);
        if (!accountState) { accountState = { active: 0, budget: new Budget(options.limits.perAccountRequestsPerMinute) }; accounts.set(account.id, accountState); }
        if (accountState.active >= options.limits.perAccountConcurrent || !accountState.budget.take()) { accountState = undefined; return fail(429, 'LOCK_TIMEOUT'); }
        accountState.active++;
        const body = parseCloudJson(await readBody(req));
        let snapshotData: z.output<typeof snapshotSchema> | undefined, attenuation: CloudWikiAttenuation;
        if (req.url === '/v1/shared-wiki/snapshot') {
          const data = snapshotSchema.safeParse(body);
          if (!data.success) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid cloud Wiki selection');
          snapshotData = data.data; attenuation = data.data.attenuation;
        } else {
          const data = catalogSchema.safeParse(body);
          if (!data.success) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid cloud Wiki selection');
          attenuation = data.data.attenuation;
        }
        const principal = attenuate(account, attenuation);
        if (!principal.scopes.length) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'No permitted scope');
        const broker = new MemoryVault(account.root, { principal, masterKey: '', llm: new LlmClient({ apiKey: '', embeddingModel: '' }) });
        await broker.withReadSnapshot(async () => {
          const config = await broker.config();
          if (config.vaultId !== account!.vaultId || config.tenantId !== account!.tenantId) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'Cloud Wiki broker identity changed');
        }, 'read');
        const reader = new SharedWikiReader(broker, { configPath: account.sharedWikiConfig, env });
        let result: unknown, validate = () => {};
        let expiresAt: string | undefined;
        if (snapshotData) {
          const { attenuation: _attenuation, ...selection } = snapshotData;
          const retained = await reader.snapshotWithValidation(selection);
          result = { view: retained.view, support: retained.support };
          expiresAt = retained.support.expiresAt;
          await retained.validateConfiguration(); validate = retained.validate;
        } else result = await reader.catalog();
        // The account file is checked after every asynchronous broker/source/config read.
        if ((await readCloudAccounts(options.configPath)).hash !== initial.hash) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'Cloud Wiki accounts changed');
        throwIfCancelled(); validate();
        const envelope = snapshotData ? { version: 1, kind: 'cloud-shared-wiki-snapshot', ...result as object,
          validForMs: Math.max(0, Math.min(30_000, expiresAt ? Date.parse(expiresAt) - Date.now() : 30_000)) } : result;
        const bytes = Buffer.from(JSON.stringify(envelope));
        if (bytes.length > maximumResponseBytes) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete cloud Wiki response exceeds its byte limit');
        // Serialization can itself cross the source expiry; do not send an expired assembled body.
        throwIfCancelled(); validate();
        await sendBytes(res, 200, bytes);
      });
    } catch (error) {
      const failure = toAgentMemoryError(error);
      const status = failure.code === 'AUTHORIZATION_DENIED' ? 403 : failure.code === 'NOT_FOUND' ? 404
        : failure.code === 'CONTENT_TOO_LARGE' ? 413 : failure.code === 'OPERATION_CANCELLED' ? 408
        : failure.code === 'LOCK_TIMEOUT' ? 429 : failure.code === 'VALIDATION_FAILED' ? 400 : 503;
      await fail(status, failure.code);
    } finally {
      if (accountState) accountState.active--; clearTimeout(timeout); res.off('close', abort); active.delete(controller);
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, options.host, () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    url = configuredOrigin ?? `${options.tls ? 'https' : 'http'}://${options.host.includes(':') ? `[${options.host}]` : options.host}:${address.port}`;
    authority = new URL(url).host;
  } catch { server.close(); throw new AgentMemoryError('CONFIG_INVALID', 'Cloud Wiki listener could not start'); }
  let stopped: Promise<void> | undefined;
  return { url, stop() {
    stopped ??= (async () => {
      stopping = true; for (const controller of active) controller.abort();
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([...pending]); await closed;
    })();
    return stopped;
  } };
}

function attenuate(account: CloudWikiAccount, restriction: CloudWikiAttenuation): Principal {
  return { id: account.id, name: account.id, tenantId: account.tenantId, permissions: ['read'],
    scopes: account.scopes.filter(scope => restriction.scopes.includes(scope)),
    maxSensitivity: sensitivities[Math.min(sensitivities.indexOf(account.maxSensitivity), sensitivities.indexOf(restriction.maxSensitivity))]! };
}

class Budget {
  private tokens: number; private checkedAt = performance.now();
  constructor(private readonly maximum: number) { this.tokens = maximum; }
  take() {
    const now = performance.now(); this.tokens = Math.min(this.maximum, this.tokens + Math.max(0, now - this.checkedAt) * this.maximum / 60_000); this.checkedAt = now;
    if (this.tokens < 1) return false; this.tokens--; return true;
  }
}

function origin(value: string, tls: boolean) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== (tls ? 'https:' : 'http:') || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== value) throw new Error();
    return parsed.origin;
  } catch { throw new AgentMemoryError('CONFIG_INVALID', 'Invalid cloud Wiki public origin'); }
}
function countHeader(req: IncomingMessage, name: string) { let count = 0; for (let index = 0; index < req.rawHeaders.length; index += 2) if (req.rawHeaders[index]?.toLowerCase() === name) count++; return count; }
async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    throwIfCancelled(); size += Buffer.byteLength(chunk);
    if (size > maximumRequestBytes) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Cloud Wiki request exceeds its byte limit');
    chunks.push(Buffer.from(chunk));
  }
  throwIfCancelled(); return Buffer.concat(chunks);
}
function send(res: ServerResponse, status: number, data: unknown) { return sendBytes(res, status, Buffer.from(JSON.stringify(data))); }
function sendBytes(res: ServerResponse, status: number, bytes: Buffer): Promise<void> {
  if (res.destroyed || res.writableEnded) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off('finish', finished); res.off('close', closed); res.off('error', failed); };
    const finished = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); if (res.writableFinished) resolve(); else reject(new AgentMemoryError('OPERATION_CANCELLED', 'Cloud Wiki response was interrupted')); };
    const failed = () => { cleanup(); reject(new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki response could not be sent')); };
    res.once('finish', finished); res.once('close', closed); res.once('error', failed);
    try { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length }); res.end(bytes); }
    catch { failed(); }
  });
}
