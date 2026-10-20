import assert from 'node:assert/strict';
import { Resolver } from 'node:dns/promises';
import { EventEmitter, getEventListeners } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https, { type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage, RequestListener } from 'node:http';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { fetchPublicWebSource, isPublicWebAddress, publicWebUrl, requestPinnedWebSource, resolvePublicWebAddress } from '../src/web-source.js';

test('public web policy: private/special/tunnel addresses and ambiguous URL forms are rejected', () => {
  for (const address of ['0.0.0.0', '10.2.3.4', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.31.1.1', '192.168.1.2',
    '192.0.0.9', '192.0.2.1', '192.88.99.2', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:8.8.8.8', '64:ff9b::808:808', 'fc00::1', 'fe80::1', '2001::1', '2001:db8::1', '2002:808:808::1',
    '3ffe::1', '3fff::1', '5f00::1', 'ff02::1', '8.8.8.8%eth0', '127.1', 'not-an-ip']) assert.equal(isPublicWebAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicWebAddress(address), true, address);
  for (const url of ['http://docs.example/', 'file:///etc/passwd', 'https://user:password@docs.example/', 'https://docs.example:444/',
    'https://localhost/', 'https://a.localhost/', 'https://a.local/', 'https://a.internal/', 'https://a.home.arpa/', 'https://singlelabel/',
    'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/', 'https://[::1]/',
    'https://[::ffff:127.0.0.1]/', 'https://docs.example/\nsecret', 'https://docs.example\\@127.0.0.1/']) assert.throws(() => publicWebUrl(url), url);
  assert.equal(publicWebUrl('https://Docs.Example.:443/path#anchor').href, 'https://docs.example/path');
  assert.throws(() => publicWebUrl(`https://docs.example/${'文'.repeat(1000)}`), /Normalized/);
});

function publicDns(t: TestContext, address = '8.8.8.8') {
  let v4 = [address];
  let v6: string[] = [];
  t.mock.method(Resolver.prototype, 'resolve4', async () => v4);
  t.mock.method(Resolver.prototype, 'resolve6', async () => { if (!v6.length) throw Object.assign(new Error('no IPv6'), { code: 'ENODATA' }); return v6; });
  return { setV4: (values: string[]) => { v4 = values; }, setV6: (values: string[]) => { v6 = values; } };
}

test('public web DNS: every answer is checked, including mixed and IPv6 answers', async t => {
  const dns = publicDns(t);
  assert.deepEqual(await resolvePublicWebAddress('docs.example', new AbortController().signal), { address: '8.8.8.8', family: 4 });
  dns.setV4(['8.8.8.8', '127.0.0.1']);
  await assert.rejects(resolvePublicWebAddress('docs.example', new AbortController().signal), /exclusively/);
  dns.setV4(['8.8.8.8']);
  dns.setV6(['::1']);
  await assert.rejects(resolvePublicWebAddress('docs.example', new AbortController().signal), /exclusively/);
});

