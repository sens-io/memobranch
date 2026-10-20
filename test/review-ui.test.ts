import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { webScript } from '../src/web-ui.js';

type Listener = (event: { preventDefault(): void; stopPropagation(): void }) => unknown;

/** A small DOM that runs the shipped event handlers and real fetch wrapper. */
class Element {
  children: Element[] = [];
  parent: Element | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  className = '';
  name = '';
  type = '';
  value = '';
  disabled = false;
  required = false;
  checked = false;
  open = false;
  root = false;
  ownText = '';
  dataset: Record<string, string> = {};
  classList = { add: (...names: string[]) => { this.className = [this.className, ...names].filter(Boolean).join(' '); } };
  constructor(readonly tagName: string) {}
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.ownText = String(value); this.children.forEach(child => { child.parent = null; }); this.children = []; }
  get isConnected(): boolean { return this.root || Boolean(this.parent?.isConnected); }
  append(...children: Element[]) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  replaceChildren(...children: Element[]) { this.textContent = ''; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]); }
  async fire(type: string) { if (type === 'click' && this.disabled) return; for (const listener of this.listeners.get(type) ?? []) await listener({ preventDefault() {}, stopPropagation() {} }); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): Element[] { return nodes(this).slice(1).filter(node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector); }
  closest(selector: string): Element | null { return this.tagName === selector ? this : this.parent?.closest(selector) ?? null; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; for (const listener of this.listeners.get('close') ?? []) listener({ preventDefault() {}, stopPropagation() {} }); }
}

const nodes = (node: Element): Element[] => [node, ...node.children.flatMap(nodes)];
function find(node: Element, predicate: (value: Element) => boolean): Element {
  const result = nodes(node).find(predicate);
  assert.ok(result, 'expected UI element');
  return result;
}
const named = (node: Element, name: string) => find(node, item => item.name === name);
const button = (node: Element, label: string) => find(node, item => item.tagName === 'button' && item.textContent === label);
const success = (result: unknown) => ({ ok: true, json: async () => ({ result }) });
const failure = (code: string) => ({ ok: false, json: async () => ({ error: { code } }) });
type Response = ReturnType<typeof success> | ReturnType<typeof failure>;
type Request = { operation: string; data: any; headers: Record<string, string> };

