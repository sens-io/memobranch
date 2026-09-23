import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Script, createContext, runInContext } from 'node:vm';
import { test, type TestContext } from 'node:test';
import { LlmClient } from '../src/llm.js';
import { MemoryVault } from '../src/vault.js';
import { startWebServer, type WebHandle } from '../src/web.js';
import { webScript } from '../src/web-ui.js';
import type { Principal } from '../src/policy.js';
import { operationSignal } from '../src/operation.js';
import { defaultVaultConfig } from '../src/config.js';
import { publicSettings } from '../src/settings.js';

async function fixture(t: TestContext, llm = new LlmClient({ apiKey: '', embeddingModel: '' })) {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-web-'));
  const masterKey = '48'.repeat(32);
  const vault = new MemoryVault(root, { llm, masterKey });
  await vault.initialize('web-test');
  const handles: WebHandle[] = [];
  t.after(async () => { await Promise.all(handles.map(handle => handle.stop())); await rm(root, { recursive: true, force: true }); });
  async function start(principal?: Principal) {
    const handle = await startWebServer(root, { llm, masterKey, ...(principal ? { principal } : {}) });
    handles.push(handle);
    return handle;
  }
  return { root, vault, start };
}

async function call(handle: WebHandle, operation: string, input: unknown = {}, headers: Record<string, string> = {}) {
  const response = await fetch(`${handle.url}/api/${operation}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: handle.url, Authorization: `Bearer ${handle.token}`, ...headers,
  }, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() as { result: any; error?: { code: string; message: string } } };
}

test('web: static assets are offline, bounded by CSP, and contain no token or vault data', async t => {
  const { start } = await fixture(t);
  const handle = await start();
  const html = await fetch(handle.url);
  assert.match(html.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(html.headers.get('content-security-policy')!, /script-src 'self'/);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  const markup = await html.text();
  assert.doesNotMatch(markup, new RegExp(handle.token));
  assert.doesNotMatch(markup, /web-test/);
  assert.match(markup, /app.js/);
  assert.equal((await fetch(`${handle.url}/app.js`)).status, 200);
  assert.equal((await fetch(`${handle.url}/style.css`)).status, 200);
  assert.equal((await fetch(`${handle.url}/agent-memory.json`)).status, 404);
  assert.equal((await fetch(`${handle.url}/?token=${handle.token}`)).status, 404);
  new Script(webScript);
  assert.doesNotMatch(webScript, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|eval\(/);
});

test('web: missing/wrong token, cross-site and forged host are rejected without writes', async t => {
  const { vault, start } = await fixture(t);
  const handle = await start();
  const before = await vault.git.run(['rev-parse', 'HEAD']);
  for (const headers of [{ Authorization: '' }, { Authorization: 'Bearer invalid' }, { Origin: 'https://evil.example' }, { Origin: '' }]) {
    assert.equal((await call(handle, 'capture', { content: 'blocked', scope: 'user', sensitivity: 'internal' }, headers)).status, 403);
  }
  // Node's fetch may normalize Host; use a real HTTP request to send a forged authority.
  const forged = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${handle.url}/api/session`, { method: 'POST', headers: { Host: 'evil.example', Origin: handle.url, Authorization: `Bearer ${handle.token}`, 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(forged, 403);
  assert.equal((await call(handle, 'session', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call(handle, '__proto__')).status, 404);
  assert.equal((await call(handle, 'constructor')).status, 404);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
});

test('web: capture, paginated browse, detail, proposal, approval and revocation persist through core APIs', async t => {
  const { vault, start } = await fixture(t);
  const handle = await start();
  const content = '<script>globalThis.exfiltrate()</script> 用中文简洁回答';
  const capture = await call(handle, 'capture', { content, scope: 'user', sensitivity: 'internal' });
  assert.equal(capture.status, 200);
  const { evidenceId, evidencePath } = capture.body.result;
  const listing = await call(handle, 'records', { collection: 'evidence', limit: 1 });
  assert.equal(listing.body.result.total, 1);
  assert.equal(listing.body.result.items[0].id, evidenceId);
  assert.match((await call(handle, 'get', { id: evidenceId })).body.result.body, /<script>/);
  assert.equal((await call(handle, 'records', { collection: 'evidence', offset: 1 })).body.result.items.length, 0);
  const proposed = await call(handle, 'propose', { key: '回答风格', statement: '用中文简洁回答', kind: 'preference', scope: 'user', sensitivity: 'internal', confidence: 0.95, explicit: true, evidence: [evidencePath] });
  assert.equal(proposed.status, 200);
  const candidate = proposed.body.result.id;
  assert.equal((await call(handle, 'approve', { id: candidate })).status, 400, 'confirmation is mandatory');
  const approved = await call(handle, 'approve', { id: candidate, confirm: true });
  assert.equal(approved.status, 200);
  assert.equal((await call(handle, 'records', { collection: 'memories', query: '中文', status: 'active' })).body.result.total, 1);
  assert.equal((await call(handle, 'forget', { id: approved.body.result.memoryId, reason: '偏好变更', confirm: true })).status, 200);
  assert.equal((await vault.get(approved.body.result.memoryId)).meta.status, 'revoked');
  assert.equal((await vault.get(evidenceId)).body.includes(content), true);
  assert.equal((await vault.doctor()).healthy, true);
});

test('web: scope and sensitivity filtered before disclosure; requests cannot impersonate or change tenant', async t => {
  const { vault, start } = await fixture(t);
  const allowed = await vault.capture({ content: 'allowed', scope: 'user', sensitivity: 'internal' });
  const hidden = await vault.capture({ content: 'hidden-team', scope: 'team', sensitivity: 'internal' });
  await vault.capture({ content: 'hidden-secret', scope: 'user', sensitivity: 'secret' });
  const principal: Principal = { id: 'reader', name: 'Reader', permissions: ['read'], scopes: ['user'], maxSensitivity: 'internal', tenantId: (await vault.config()).tenantId };
  const handle = await start(principal);
  const listing = await call(handle, 'records', { collection: 'evidence' });
  assert.equal(listing.body.result.total, 1);
  assert.equal(listing.body.result.items[0].id, allowed.evidenceId);
  assert.doesNotMatch(JSON.stringify(listing), /hidden-team|hidden-secret/);
  assert.notEqual((await call(handle, 'get', { id: hidden.evidenceId })).status, 200);
  for (const operation of ['capture', 'approve', 'recover', 'sync', 'settings-save', 'rules-save', 'apply', 'ingest', 'file']) {
    assert.equal((await call(handle, operation, {})).status, 403, operation);
  }
  assert.equal((await call(handle, 'records', { collection: 'evidence', principal: { permissions: ['admin'] } })).status, 400);
  await assert.rejects(start({ ...principal, tenantId: 'different-tenant' }), /not authorized/);
});

test('web: settings are allowlisted, transactional, optimistic and do not expose transport credentials', async t => {
  const { vault, start } = await fixture(t);
  const handle = await start();
  const original = await vault.config();
  const current = (await call(handle, 'settings')).body.result;
  assert.equal(current.values.policy, undefined);
  assert.equal(current.values.tenantId, undefined);
  assert.equal(current.values.remote, undefined);
  const result = await call(handle, 'settings-save', { ...current, values: { ...current.values, name: 'Updated', minimumConfidence: 0.9 }, confirm: true });
  assert.equal(result.status, 200);
  assert.ok(result.body.result.commit);
  assert.equal((await vault.config()).name, 'Updated');
  const before = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await call(handle, 'settings-save', { ...current, confirm: true })).status, 400);
  assert.equal((await call(handle, 'settings-save', { values: { ...result.body.result.values, tenantId: 'injected' }, revision: result.body.result.revision, confirm: true })).status, 400);
  assert.equal((await call(handle, 'settings-save', { values: { ...result.body.result.values, minimumConfidence: 2 }, revision: result.body.result.revision, confirm: true })).status, 400);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
  assert.deepEqual((await vault.config()).policy, original.policy);
  assert.equal((await vault.config()).tenantId, original.tenantId);
  assert.equal((await vault.doctor()).healthy, true);
});

test('web: concurrent setting saves cannot silently overwrite each other', async t => {
  const { vault, start } = await fixture(t);
  const handle = await start();
  const current = (await call(handle, 'settings')).body.result;
  const responses = await Promise.all(['First', 'Second'].map(name => call(handle, 'settings-save', { ...current, values: { ...current.values, name }, confirm: true })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  assert.equal((await vault.config()).name, responses.find(r => r.status === 200)!.body.result.values.name);
});

class WikiFixture extends LlmClient {
  constructor() { super({ apiKey: 'fixture', model: 'web-test', embeddingModel: '' }); }
  override async wiki<T>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    const data = input as any;
    if (operation === 'navigate') return { keys: data.catalog.map((item: any) => item.key) } as T;
    if (operation === 'query') return { answer: 'A source-grounded answer', citations: data.pages.map((item: any) => item.key), uncertainty: [] } as T;
    if (operation === 'lint') return { suggestions: [] } as T;
    return { pages: data.sources.map((source: any) => ({ key: `source:${source.id}`, pageType: 'source', title: 'Source summary', summary: 'A documented source', body: '# Summary\n\nSource-grounded information.', evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] })) } as T;
  }
}

test('web: Wiki plan/apply/query/file/lint/rules preserve explicit writes and evidence', async t => {
  const { vault, start, root } = await fixture(t, new WikiFixture());
  const handle = await start();
  const source = await vault.capture({ content: 'A source-grounded fact.', scope: 'public', sensitivity: 'public' });
  const raw = await readFile(join(root, source.evidencePath), 'utf8');
  const before = await vault.git.run(['rev-parse', 'HEAD']);
  const plan = (await call(handle, 'ingest', { evidenceIds: [source.evidenceId] })).body.result.plan;
  assert.ok(plan);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
  assert.equal((await call(handle, 'apply', { plan, confirm: true })).status, 200);
  assert.equal((await call(handle, 'catalog')).body.result.length, 1);
  const committed = await vault.git.run(['rev-parse', 'HEAD']);
  const answer = await call(handle, 'query', { question: 'What is documented?' });
  assert.equal(answer.status, 200);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), committed);
  const filing = await call(handle, 'file', { result: answer.body.result, title: 'Saved answer', pageType: 'query' });
  assert.equal(filing.status, 200);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), committed);
  assert.equal((await call(handle, 'apply', { plan: filing.body.result.plan, confirm: true })).status, 200);
  assert.equal((await call(handle, 'catalog')).body.result.length, 2);
  const lint = await call(handle, 'lint', { semantic: false });
  assert.equal(lint.status, 200);
  assert.equal(lint.body.result.semantic, 'not-requested');
  const rule = { purpose: 'Maintain source-grounded knowledge', instructions: 'Keep uncertainty explicit.', scope: 'public', sensitivity: 'public', expectedRevision: 0, confirm: true };
  assert.equal((await call(handle, 'rules-save', rule)).status, 200);
  assert.equal((await call(handle, 'rules-save', rule)).status, 400);
  assert.equal(await readFile(join(root, source.evidencePath), 'utf8'), raw);
});