test('public web DNS: deadline and cancellation stop owned resolution and release listeners', async t => {
  let rejects: Array<(error: Error) => void> = [];
  const pending = () => new Promise<never>((_resolve, reject) => { rejects.push(reject); });
  t.mock.method(Resolver.prototype, 'resolve4', pending);
  t.mock.method(Resolver.prototype, 'resolve6', pending);
  t.mock.method(Resolver.prototype, 'cancel', () => {
    const current = rejects; rejects = [];
    for (const reject of current) reject(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }));
  });
  const controller = new AbortController();
  const reading = fetchPublicWebSource('https://docs.example/', { signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, { code: 'OPERATION_CANCELLED' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await assert.rejects(fetchPublicWebSource('https://docs.example/', { timeoutMs: 20 }), /deadline/);
});

/** In-memory HTTP/TLS metadata fixture; actual TLS is tested separately below. */
function fakeTransport(t: TestContext, route: (path: string) => { status: number; headers?: Record<string, string>; body?: string; peer?: string }) {
  const calls: RequestOptions[] = [];
  t.mock.method(https, 'request', ((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    calls.push(options);
    const request = new EventEmitter() as ClientRequest;
    let destroyed = false;
    request.destroy = () => { destroyed = true; return request; };
    request.end = (() => {
      queueMicrotask(() => {
        const item = route(String(options.path));
        const socket = new EventEmitter() as EventEmitter & { remoteAddress: string };
        socket.remoteAddress = item.peer ?? '8.8.8.8';
        Object.defineProperty(request, 'socket', { value: socket });
        request.emit('socket', socket); socket.emit('secureConnect');
        if (destroyed) return;
        const stream = new PassThrough();
        const response = stream as unknown as IncomingMessage;
        response.statusCode = item.status;
        response.headers = item.headers ?? { 'content-type': 'text/plain' };
        response.rawHeaders = Object.entries(response.headers).flatMap(([key, value]) => [key, String(value)]);
        callback(response);
        if (!destroyed) stream.end(item.body ?? 'fixture');
      });
      return request;
    }) as ClientRequest['end'];
    return request;
  }) as typeof https.request);
  return calls;
}

test('public web reads: redirects are revalidated, address is pinned and ambient credentials are absent', async t => {
  publicDns(t);
  const calls = fakeTransport(t, path => path === '/start' ? { status: 302, headers: { location: '/final' } } : { status: 200, body: '\ufeff 原始中文 <script>untrusted()</script>\n' });
  const result = await fetchPublicWebSource('https://docs.example/start');
  assert.equal(result.url, 'https://docs.example/start'); assert.equal(result.finalUrl, 'https://docs.example/final');
  assert.equal(result.content, '\ufeff 原始中文 <script>untrusted()</script>\n');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.rejectUnauthorized, true);
  assert.equal(calls[0]!.servername, 'docs.example');
  const headers = calls[0]!.headers as Record<string, string>;
  assert.equal(headers['Accept-Encoding'], 'identity');
  assert.ok(!Object.keys(headers).some(key => /cookie|authorization|referer/i.test(key)));
  let address: unknown;
  calls[0]!.lookup!('docs.example', {}, (error, value) => { assert.equal(error, null); address = value; });
  assert.equal(address, '8.8.8.8');
});

test('public web reads: private/downgraded/loop redirects and mismatched peer never become sources', async t => {
  publicDns(t);
  let location = 'https://127.0.0.1/';
  let mismatch = false;
  const calls = fakeTransport(t, () => mismatch ? { status: 200, peer: '127.0.0.1' } : { status: 302, headers: { location } });
  for (const target of ['https://127.0.0.1/', 'http://docs.example/', 'https://docs.example:444/']) {
    location = target;
    const before = calls.length;
    await assert.rejects(fetchPublicWebSource('https://docs.example/'), { code: 'VALIDATION_FAILED' });
    assert.equal(calls.length, before + 1);
  }
  location = '/loop';
  const before = calls.length;
  await assert.rejects(fetchPublicWebSource('https://docs.example/'), /redirect limit/);
  assert.equal(calls.length, before + 4);
  mismatch = true;
  await assert.rejects(fetchPublicWebSource('https://docs.example/'), /peer/);
});

