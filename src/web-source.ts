import { Resolver } from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { AgentMemoryError } from './errors.js';
import { cancellationError, combineSignals, operationSignal, throwIfCancelled, withOperation } from './operation.js';

export interface WebSource {
  url: string;
  finalUrl: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  content: string;
}

export interface WebReadOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

const denied = new BlockList();
// Deliberately conservative subsets of IANA special-purpose address registries.
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) denied.addSubnet(address, prefix, 'ipv4');
// Azure's virtual platform address is numerically public but reaches host services.
denied.addAddress('168.63.129.16', 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20],
] as const) denied.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicWebAddress(address: string): boolean {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !denied.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
  return false;
}

export function publicWebUrl(input: string): URL {
  if (typeof input !== 'string' || !input || Buffer.byteLength(input) > 4096 || /[\x00-\x20\x7f\\]/.test(input)) {
    throw invalid('A bounded unambiguous HTTPS URL is required');
  }
  let url: URL;
  try { url = new URL(input); } catch { throw invalid('A valid HTTPS URL is required'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw invalid('Web import accepts HTTPS port 443 without URL credentials only');
  }
  const host = hostOf(url).replace(/\.$/, '');
  if (!host || host === 'localhost' || ['.localhost', '.local', '.internal', '.home.arpa'].some(suffix => host.endsWith(suffix)) ||
      (!isIP(host) && !host.includes('.')) || (isIP(host) && !isPublicWebAddress(host))) {
    throw invalid('Web import requires a public destination');
  }
  if (!isIP(host)) url.hostname = host;
  url.hash = '';
  if (Buffer.byteLength(url.href) > 4096) throw invalid('Normalized web source URL exceeds its byte limit');
  return url;
}

interface Address { address: string; family: 4 | 6 }

/** Owned DNS work; no use of ambient HTTP proxy or second connection-time lookup. */
export async function resolvePublicWebAddress(host: string, signal: AbortSignal): Promise<Address> {
  if (signal.aborted) throw cancellationError();
  if (isIP(host)) {
    if (!isPublicWebAddress(host)) throw invalid('Web import requires a public destination');
    return { address: host, family: isIP(host) as 4 | 6 };
  }
  const resolver = new Resolver({ timeout: 10_000, tries: 1 });
  const abort = () => resolver.cancel();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const records = await Promise.all([
      resolver.resolve4(host).then(values => values.map(address => ({ address, family: 4 as const }))).catch(dnsAbsent),
      resolver.resolve6(host).then(values => values.map(address => ({ address, family: 6 as const }))).catch(dnsAbsent),
    ]);
    if (signal.aborted) throw cancellationError();
    const addresses = records.flat();
    if (!addresses.length || addresses.length > 64 || addresses.some(record => isIP(record.address) !== record.family || !isPublicWebAddress(record.address))) {
      throw invalid('Web destination must resolve exclusively to bounded public addresses');
    }
    return addresses[0]!;
  } catch (error) {
    if (signal.aborted) throw cancellationError();
    if (error instanceof AgentMemoryError) throw error;
    throw unavailable('Unable to resolve public web source');
  } finally { signal.removeEventListener('abort', abort); resolver.cancel(); }
}

function dnsAbsent(error: unknown): never[] {
  if (['ENODATA', 'ENOTFOUND'].includes(String((error as NodeJS.ErrnoException)?.code))) return [];
  throw error;
}

