// Consumer-only smoke. Real TLS stays on loopback; source orchestration uses an
// internal fixture reader. This is not a public-internet end-to-end test.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { getEventListeners } from 'node:events';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as api from 'memobranch';

const exec = promisify(execFile);
const dist = dirname(fileURLToPath(import.meta.resolve('memobranch')));
const { requestPinnedWebSource } = await import(pathToFileURL(join(dist, 'web-source.js')).href);
const { createWebImportWorkflow } = await import(pathToFileURL(join(dist, 'web-import.js')).href);
for (const name of ['previewWebImport', 'applyWebImport', 'readWebImportPlan', 'serializeWebImportPlan']) assert.equal(typeof api[name], 'function');
for (const name of ['requestPinnedWebSource', 'createWebImportWorkflow', 'fetchPublicWebSource']) assert.equal(name in api, false);

const tlsRoot = join(process.cwd(), 'web-import-tls'); await mkdir(tlsRoot);
const key = join(tlsRoot, 'key.pem'), cert = join(tlsRoot, 'cert.pem'), config = join(tlsRoot, 'openssl.cnf');
await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:TRUE\n');
await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', config], { timeout: 15_000 });
const original = '\ufeff  <p>原始 evidence</p>\r\n';
let requests = 0;
let handler = (_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(original); };
const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
  requests++; response.on('error', () => {}); handler(request, response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = new URL(`https://localhost:${port}/source`), ca = await readFile(cert, 'utf8');
const read = (options = {}) => requestPinnedWebSource(url, { address: '127.0.0.1', family: 4 },
  { signal: new AbortController().signal, maxBytes: 1000, ...options });
try {
  await assert.rejects(read(), { code: 'DEPENDENCY_UNAVAILABLE' });
  const actual = await read({ ca });
  assert.equal(actual.content, original);
  assert.equal(actual.bytes, Buffer.byteLength(original));
  assert.equal(actual.sha256, createHash('sha256').update(original).digest('hex'));
  const wrong = new URL(url); wrong.hostname = 'wrong.example';
  await assert.rejects(requestPinnedWebSource(wrong, { address: '127.0.0.1', family: 4 },
    { signal: new AbortController().signal, maxBytes: 1000, ca }), { code: 'DEPENDENCY_UNAVAILABLE' });
  handler = (_request, response) => { response.setHeader('Content-Type', 'text/plain'); response.end('x'.repeat(1001)); };
  await assert.rejects(read({ ca }), { code: 'CONTENT_TOO_LARGE' });
  let reached; const started = new Promise(resolve => { reached = resolve; });
  handler = (_request, response) => { response.setHeader('Content-Type', 'text/plain'); response.flushHeaders(); reached(); };
  const stop = new AbortController();
  const pending = read({ ca, signal: stop.signal }); await started; stop.abort();
  await assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  assert.ok(requests >= 3, 'must reach real TLS fixture');
} finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }

await assert.rejects(api.previewWebImport(['https://127.0.0.1/']), { code: 'VALIDATION_FAILED' });
await assert.rejects(api.previewWebImport(['https://168.63.129.16/']), { code: 'VALIDATION_FAILED' });
// Exercise the installed owned Resolver API without sending DNS packets.
const original4 = Resolver.prototype.resolve4, original6 = Resolver.prototype.resolve6;
try {
  Resolver.prototype.resolve4 = async () => ['127.0.0.1'];
  Resolver.prototype.resolve6 = async () => { throw Object.assign(new Error('absent'), { code: 'ENODATA' }); };
  await assert.rejects(api.previewWebImport(['https://docs.example/']), /exclusively/);
} finally { Resolver.prototype.resolve4 = original4; Resolver.prototype.resolve6 = original6; }

const vault = new api.MemoryVault(join(process.cwd(), 'web-import-vault'));
await vault.initialize('installed public web imports');
let content = original, reads = 0;
const workflow = createWebImportWorkflow(async address => {
  reads++;
  return { url: address, finalUrl: address, mediaType: 'text/html', content,
    bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
});
const sourceUri = 'https://docs.example/guide';
const plan = await workflow.preview([sourceUri]);
assert.ok(!JSON.stringify(plan).includes(original));
const planPath = join(process.cwd(), 'web-import-plan.json');
await writeFile(planPath, api.serializeWebImportPlan(plan));
assert.deepEqual(await api.readWebImportPlan(planPath), plan);
content = 'changed';
await assert.rejects(workflow.apply(vault, plan), /sources changed/);
assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 0);
content = original;
const imported = await workflow.apply(vault, plan);
assert.equal(imported.status, 'completed');
const evidence = await vault.get(imported.entries[0].result.evidenceId);
const envelope = JSON.parse(evidence.body.slice(evidence.body.indexOf('\n\n') + 2));
assert.equal(envelope.content, original); assert.equal(envelope.sha256, plan.documents[0].sha256);
assert.equal((await vault.wikiCatalog()).length, 0);
assert.equal((await vault.listRecords({ collection: 'candidates' })).total, 0);
assert.equal((await workflow.apply(vault, plan)).entries[0].result.duplicate, true);
assert.equal((await vault.sourceTimeline(sourceUri)).total, 1);
const readonly = new api.MemoryVault(vault.root, { principal: { ...(await import(pathToFileURL(join(dist, 'policy.js')).href)).localAdminPrincipal(), permissions: ['read'] } });
const before = reads;
await assert.rejects(workflow.apply(readonly, plan), { code: 'AUTHORIZATION_DENIED' });
assert.equal(reads, before);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(api.applyWebImport(vault, plan, { signal: cancelled.signal }), { code: 'OPERATION_CANCELLED' });

const absent = join(process.cwd(), 'absent-web-vault');
const env = { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' };
await assert.rejects(exec(process.execPath, [join(dist, 'cli.js'), 'import', 'web-preview', 'https://127.0.0.1/', '--root', absent], { env, timeout: 20_000 }),
  error => /VALIDATION_FAILED/.test(error.stderr));
await assert.rejects(stat(absent), { code: 'ENOENT' });
Object.assign(env, { AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read',
  AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: 'internal' });
await assert.rejects(exec(process.execPath, [join(dist, 'cli.js'), 'import', 'web-apply', '--plan', planPath, '--root', vault.root], { env, timeout: 20_000 }),
  error => /AUTHORIZATION_DENIED/.test(error.stderr));
console.log('Installed package: public web exports/types, real loopback TLS, synthetic import/drift/idempotency, owned DNS refusal, CLI authority and cancellation passed (no public Internet E2E).');