async function tlsFixture(t: TestContext) {
  const scratch = join(process.cwd(), '.scratch'); await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'web-tls-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = join(root, 'key.pem'), cert = join(root, 'cert.pem'), config = join(root, 'openssl.cnf');
  await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:TRUE\n');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-config', config], { timeout: 15_000 });
  let handler: RequestListener = (_request, response) => { response.setHeader('Content-Type', 'text/plain'); response.end('source'); };
  let requests = 0;
  const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => { requests++; response.on('error', () => {}); handler(request, response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { url: new URL(`https://localhost:${address.port}/source`), ca: await readFile(cert, 'utf8'), count: () => requests, set: (next: RequestListener) => { handler = next; } };
}

test('real pinned HTTPS transport: TLS verification, exact UTF-8 and bounded failure paths', async t => {
  const fixture = await tlsFixture(t);
  const read = (options: { maxBytes?: number; ca?: string; signal?: AbortSignal } = {}) => requestPinnedWebSource(fixture.url, { address: '127.0.0.1', family: 4 },
    { signal: options.signal ?? new AbortController().signal, maxBytes: options.maxBytes ?? 1000, ...(options.ca === undefined ? {} : { ca: options.ca }) });
  await t.test('untrusted certificate is refused', async () => { await assert.rejects(read(), { code: 'DEPENDENCY_UNAVAILABLE' }); });
  await t.test('trusted fixture keeps original UTF-8 including BOM and whitespace', async () => {
    fixture.set((request, response) => {
      assert.equal(request.headers.host, `localhost:${fixture.url.port}`); assert.equal(request.headers.cookie, undefined);
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('\ufeff  <p>原始</p>\n');
    });
    const result = await read({ ca: fixture.ca }); assert.ok('content' in result);
    assert.equal(result.content, '\ufeff  <p>原始</p>\n'); assert.equal(result.bytes, Buffer.byteLength(result.content));
  });
  await t.test('wrong hostname is refused even with a trusted test CA', async () => {
    const wrong = new URL(fixture.url); wrong.hostname = 'wrong.example';
    await assert.rejects(requestPinnedWebSource(wrong, { address: '127.0.0.1', family: 4 }, { signal: new AbortController().signal, maxBytes: 1000, ca: fixture.ca }), { code: 'DEPENDENCY_UNAVAILABLE' });
  });
  await t.test('declared and streaming sizes are bounded', async () => {
    fixture.set((_request, response) => { response.setHeader('Content-Type', 'text/plain'); response.setHeader('Content-Length', '1001'); response.end('source'); });
    await assert.rejects(read({ ca: fixture.ca }), { code: 'CONTENT_TOO_LARGE' });
    fixture.set((_request, response) => { response.setHeader('Content-Type', 'text/plain'); response.write('x'.repeat(600)); response.end('x'.repeat(600)); });
    await assert.rejects(read({ ca: fixture.ca }), { code: 'CONTENT_TOO_LARGE' });
  });
  await t.test('unsupported encoding, type, charset and malformed/empty text are refused', async () => {
    for (const [type, encoding, body] of [
      ['application/pdf', '', Buffer.from('binary')], ['text/plain', 'gzip', Buffer.from('compressed')],
      ['text/plain; charset=iso-8859-1', '', Buffer.from('legacy')], ['text/plain', '', Buffer.from([0xff])],
      ['text/plain', '', Buffer.from('x\0y')], ['text/plain', '', Buffer.from('   ')],
    ] as const) {
      fixture.set((_request, response) => { response.setHeader('Content-Type', type); if (encoding) response.setHeader('Content-Encoding', encoding); response.end(body); });
      await assert.rejects(read({ ca: fixture.ca }), { code: 'VALIDATION_FAILED' });
    }
  });
  await t.test('headers and cancellation are bounded, with listener cleanup', async () => {
    fixture.set((_request, response) => { response.setHeader('Content-Type', 'text/plain'); response.setHeader('X-Padding', 'x'.repeat(20_000)); response.end('source'); });
    await assert.rejects(read({ ca: fixture.ca }), { code: 'DEPENDENCY_UNAVAILABLE' });
    let reached!: () => void; const started = new Promise<void>(resolve => { reached = resolve; });
    fixture.set((_request, response) => { response.setHeader('Content-Type', 'text/plain'); response.flushHeaders(); reached(); });
    const controller = new AbortController();
    const pending = read({ ca: fixture.ca, signal: controller.signal }); await started; controller.abort();
    await assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
  assert.ok(fixture.count() >= 11, 'Transport assertions must reach the real TLS fixture, not a leaked mock');
});
