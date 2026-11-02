import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { AgentMemoryError, errorCodes } from './errors.js';
import { cancellationError, operationSignal, throwIfCancelled } from './operation.js';
import type { Principal } from './policy.js';
import { parseCloudJson } from './shared-wiki-cloud-config.js';
import { cloudWikiEnvelope, type CloudWikiExpectedSource } from './shared-wiki-cloud-wire.js';

export interface CloudWikiConnection { origin: string; allowLoopbackHttp?: boolean; timeoutMs?: number; ca?: Buffer }
const remoteErrorSchema = z.object({ error: z.object({ code: z.enum(errorCodes), message: z.string().max(1000) }).strict() }).strict();

export function cloudWikiOriginAllowed(value: string, allowLoopbackHttp = false): boolean {
  try {
    const parsed = new URL(value);
    return value.length <= 2048 && parsed.origin === value && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash
      && (parsed.protocol === 'https:' || allowLoopbackHttp && parsed.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(parsed.hostname));
  } catch { return false; }
}

/** One host-selected endpoint; no redirects, retries, cache, proxy credentials or model calls. */
export async function readCloudWikiSnapshot(connection: CloudWikiConnection, token: string, expected: CloudWikiExpectedSource,
  principal: Principal, selection: { includeSensitive: boolean; includeSecret: boolean }) {
  throwIfCancelled();
  if (!cloudWikiOriginAllowed(connection.origin, connection.allowLoopbackHttp) || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    throw new AgentMemoryError('CONFIG_INVALID', 'Cloud Wiki connection or credential is unavailable or invalid');
  }
  const timeoutMs = connection.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new AgentMemoryError('CONFIG_INVALID', 'Invalid cloud Wiki timeout');
  const signal = operationSignal(), started = performance.now();
  const bytes = await exchange(connection, token, { sourceId: expected.sourceId, expectedCommit: expected.commit, pageKeys: expected.pageKeys, ...selection,
    attenuation: { scopes: principal.scopes, maxSensitivity: principal.maxSensitivity } }, timeoutMs, signal);
  const retained = cloudWikiEnvelope(parseCloudJson(bytes), expected, principal, selection), deadline = started + retained.validForMs;
  if (performance.now() - started >= timeoutMs) throw new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki request timed out');
  const validate = () => {
    throwIfCancelled(); if (signal?.aborted) throw cancellationError();
    if (performance.now() >= deadline || retained.support.validFrom && Date.parse(retained.support.validFrom) > Date.now()
      || retained.support.expiresAt && Date.parse(retained.support.expiresAt) <= Date.now()) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Cloud Wiki read expired; read the configured source again');
    }
  };
  validate(); return { snapshot: retained.snapshot, support: retained.support, validate };
}

function exchange(connection: CloudWikiConnection, token: string, body: object, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let request: ClientRequest | undefined, response: IncomingMessage | undefined, settled = false;
    const finish = (error?: Error, bytes?: Buffer) => {
      if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (error) { response?.destroy(); request?.destroy(); reject(error); } else resolve(bytes!);
    };
    const abort = () => finish(cancellationError());
    const timeout = setTimeout(() => finish(new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki request timed out')), timeoutMs); timeout.unref();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      const endpoint = new URL('/v1/shared-wiki/snapshot', connection.origin), payload = Buffer.from(JSON.stringify(body));
      if (payload.length > 65_536) { finish(new AgentMemoryError('CONTENT_TOO_LARGE', 'Cloud Wiki request exceeds its byte limit')); return; }
      request = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(endpoint, {
        method: 'POST', agent: false, rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(connection.ca ? { ca: connection.ca } : {}),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': payload.length },
      }, incoming => {
        response = incoming;
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) { finish(new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki redirects are not allowed')); return; }
        const count = (name: string) => incoming.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length;
        if (count('content-type') !== 1 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(incoming.headers['content-type'] ?? '')
          || incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') {
          finish(new AgentMemoryError('VALIDATION_FAILED', 'Invalid cloud Wiki response encoding')); return;
        }
        const maximum = status === 200 ? 21_000_000 : 4096;
        if (incoming.headers['content-length'] && (!/^\d+$/.test(incoming.headers['content-length']) || Number(incoming.headers['content-length']) > maximum)) {
          finish(new AgentMemoryError('CONTENT_TOO_LARGE', 'Cloud Wiki response exceeds its byte limit')); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximum) { finish(new AgentMemoryError('CONTENT_TOO_LARGE', 'Cloud Wiki response exceeds its byte limit')); return; }
          chunks.push(Buffer.from(chunk));
        });
        incoming.once('error', () => finish(new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki response was interrupted')));
        incoming.once('aborted', () => finish(new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki response was interrupted')));
        incoming.once('end', () => {
          if (settled) return;
          try {
            if (!incoming.complete) throw new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki response was incomplete');
            const bytes = Buffer.concat(chunks);
            if (status !== 200) {
              const error = remoteErrorSchema.safeParse(parseCloudJson(bytes));
              throw new AgentMemoryError(error.success ? error.data.error.code : 'REMOTE_TRANSPORT', 'Cloud Wiki source is unavailable under current authority');
            }
            finish(undefined, bytes);
          } catch (error) { finish(error instanceof AgentMemoryError ? error : new AgentMemoryError('VALIDATION_FAILED', 'Invalid cloud Wiki response')); }
        });
      });
      request.once('error', () => finish(new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki request failed')));
      request.end(payload);
    } catch { finish(new AgentMemoryError('REMOTE_TRANSPORT', 'Cloud Wiki request failed')); }
  });
}