test('web: malformed/oversized payload and invalid fields do not mutate the vault', async t => {
  const { vault, start } = await fixture(t);
  const handle = await start();
  const before = await vault.git.run(['rev-parse', 'HEAD']);
  assert.equal((await call(handle, 'capture', { content: 'x'.repeat(1_048_577), scope: 'user', sensitivity: 'internal' })).status, 413);
  assert.equal((await call(handle, 'records', { collection: '../', limit: -1 })).status, 400);
  assert.equal((await call(handle, 'capture', { content: 'x', scope: 'user', sensitivity: 'internal', actor: { id: 'forged' } })).status, 400);
  const invalid = await fetch(`${handle.url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handle.token}`, Origin: handle.url }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
});

test('web: shutdown handles an incomplete request body promptly and rotates tokens', async t => {
  const { start } = await fixture(t);
  const handle = await start();
  const req = request(`${handle.url}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handle.token}`, Origin: handle.url, 'Content-Length': '1000' } });
  req.on('error', () => {});
  const connected = new Promise<void>(resolve => req.on('socket', socket => socket.once('connect', resolve)));
  req.write('{');
  await connected;
  await handle.stop();
  req.destroy();
  await handle.stop();
  const next = await start();
  assert.notEqual(next.token, handle.token);
  assert.equal((await call(next, 'session', {}, { Authorization: `Bearer ${handle.token}` })).status, 403);
});