export async function fetchPublicWebSource(input: string, options: WebReadOptions = {}): Promise<WebSource> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_000_000) throw invalid('Invalid web source time or byte limit');
  const initial = publicWebUrl(input);
  const deadline = new AbortController();
  const parents = [operationSignal(), options.signal].filter((signal): signal is AbortSignal => Boolean(signal));
  const combined = combineSignals([...parents, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  try {
    return await withOperation(combined.signal, async () => {
      let url = initial;
      for (let redirects = 0; redirects <= 3; redirects++) {
        throwIfCancelled();
        const address = await resolvePublicWebAddress(hostOf(url), combined.signal);
        const response = await requestPinnedWebSource(url, address, { signal: combined.signal, maxBytes });
        if ('location' in response) {
          if (redirects === 3) throw invalid('Web source redirect limit exceeded');
          try { url = publicWebUrl(new URL(response.location, url).href); }
          catch { throw invalid('Web source redirected to an unsupported destination'); }
          continue;
        }
        throwIfCancelled();
        return { url: initial.href, finalUrl: url.href, ...response };
      }
      throw invalid('Web source redirect limit exceeded');
    });
  } catch (error) {
    if (deadline.signal.aborted && !parents.some(signal => signal.aborted)) throw unavailable('Web source deadline exceeded');
    throw error;
  } finally { clearTimeout(timer); combined.dispose(); }
}

/** Internal transport seam for loopback TLS tests, not a package-root API or policy bypass option. */
export function requestPinnedWebSource(url: URL, address: Address,
  options: { signal: AbortSignal; maxBytes: number; ca?: string }): Promise<{ location: string } | Omit<WebSource, 'url' | 'finalUrl'>> {
  if (options.signal.aborted) return Promise.reject(cancellationError());
  const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0 });
  return new Promise((resolve, reject) => {
    let settled = false;
    let response: IncomingMessage | undefined;
    const finish = (error?: Error, value?: { location: string } | Omit<WebSource, 'url' | 'finalUrl'>) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', abort);
      response?.destroy(); request.destroy(); agent.destroy();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(cancellationError());
    const request = https.request({
      protocol: 'https:', hostname: hostOf(url), port: Number(url.port || 443), path: `${url.pathname}${url.search}`,
      method: 'GET', agent, family: address.family,
      servername: isIP(hostOf(url)) ? '' : hostOf(url), rejectUnauthorized: true, maxHeaderSize: 16_384,
      ...(options.ca ? { ca: options.ca } : {}),
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: { 'User-Agent': 'MemoBranch-public-source/1', Accept: 'text/plain, text/markdown, text/html, application/xhtml+xml', 'Accept-Encoding': 'identity' },
    }, incoming => {
      response = incoming;
      incoming.once('aborted', () => finish(unavailable('Web source response was interrupted')));
      incoming.once('error', () => finish(unavailable('Unable to read public HTTPS source')));
      if (!sameAddress(request.socket?.remoteAddress, address)) { finish(invalid('Web source peer did not match the validated address')); return; }
      const status = incoming.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = incoming.headers.location;
        if (!location || duplicateHeader(incoming, 'location') || Buffer.byteLength(location) > 4096 || /[\x00-\x20\x7f\\]/.test(location)) {
          finish(invalid('Web source returned an invalid redirect')); return;
        }
        finish(undefined, { location }); return;
      }
      if (status !== 200) { finish(unavailable('Web source must return HTTP 200')); return; }
      const encoding = incoming.headers['content-encoding'];
      if (encoding && encoding.toLowerCase().trim() !== 'identity' || duplicateHeader(incoming, 'content-encoding')) {
        finish(invalid('Compressed web sources are not supported')); return;
      }
      const header = incoming.headers['content-type'];
      const parts = typeof header === 'string' ? header.toLowerCase().split(';').map(part => part.trim()) : [];
      const mediaType = parts[0] ?? '';
      const charsets = parts.slice(1).filter(part => /^charset\s*=/.test(part)).map(part => part.slice(part.indexOf('=') + 1).trim().replace(/^"|"$/g, ''));
      if (!['text/plain', 'text/markdown', 'text/html', 'application/xhtml+xml'].includes(mediaType) || duplicateHeader(incoming, 'content-type') ||
          charsets.some(charset => !['utf-8', 'utf8', 'us-ascii'].includes(charset))) {
        finish(invalid('Web source must be supported UTF-8 text or HTML')); return;
      }
      const length = incoming.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > options.maxBytes)) {
        finish(new AgentMemoryError('CONTENT_TOO_LARGE', 'Web source exceeds its byte limit')); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      incoming.on('data', (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > options.maxBytes) { finish(new AgentMemoryError('CONTENT_TOO_LARGE', 'Web source exceeds its byte limit')); return; }
        chunks.push(chunk);
      });
      incoming.once('end', () => {
        if (settled) return;
        const body = Buffer.concat(chunks);
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body); }
        catch { finish(invalid('Web source is not valid UTF-8')); return; }
        if (!content.trim() || content.includes('\0') || charsets.includes('us-ascii') && body.some(byte => byte > 127)) {
          finish(invalid('Web source must contain nonempty valid text')); return;
        }
        finish(undefined, { mediaType, bytes, sha256: createHash('sha256').update(body).digest('hex'), content });
      });
    });
    request.on('socket', socket => socket.once('secureConnect', () => {
      if (!sameAddress(socket.remoteAddress, address)) finish(invalid('Web source peer did not match the validated address'));
    }));
    request.once('error', () => finish(options.signal.aborted ? cancellationError() : unavailable('Unable to read public HTTPS source')));
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort(); else request.end();
  });
}

function duplicateHeader(response: IncomingMessage, name: string): boolean {
  return response.rawHeaders.filter((_value, index) => index % 2 === 0 && response.rawHeaders[index]!.toLowerCase() === name).length > 1;
}

function sameAddress(peer: string | undefined, selected: Address): boolean {
  if (!peer || !isIP(peer)) return false;
  const addresses = new BlockList();
  addresses.addAddress(selected.address, selected.family === 4 ? 'ipv4' : 'ipv6');
  return addresses.check(peer, isIP(peer) === 4 ? 'ipv4' : 'ipv6');
}

function hostOf(url: URL): string { return url.hostname.replace(/^\[|\]$/g, ''); }
function invalid(message: string) { return new AgentMemoryError('VALIDATION_FAILED', message); }
function unavailable(message: string) { return new AgentMemoryError('DEPENDENCY_UNAVAILABLE', message); }