function harness(route: (request: Request) => Response | Promise<Response>, permissions = ['admin']) {
  const body = new Element('body'); body.root = true;
  const app = new Element('div'), notice = new Element('div'); body.append(app, notice);
  const requests: Request[] = [];
  const context = createContext({
    document: { body, getElementById: (id: string) => id === 'app' ? app : notice,
      createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => { const node = new Element('#text'); node.textContent = text; return node; },
      querySelectorAll: (selector: string) => body.querySelectorAll(selector) },
    setTimeout: () => 0, clearTimeout() {}, AbortController,
    confirmResult: true, confirm: () => Boolean(context.confirmResult),
    fetch: async (url: string, init: { body: string; headers: Record<string, string> }) => {
      const request = { operation: url.replace('/api/', ''), data: JSON.parse(init.body), headers: init.headers };
      requests.push(request); return route(request);
    },
  });
  runInContext(webScript, context);
  context.userPermissions = permissions;
  runInContext("principal={permissions:userPermissions,scopes:['user'],maxSensitivity:'internal'}; token='fixture-token'; navigate=async()=>{};", context);
  return { body, app, context, requests, run: (code: string) => runInContext(code, context) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const plan = { kind: 'repair', proof: 'original-signed-proof', sourceIds: ['ev-123456789abc'],
  pages: [{ key: 'return-policy', title: '退货政策', pageType: 'concept', body: 'Draft only', evidenceIds: ['ev-123456789abc'] }] };
const before = { revision: 2, body: '旧政策\n原有内容', status: 'active', scope: 'user', sensitivity: 'internal',
  evidence: ['evidence/2026/10/20/source-ev-123456789abc.md'], conditions: ['旧适用条件'], uncertainty: ['旧待核查事项'] };
const after = { ...before, revision: 3, body: '新政策\n<script>untrusted()</script>', status: 'conflicted',
  conditions: ['仅限线上订单'], uncertainty: ['需核实生效日期'] };
const preview = { kind: 'repair', pages: [{ key: 'return-policy', title: '退货政策', pageType: 'concept', operation: 'update', before, after,
  diff: { added: 2, removed: 2, truncated: true, lines: [{ kind: 'removed', text: '旧政策' }, { kind: 'added', text: '新政策' }, { kind: 'omitted', text: '其余内容' }] } }],
  affectedPageKeys: ['return-policy', 'shopping-guide'] };
const wikiDocument = { path: 'wiki/concept/return-policy.md', meta: { id: 'wiki-return-policy', type: 'wiki-page', key: 'return-policy', title: '退货政策',
  revision: 3, status: 'active', scope: 'user', sensitivity: 'internal', evidence: before.evidence, conditions: after.conditions, uncertainty: after.uncertainty }, body: after.body };

test('review UI: validated canonical comparison gates approval and applies the original signed plan', async () => {
  const pending = deferred<Response>();
  const ui = harness(request => request.operation === 'preview' ? pending.promise : success({ commit: 'abcdef123456' }));
  const target = new Element('div'); ui.body.append(target);
  Object.assign(ui.context, { target, fixture: { plan } });
  const loading = ui.run('showPlan(target,fixture)') as Promise<void>;
  assert.match(target.textContent, /正在校验签名、权限与页面版本/);
  assert.equal(find(target, node => node.className.includes('loading')).getAttribute('role'), 'status');
  assert.equal(nodes(target).some(node => node.textContent === '批准并应用此计划'), false);
  assert.deepEqual(ui.requests[0]?.data, { plan });
  pending.resolve(success(preview)); await loading;
  assert.match(target.textContent, /修改前.*版本 v2.*旧政策/s);
  assert.match(target.textContent, /修改后.*版本 v3.*新政策/s);
  assert.match(target.textContent, /旧适用条件.*仅限线上订单/s);
  assert.match(target.textContent, /旧待核查事项.*需核实生效日期/s);
  assert.match(target.textContent, /新增 2 行 \/ 删除 2 行/);
  assert.match(target.textContent, /受影响页面（2）.*shopping-guide/s);
  assert.match(target.textContent, /完整签名计划.*original-signed-proof/s);
  assert.ok(nodes(target).some(node => node.tagName === 'pre' && node.textContent === after.body));
  assert.equal(nodes(target).some(node => node.tagName === 'script'), false);
  assert.equal(find(target, node => node.className === 'comparison').children.length, 2);
  const approve = button(target, '批准并应用此计划');
  ui.context.confirmResult = false; await approve.fire('click');
  assert.equal(ui.requests.filter(request => request.operation === 'apply').length, 0);
  ui.context.confirmResult = true; await approve.fire('click');
  assert.deepEqual(ui.requests.find(request => request.operation === 'apply')?.data, { plan, confirm: true });
  assert.equal(ui.requests[0]?.headers.Authorization, 'Bearer fixture-token');
});

test('review UI: failed preview has no approval; retry revalidates and new pages show no previous version', async () => {
  let allow = false;
  const ui = harness(() => allow ? success({ ...preview, pages: [{ ...preview.pages[0], operation: 'create', before: null }] }) : failure('VALIDATION_FAILED'));
  const target = new Element('div'); Object.assign(ui.context, { target, fixture: { plan } });
  await ui.run('showPlan(target,fixture)');
  assert.match(target.textContent, /预览校验未通过/);
  assert.equal(find(target, node => node.className === 'error').getAttribute('role'), 'alert');
  assert.equal(nodes(target).some(node => node.textContent === '批准并应用此计划'), false);
  allow = true; await button(target, '重新校验此计划').fire('click');
  assert.match(target.textContent, /新建 · 退货政策/);
  assert.match(target.textContent, /此页尚不存在/);
  assert.equal(ui.requests.length, 2);
});

test('review UI: read-only preview shows changes without an apply control', async () => {
  const ui = harness(() => success(preview), ['read']);
  const target = new Element('div'); Object.assign(ui.context, { target, fixture: { plan } });
  await ui.run('showPlan(target,fixture)');
  assert.match(target.textContent, /当前身份没有审核权限/);
  assert.equal(nodes(target).some(node => node.textContent === '批准并应用此计划'), false);
});

test('review UI: page correction saves evidence, previews the proposed repair and requires separate approval', async () => {
  const pending = deferred<Response>();
  const ui = harness(request => request.operation === 'get' ? success(wikiDocument) : request.operation === 'correct' ? pending.promise : success(preview));
  await ui.run("openDocument('wiki-return-policy')");
  const dialog = find(ui.body, node => node.tagName === 'dialog');
  assert.match(dialog.textContent, /当前版本 v3/);
  const instruction = named(dialog, 'instruction'); instruction.value = '退货期应为 14 天 <b>原话</b>';
  assert.equal(instruction.required, true);
  const form = find(dialog, node => node.tagName === 'form');
  const submit = find(form, node => node.type === 'submit');
  const submission = form.fire('submit');
  assert.equal(submit.disabled, true);
  assert.match(dialog.textContent, /正在保存纠正原话并生成修订计划/);
  await form.fire('submit');
  assert.equal(ui.requests.filter(request => request.operation === 'correct').length, 1);
  assert.deepEqual(ui.requests.find(request => request.operation === 'correct')?.data, { key: 'return-policy', instruction: instruction.value });
  pending.resolve(success({ evidenceId: 'ev-123456789abc', plan, commit: null })); await submission;
  assert.equal(submit.disabled, false);
  assert.match(dialog.textContent, /纠正原话已保存 · 证据 ev-123456789abc/);
  assert.equal(ui.requests.some(request => request.operation === 'preview'), true);
  assert.equal(ui.requests.some(request => request.operation === 'apply'), false);
  assert.ok(button(dialog, '批准并应用此计划'));
  assert.ok(nodes(dialog).some(node => node.tagName === 'pre' && node.textContent === wikiDocument.body));
  await button(dialog, '批准并应用此计划').fire('click');
  assert.equal(dialog.isConnected, false, 'applied correction closes the old document version');
  assert.deepEqual(ui.requests.find(request => request.operation === 'apply')?.data, { plan, confirm: true });
});

test('review UI: planning failure warns that correction evidence may remain; reader has no correction form', async () => {
  const ui = harness(request => request.operation === 'get' ? success(wikiDocument) : failure('DEPENDENCY_UNAVAILABLE'));
  await ui.run("openDocument('wiki-return-policy')");
  const dialog = find(ui.body, node => node.tagName === 'dialog');
  named(dialog, 'instruction').value = '请改正退货日期';
  await find(dialog, node => node.tagName === 'form').fire('submit');
  assert.match(dialog.textContent, /模型服务不可用/);
  assert.match(dialog.textContent, /纠正原话可能已经保存/);
  assert.equal(ui.requests.some(request => request.operation === 'preview' || request.operation === 'apply'), false);
  const reader = harness(() => success(wikiDocument), ['read']);
  await reader.run("openDocument('wiki-return-policy')");
  assert.equal(nodes(reader.body).some(node => node.name === 'instruction'), false);
});

test('review UI: explanation search displays real scores and opens canonical sources and revisions', async () => {
  const hit = { id: 'wiki-return-policy', path: wikiDocument.path, title: '退货政策', snippet: '<img src=x> 退货期限', score: 0.72,
    kind: 'concept', status: 'active', scope: 'user', sensitivity: 'internal', links: [], backlinks: [] };
  const ui = harness(request => request.operation === 'records' ? success({ items: [], total: 0 }) : request.operation === 'explain' ? success({
    hits: [hit], semanticStatus: 'degraded', indexRebuilt: false, explanation: { strategy: 'lexical',
      signals: [{ id: hit.id, path: hit.path, lexicalScore: 0.72, semanticScore: null, score: 0.72 }], notes: ['未配置语义检索，使用词法匹配。'] },
  }) : success(request.data.id === 'ev-123456789abc' ? { path: before.evidence[0], meta: { type: 'evidence', immutable: true }, body: '原始资料' } : wikiDocument), ['read']);
  const output = await ui.run("records('memories')") as Element; ui.body.append(output);
  named(output, 'query').value = '退货期限';
  const search = find(output, node => node.tagName === 'form' && nodes(node).some(child => child.name === 'query'));
  await search.fire('submit');
  assert.deepEqual(ui.requests.find(request => request.operation === 'explain')?.data, { query: '退货期限' });
  assert.match(output.textContent, /词法检索.*语义检索状态：暂不可用，使用词法匹配/s);
  assert.match(output.textContent, /综合分数0.72.*词法分数0.72.*语义分数未参与/s);
  assert.match(output.textContent, /未配置语义检索/);
  assert.equal(nodes(output).some(node => node.tagName === 'img'), false);
  await find(output, node => node.tagName === 'button' && node.className === 'record').fire('click');
  // The record handler starts openDocument; allow its fetch continuation to settle.
  await Promise.resolve(); await Promise.resolve();
  const dialog = find(ui.body, node => node.tagName === 'dialog');
  assert.match(dialog.textContent, /当前版本 v3/);
  assert.match(dialog.textContent, /来源.*ev-123456789abc/s);
  await button(dialog, before.evidence[0]!).fire('click');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(ui.requests.filter(request => request.operation === 'get').map(request => request.data.id), ['wiki-return-policy', 'ev-123456789abc']);
});

test('review UI: retrieval loading, empty results and errors remain visible and retryable', async () => {
  const pending = deferred<Response>(); let next: Response | Promise<Response> = pending.promise;
  const ui = harness(() => next, ['read']);
  const output = ui.run('retrievalSearch()') as Element; ui.body.append(output);
  named(output, 'query').value = '无匹配';
  const form = find(output, node => node.tagName === 'form');
  const request = form.fire('submit');
  assert.match(output.textContent, /正在检索授权范围内的内容/);
  assert.equal(button(form, '处理中…').disabled, true);
  pending.resolve(success({ hits: [], semanticStatus: 'disabled', indexRebuilt: true, explanation: { strategy: 'lexical', signals: [], notes: [] } }));
  await request;
  assert.match(output.textContent, /没有匹配结果/);
  assert.match(output.textContent, /本次已重建检索索引/);
  next = failure('AUTHORIZATION_DENIED'); await form.fire('submit');
  assert.match(output.textContent, /权限不足/);
  assert.doesNotMatch(output.textContent, /没有匹配结果/);
  assert.equal(button(form, '检索并查看说明').disabled, false);
});

test('review UI: hybrid explanations preserve zero scores and show signals only for returned hits', async () => {
  const hit = { id: 'allowed', path: 'wiki/allowed.md', title: '公开可见的结果', snippet: '', score: 0 };
  const ui = harness(() => success({ hits: [hit], semanticStatus: 'ready', indexRebuilt: false, explanation: { strategy: 'hybrid', notes: [],
    signals: [{ id: hit.id, path: hit.path, lexicalScore: null, semanticScore: 0, score: 0 },
      { id: 'unreturned-record', path: 'wiki/unreturned-record.md', lexicalScore: 12, semanticScore: 12, score: 12 }] } }), ['read']);
  const output = ui.run('retrievalSearch()') as Element; named(output, 'query').value = '可见';
  await find(output, node => node.tagName === 'form').fire('submit');
  assert.match(output.textContent, /词法与语义混合检索.*语义检索状态：可用/s);
  assert.match(output.textContent, /综合分数0.*词法分数未参与.*语义分数0/s);
  assert.doesNotMatch(output.textContent, /unreturned-record/);
});

test('review UI: a late preview from a disconnected session cannot expose an apply button', async () => {
  const pending = deferred<Response>(); const ui = harness(() => pending.promise);
  const target = new Element('div'); ui.body.append(target); Object.assign(ui.context, { target, fixture: { plan } });
  const request = ui.run('showPlan(target,fixture)') as Promise<void>;
  ui.run('logout()'); pending.resolve(success(preview)); await request;
  assert.equal(nodes(target).some(node => node.textContent === '批准并应用此计划'), false);
  assert.equal(ui.requests.some(value => value.operation === 'apply'), false);
});