test('web: shutdown cancels provider work and awaits cleanup', async t => {
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  let cancelled = false;
  class SlowFixture extends WikiFixture {
    override async wiki<T>(): Promise<T> {
      entered();
      return new Promise<T>((_resolve, reject) => {
        operationSignal()!.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); }, { once: true });
      });
    }
  }
  const { vault, start } = await fixture(t, new SlowFixture());
  const handle = await start();
  const source = await vault.capture({ content: 'Cancellation source.', scope: 'public', sensitivity: 'public' });
  const before = await vault.git.run(['rev-parse', 'HEAD']);
  const pending = call(handle, 'ingest', { evidenceIds: [source.evidenceId] }).catch(() => null);
  await enteredPromise;
  await handle.stop();
  await pending;
  assert.equal(cancelled, true);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), before);
});

test('web: rejects invalid listening ports before binding', async t => {
  const { root } = await fixture(t);
  for (const port of [-1, 65536, 1.2, NaN]) await assert.rejects(startWebServer(root, { port }), /port/);
});

test('web UI: configured embedding model remains optional so it can be cleared to default', async () => {
  // Exercise the actual UI builder without network: native-browser rendering is checked separately.
  class Element {
    children: Element[] = [];
    name = '';
    required = false;
    value = '';
    classList = { add() {} };
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    addEventListener() {}
    setAttribute() {}
    focus() {}
  }
  const values = publicSettings(defaultVaultConfig('UI fixture', 'test'));
  values.index.embeddingModel = 'configured-embedding-model';
  const context = createContext({ document: {
    getElementById: () => new Element(), createElement: () => new Element(),
  }, setTimeout, clearTimeout, fixture: { values, revision: 'a'.repeat(64) } });
  runInContext(webScript, context);
  runInContext("principal = {permissions:['admin'],scopes:['user'],maxSensitivity:'internal'}; api = async op => op === 'settings' ? fixture : [];", context);
  const output = await runInContext('settings()', context) as Element;
  const nodes = (node: Element): Element[] => [node, ...node.children.flatMap(nodes)];
  const input = nodes(output).find(node => node?.name === 'index.embeddingModel');
  assert.ok(input);
  assert.equal(input.value, 'configured-embedding-model');
  assert.equal(input.required, false);
});
