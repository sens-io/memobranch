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
  classList = { add: (...names: string[]) => { this.className = [this.className, ...names].filter(Boolean).join(' '); },
    contains: (name: string) => this.className.split(' ').includes(name) };
  constructor(readonly tagName: string) {}
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.ownText = String(value); this.children.forEach(child => { child.parent = null; }); this.children = []; }
  get isConnected(): boolean { return this.root || Boolean(this.parent?.isConnected); }
  append(...children: Element[]) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  insertBefore(child: Element, reference: Element | null) {
    if (child === reference) return child;
    if (reference && reference.parent !== this) throw new Error('Invalid DOM reference');
    child.remove(); child.parent = this;
    if (reference) this.children.splice(this.children.indexOf(reference), 0, child); else this.children.push(child);
    return child;
  }
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
  const timers = new Map<number, { callback: () => unknown; milliseconds: number }>();
  const events = new Map<string, Set<() => unknown>>(); let nextTimer = 0;
  const document = { body, hidden: false, getElementById: (id: string) => id === 'app' ? app : notice,
    createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => { const node = new Element('#text'); node.textContent = text; return node; },
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    addEventListener: (type: string, listener: () => unknown) => { if (!events.has(type)) events.set(type, new Set()); events.get(type)!.add(listener); },
    removeEventListener: (type: string, listener: () => unknown) => { events.get(type)?.delete(listener); },
  };
  const context = createContext({
    document,
    setTimeout: (callback: () => unknown, milliseconds: number) => { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); }, AbortController,
    confirmResult: true, confirm: () => Boolean(context.confirmResult),
    fetch: async (url: string, init: { body: string; headers: Record<string, string> }) => {
      const request = { operation: url.replace('/api/', ''), data: JSON.parse(init.body), headers: init.headers };
      requests.push(request); return route(request);
    },
  });
  runInContext(webScript, context);
  context.userPermissions = permissions;
  runInContext("principal={permissions:userPermissions,scopes:['user'],maxSensitivity:'internal'}; token='fixture-token'; navigate=async()=>{};", context);
  return { body, app, context, requests, timers, document, events,
    visibility: (hidden: boolean) => { document.hidden = hidden; for (const listener of events.get('visibilitychange') ?? []) listener(); },
    run: (code: string) => runInContext(code, context) };
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

const timeDocument = { path: 'wiki/fact/mem-0123456789ab.md', meta: { id: 'mem-0123456789ab', type: 'memory', key: '时间测试',
  revision: 7, status: 'active', scope: 'user', sensitivity: 'internal', evidence: before.evidence, conditions: ['保留适用条件'],
  createdAt: '2020-01-01T00:00:00Z', validFrom: '2030-01-01T12:30:45.123Z', validUntil: '2031-01-01T00:00:00.000Z' }, body: '保留正文 <script>notExecutable()</script>' };
const datedResult = (offset = 0) => ({ at: '2030-06-01T00:00:00.000Z', offset, limit: 1, total: 3, reconstruction: false,
  items: [{ ...timeDocument.meta, body: timeDocument.body, path: timeDocument.path, recordedAt: timeDocument.meta.createdAt,
    uncertainty: ['Effective end is unknown.'], status: 'superseded' }] });

test('time UI: UTC calendar validation preserves milliseconds without guessing dates or rolling invalid days', () => {
  const ui = harness(() => success({}));
  assert.equal(ui.run("utcTimestamp('2030-01-01T12:30:45.123')"), '2030-01-01T12:30:45.123Z');
  assert.equal(ui.run("utcTimestamp('2030-01-01T12:30')"), '2030-01-01T12:30:00.000Z');
  assert.equal(ui.run("utcInput('2030-01-01T20:30:45.123+08:00')"), '2030-01-01T12:30:45.123');
  for (const invalid of ['2030-02-30T12:30', '2030-01-01T24:00', '2030-01-01T12:30:60', '2030-01-01T12:30:45.1234', '2030-01-01T12:30Z', '']) {
    assert.throws(() => ui.run('utcTimestamp(' + JSON.stringify(invalid) + ')'));
  }
  const unknown = ui.run("memoryTime({createdAt:'2030-01-01',status:'active'})") as Element;
  assert.match(unknown.textContent, /时间未知.*开始（包含）：未知.*结束（不包含）：未知/s);
  assert.doesNotMatch(unknown.textContent, /2030-01-01/);
  assert.match((ui.run("memoryTime({validUntil:'2000-01-01T00:00:00Z',status:'active'})") as Element).textContent, /已结束/);
  assert.match((ui.run("memoryTime({validFrom:'2999-01-01T00:00:00Z',status:'active'})") as Element).textContent, /尚未生效/);
});

test('time UI: reviewer confirms displayed version and both nullable bounds, then reloads canonical detail', async () => {
  let saved = false;
  const ui = harness(request => request.operation === 'get'
    ? success(saved ? { ...timeDocument, meta: { ...timeDocument.meta, revision: 8, validUntil: undefined } } : timeDocument)
    : (saved = true, success({ revision: 8, commit: 'saved-commit' })));
  let refreshed = 0; ui.context.changed = async () => { refreshed += 1; };
  await ui.run("openDocument('mem-0123456789ab',changed)");
  const dialog = find(ui.body, node => node.tagName === 'dialog');
  const from = named(dialog, 'validFrom'), until = named(dialog, 'validUntil');
  assert.equal(from.value, '2030-01-01T12:30:45.123'); assert.equal(from.type, 'datetime-local'); assert.equal(from.required, false);
  until.value = '';
  const form = find(dialog, node => node.tagName === 'form');
  ui.context.confirmResult = false; await form.fire('submit');
  assert.equal(ui.requests.filter(r => r.operation === 'memory-validity').length, 0);
  assert.match(dialog.textContent, /原结束：2031-01-01.*新结束：未知/s);
  ui.context.confirmResult = true; await form.fire('submit');
  assert.deepEqual(ui.requests.find(r => r.operation === 'memory-validity')?.data, {
    id: timeDocument.meta.id, validFrom: timeDocument.meta.validFrom, validUntil: null, expectedRevision: 7, confirm: true,
  });
  assert.match(dialog.textContent, /当前版本 v8/); assert.equal(refreshed, 1);
  assert.equal(ui.requests.filter(r => r.operation === 'get').length, 2);
  assert.equal(nodes(dialog).some(node => node.tagName === 'script'), false);
});

test('time UI: read-only and withdrawn or non-memory records have no time writer', async () => {
  for (const [permissions, document] of [
    [['read'], timeDocument], [['admin'], { ...timeDocument, meta: { ...timeDocument.meta, status: 'revoked' } }],
    [['admin'], wikiDocument],
  ] as const) {
    const ui = harness(() => success(document), [...permissions]);
    await ui.run("openDocument('record')");
    assert.equal(nodes(ui.body).some(node => node.name === 'validFrom'), false);
    assert.equal(ui.requests.length, 1);
  }
});

test('time UI: equal/reversed calendar bounds fail before any mutation and remain editable', async () => {
  const ui = harness(() => success(timeDocument)); await ui.run("openDocument('record')");
  const dialog = find(ui.body, node => node.tagName === 'dialog'), form = find(dialog, node => node.tagName === 'form');
  named(dialog, 'validUntil').value = named(dialog, 'validFrom').value;
  await form.fire('submit'); assert.match(dialog.textContent, /开始时间必须早于结束时间/);
  named(dialog, 'validUntil').value = '2020-01-01T00:00'; await form.fire('submit');
  assert.equal(ui.requests.length, 1); assert.equal(form.isConnected, true);
});

test('time UI: stale save cannot retry blindly and fresh read changes the next displayed revision', async () => {
  let current = timeDocument;
  const ui = harness(request => request.operation === 'get' ? success(current) : failure('VALIDATION_FAILED'));
  await ui.run("openDocument('record')"); const dialog = find(ui.body, node => node.tagName === 'dialog');
  await find(dialog, node => node.tagName === 'form').fire('submit');
  assert.equal(ui.requests.filter(r => r.operation === 'memory-validity').length, 1);
  assert.match(dialog.textContent, /未自动重试/);
  assert.equal(nodes(dialog).some(node => node.tagName === 'form'), false);
  current = { ...timeDocument, meta: { ...timeDocument.meta, revision: 9 } };
  await button(dialog, '重新读取当前版本').fire('click');
  assert.match(dialog.textContent, /当前版本 v9/);
  await find(dialog, node => node.tagName === 'form').fire('submit');
  assert.deepEqual(ui.requests.filter(r => r.operation === 'memory-validity').map(r => r.data.expectedRevision), [7, 9]);
});

test('time UI: closing or disconnecting before a pending read prevents a late editor or write', async () => {
  for (const stop of ['close', 'logout']) {
    const pending = deferred<Response>(); const ui = harness(() => pending.promise);
    const opened = ui.run("openDocument('record')");
    if (stop === 'close') find(ui.body, node => node.tagName === 'dialog').close(); else ui.run('logout()');
    pending.resolve(success(timeDocument)); await opened;
    assert.equal(nodes(ui.body).some(node => node.name === 'validFrom'), false);
    assert.equal(ui.requests.length, 1);
  }
});

test('time UI: successful commit stays successful if detail refresh fails', async () => {
  let gets = 0;
  const ui = harness(request => request.operation === 'memory-validity' ? success({ revision: 8, commit: 'saved-commit' })
    : ++gets === 1 ? success(timeDocument) : failure('AUTHORIZATION_DENIED'));
  await ui.run("openDocument('record')"); const dialog = find(ui.body, node => node.tagName === 'dialog');
  await find(dialog, node => node.tagName === 'form').fire('submit');
  assert.match(ui.run('notice.textContent'), /有效期已保存.*v8/);
  assert.match(dialog.textContent, /权限不足/);
  assert.equal(nodes(dialog).some(node => node.name === 'validFrom'), false);
  assert.equal(ui.requests.filter(r => r.operation === 'memory-validity').length, 1);
});

test('time UI: dated paging uses capped limits and submitted criteria, preserving retained warnings and source text', async () => {
  const ui = harness(request => success({ ...datedResult(request.data.offset), at: request.data.at }));
  const view = ui.run('datedMemories()') as { element: Element }; ui.body.append(view.element);
  const form = find(view.element, node => node.tagName === 'form');
  named(view.element, 'at').value = '2030-06-01T00:00'; named(view.element, 'key').value = '  时间测试  ';
  assert.equal(named(view.element, 'includeUnknown').checked, false);
  await form.fire('submit');
  assert.deepEqual(ui.requests[0]?.data, { at: '2030-06-01T00:00:00.000Z', key: '时间测试', includeUnknown: false, offset: 0, limit: 20 });
  assert.match(view.element.textContent, /不是历史 Wiki.*本次读取版本 v7.*已被替代.*来源.*不确定性/s);
  assert.equal(nodes(view.element).some(node => node.tagName === 'script'), false);
  named(view.element, 'at').value = '2039-01-01T00:00'; named(view.element, 'key').value = '未提交的名称';
  await button(view.element, '下一页').fire('click');
  assert.equal(ui.requests[1]?.data.offset, 1); assert.equal(ui.requests[1]?.data.at, ui.requests[0]?.data.at);
  assert.equal(ui.requests[1]?.data.key, '时间测试');
  named(view.element, 'includeUnknown').checked = true; await form.fire('submit');
  assert.equal(ui.requests[2]?.data.offset, 0); assert.equal(ui.requests[2]?.data.includeUnknown, true);
  assert.equal(ui.requests[2]?.data.key, '未提交的名称');
});

test('time UI: superseded reads and page cleanup cannot overwrite the latest dated result', async () => {
  const old = deferred<Response>(); let calls = 0;
  const ui = harness(request => ++calls === 2 ? old.promise : success({ ...datedResult(), at: request.data.at }));
  const view = ui.run('datedMemories()') as { element: Element }; ui.body.append(view.element);
  const form = find(view.element, node => node.tagName === 'form'); named(view.element, 'at').value = '2030-06-01T00:00';
  await form.fire('submit');
  const refresh = button(view.element, '刷新已提交的日期查询').fire('click');
  named(view.element, 'at').value = '2030-07-01T00:00'; await form.fire('submit');
  old.resolve(success({ ...datedResult(), at: '1999-01-01T00:00:00Z' })); await refresh;
  assert.match(view.element.textContent, /查询时刻（UTC）：2030-07-01/); assert.doesNotMatch(view.element.textContent, /1999-01-01/);
  const count = ui.requests.length; ui.run('pageCleanup()'); await button(view.element, '刷新已提交的日期查询').fire('click');
  assert.equal(ui.requests.length, count);
});

test('web branding: login and sidebar reuse the README image instead of the letter mark', () => {
  const ui = harness(() => success({}));
  for (const render of ['login()', 'shell()']) {
    ui.run(render);
    assert.equal(ui.run("app.querySelectorAll('img').length"), 1);
    assert.equal(ui.run("app.querySelector('img').src"), '/assets/logo.png');
    assert.equal(ui.run("app.querySelector('img').alt"), '', 'the adjacent product name already labels the brand');
    assert.equal(nodes(ui.app).some(node => node.className === 'mark'), false);
    assert.match(ui.app.textContent, /MemoBranch/);
  }
});

test('web theme: the new split login retains failure feedback and in-memory authentication', async () => {
  let accepted = false;
  const ui = harness(() => accepted ? success({ principal: { name: 'Test operator', permissions: ['read'] }, name: 'Test vault' }) : failure('AUTHORIZATION_DENIED'));
  ui.run('login()');
  assert.ok(nodes(ui.app).some(node => node.className === 'login-story'));
  assert.ok(nodes(ui.app).some(node => node.className === 'login-access'));
  const input = find(ui.app, node => node.tagName === 'input' && node.type === 'password');
  const login = find(ui.app, node => node.tagName === 'form');
  input.value = 'invalid-fixture';
  await login.fire('submit');
  assert.equal(input.value, '');
  assert.equal(ui.run('token'), '');
  assert.match(ui.app.textContent, /权限不足/);
  accepted = true;
  input.value = 'accepted-fixture';
  await login.fire('submit');
  assert.equal(input.value, '');
  assert.equal(ui.run('token'), 'accepted-fixture');
  assert.ok(nodes(ui.app).some(node => node.className === 'sidebar'));
  assert.match(ui.app.textContent, /Test operator/);
});

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
  assert.deepEqual(ui.requests.find(request => request.operation === 'correct')?.data, { key: 'return-policy', instruction: instruction.value, expectedRevision: 3 });
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

test('review UI: correction sends the displayed revision even after the canonical page changes', async () => {
  let currentRevision = 7;
  const ui = harness(request => request.operation === 'get'
    ? success({ ...wikiDocument, meta: { ...wikiDocument.meta, revision: currentRevision } })
    : failure(request.data.expectedRevision === currentRevision ? 'DEPENDENCY_UNAVAILABLE' : 'VALIDATION_FAILED'));
  await ui.run("openDocument('wiki-return-policy')");
  const dialog = find(ui.body, node => node.tagName === 'dialog');
  assert.match(dialog.textContent, /当前版本 v7/);
  currentRevision = 8;
  named(dialog, 'instruction').value = '更正我当前看到的退货政策';
  await find(dialog, node => node.tagName === 'form').fire('submit');
  assert.deepEqual(ui.requests.find(request => request.operation === 'correct')?.data,
    { key: 'return-policy', instruction: '更正我当前看到的退货政策', expectedRevision: 7 });
  assert.equal(ui.requests.filter(request => request.operation === 'get').length, 1, 'must not silently reread a newer page for the correction');
  assert.match(dialog.textContent, /数据版本已变化/);
  assert.equal(ui.requests.some(request => request.operation === 'preview' || request.operation === 'apply'), false);
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

const task = { id: 'wj-' + 'a'.repeat(32), status: 'queued', stage: 'queued', attempts: 0, createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z', startedAt: null, finishedAt: null, cancelRequested: false, error: null };
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test('Web jobs UI: explicit enqueue validates evidence and never starts execution automatically', async () => {
  let jobs: object[] = [];
  const ui = harness(request => request.operation === 'jobs-list' ? success(jobs) : (jobs = [task], success(task)));
  const output = await ui.run('jobs()') as Element; ui.app.append(output);
  assert.match(output.textContent, /排队不会自动执行/); assert.match(output.textContent, /还没有编译任务/);
  const submit = find(output, node => node.tagName === 'form');
  named(output, 'evidenceIds').value = 'ev-123456789abc,ev-123456789abc';
  await submit.fire('submit');
  assert.match(output.textContent, /不同的证据编号/); assert.equal(ui.requests.filter(r => r.operation === 'jobs-enqueue').length, 0);
  named(output, 'evidenceIds').value = 'ev-123456789abc'; named(output, 'maxPages').value = '20';
  await submit.fire('submit');
  assert.deepEqual(ui.requests.find(r => r.operation === 'jobs-enqueue')!.data, { evidenceIds: ['ev-123456789abc'], maxPages: 20, confirm: true });
  assert.match(output.textContent, /已保存，尚未执行/);
  assert.equal(ui.requests.some(r => ['jobs-run', 'jobs-apply', 'ingest', 'apply'].includes(r.operation)), false);
  assert.ok(button(output, '执行一次'));
  ui.run('pageCleanup()');
});

test('Web jobs UI: repeated start clicks send once and failure warns before any retry', async () => {
  const pending = deferred<Response>();
  const ui = harness(request => request.operation === 'jobs-list' ? success([task]) : pending.promise);
  const output = await ui.run('jobs()') as Element; ui.app.append(output);
  const run = button(output, '执行一次');
  const first = run.fire('click'); await run.fire('click');
  assert.equal(ui.requests.filter(r => r.operation === 'jobs-run').length, 1);
  assert.deepEqual(ui.requests.find(r => r.operation === 'jobs-run')!.data, { id: task.id, confirm: true });
  pending.resolve(failure('LOCK_TIMEOUT')); await first;
  assert.match(ui.body.textContent, /请先刷新确认状态/);
  assert.equal(run.disabled, false);
  assert.equal(ui.requests.filter(r => r.operation === 'jobs-run').length, 1);
  ui.run('pageCleanup()');
});

test('Web jobs UI: polling is non-overlapping, pauses when hidden and stops after navigation/logout', async () => {
  let result: Response | Promise<Response> = success([task]);
  const ui = harness(() => result);
  const output = await ui.run('jobs()') as Element; ui.app.append(output);
  assert.equal(ui.requests.length, 1);
  const originalAction = button(output, '执行一次'); await button(output, '刷新状态').fire('click');
  assert.equal(button(output, '执行一次'), originalAction, 'unchanged polling must preserve the focused action element');
  const scheduled = [...ui.timers].find(([, timer]) => timer.milliseconds === 2000)!;
  assert.ok(scheduled);
  const pending = deferred<Response>(); result = pending.promise;
  ui.timers.delete(scheduled[0]); scheduled[1].callback();
  await button(output, '刷新状态').fire('click');
  assert.equal(ui.requests.length, 3, 'a pending poll must not overlap another list request');
  ui.visibility(true); pending.resolve(success([{ ...task, status: 'ready', stage: 'finished' }])); await settle();
  assert.equal(ui.timers.size, 0);
  assert.equal(nodes(output).some(node => node.tagName === 'button' && node.textContent === '查看变更与审核'), false, 'hidden late data is not rendered');
  result = success([{ ...task, status: 'ready', stage: 'finished' }]); ui.visibility(false); await settle();
  assert.ok(button(output, '查看变更与审核'));
  ui.run('pageCleanup(); generation++');
  assert.equal(ui.events.get('visibilitychange')!.size, 0);
  assert.equal([...ui.timers.values()].some(timer => timer.milliseconds === 2000), false);
  const before = ui.requests.length; ui.visibility(false); await settle(); assert.equal(ui.requests.length, before);
  ui.run('logout()'); assert.equal(ui.run('token'), '');
});

test('Web jobs UI: review uses the same displayed proof, blocks blind reapproval and distinguishes applied outcome', async () => {
  const signed = { ...plan, proof: 'b'.repeat(64) }; let allow = false;
  const ui = harness(request => request.operation === 'jobs-list' ? success([{ ...task, status: 'ready', stage: 'finished' }])
    : request.operation === 'jobs-review' ? success({ plan: signed, preview })
    : allow ? success({ commit: 'abcdef123456' }) : failure('VALIDATION_FAILED'));
  const output = await ui.run('jobs()') as Element; ui.app.append(output);
  await button(output, '查看变更与审核').fire('click');
  const dialog = find(ui.body, node => node.tagName === 'dialog');
  assert.match(dialog.textContent, /修改前.*修改后/s); assert.equal(nodes(dialog).some(node => node.tagName === 'script'), false);
  await button(dialog, '批准并应用此任务计划').fire('click');
  assert.deepEqual(ui.requests.find(r => r.operation === 'jobs-apply')!.data, { id: task.id, proof: signed.proof, confirm: true });
  assert.equal(nodes(dialog).some(node => node.textContent === '批准并应用此任务计划'), false);
  assert.match(dialog.textContent, /未确认的结果请先检查历史/);
  allow = true; await button(dialog, '重新预览当前计划').fire('click');
  await button(dialog, '批准并应用此任务计划').fire('click');
  assert.match(dialog.textContent, /本次批准已完成.*abcdef123456/s);
  assert.equal(ui.requests.some(r => r.operation === 'apply' || r.operation === 'preview'), false, 'must not substitute a generic wider-authority vault');
  ui.run('pageCleanup()'); assert.equal(dialog.isConnected, false);
});

test('Web jobs UI: another task changing stage preserves unrelated action nodes and updates only that row', async () => {
  const other = { ...task, id: 'wj-' + 'c'.repeat(32), status: 'running', stage: 'compiling' };
  let rows = [task, other];
  const ui = harness(() => success(rows));
  const output = await ui.run('jobs()') as Element; ui.app.append(output);
  const action = button(output, '执行一次'), before = find(output, node => node.className === 'job-row' && node.textContent.includes(other.id));
  rows = [task, { ...other, stage: 'validating', updatedAt: '2026-10-21T01:00:00.000Z' }];
  await button(output, '刷新状态').fire('click');
  assert.equal(button(output, '执行一次'), action); assert.equal(action.isConnected, true);
  const after = find(output, node => node.className === 'job-row' && node.textContent.includes(other.id));
  assert.notEqual(after, before); assert.equal(before.isConnected, false);
  assert.equal(find(after, node => node.className === 'current').textContent, '结果校验');
  rows = [{ ...task, id: 'wj-' + 'd'.repeat(32) }, task, rows[1]!];
  await button(output, '刷新状态').fire('click');
  assert.equal(action.isConnected, true, 'inserting another task must not detach existing rows');
  ui.run('pageCleanup()');
});

test('Web jobs UI: late preview cannot expose approval after leaving, and readers have no mutation controls', async () => {
  const pending = deferred<Response>();
  const ui = harness(request => request.operation === 'jobs-list' ? success([{ ...task, status: 'ready', stage: 'finished' }]) : pending.promise);
  const output = await ui.run('jobs()') as Element; ui.app.append(output);
  const opening = button(output, '查看变更与审核').fire('click');
  const old = find(ui.body, node => node.tagName === 'dialog');
  ui.run('pageCleanup(); generation++'); pending.resolve(success({ plan, preview })); await opening;
  assert.equal(old.isConnected, false); assert.equal(nodes(old).some(node => node.textContent === '批准并应用此任务计划'), false);
  const reader = harness(request => request.operation === 'jobs-list' ? success([{ ...task, status: 'ready', stage: 'finished' }]) : success({ plan, preview }), ['read']);
  const view = await reader.run('jobs()') as Element; reader.app.append(view);
  assert.equal(nodes(view).some(node => node.tagName === 'form'), false);
  for (const label of ['执行一次', '取消任务', '重新排队', '删除任务']) assert.equal(nodes(view).some(node => node.textContent === label), false);
  await button(view, '查看变更与审核').fire('click');
  assert.match(reader.body.textContent, /当前身份没有审核权限/);
  assert.equal(nodes(reader.body).some(node => node.textContent === '批准并应用此任务计划'), false);
  reader.run('pageCleanup()');
});

test('Web jobs UI: cancellation state, retry limits, filtering and safe list errors remain visible', async () => {
  let rows = [{ ...task, status: 'failed', stage: 'finished', attempts: 3, error: { code: 'DEPENDENCY_UNAVAILABLE', reason: 'deadline' } },
    { ...task, id: 'wj-' + 'c'.repeat(32), status: 'running', stage: 'validating', cancelRequested: true }];
  const ui = harness(() => success(rows));
  const output = await ui.run('jobs()') as Element; ui.app.append(output);
  assert.match(output.textContent, /达到本次执行时限/); assert.match(output.textContent, /等待执行进程停止/);
  assert.equal(nodes(output).some(node => node.tagName === 'button' && ['重新排队', '取消任务'].includes(node.textContent)), false);
  const filter = named(output, 'job-status'); filter.value = 'ready'; await filter.fire('change');
  assert.match(output.textContent, /没有符合此状态/);
  rows = []; await button(output, '刷新状态').fire('click'); assert.match(output.textContent, /还没有编译任务/);
  rows = [task]; await button(output, '刷新状态').fire('click');
  assert.match(output.textContent, /没有符合此状态/); assert.doesNotMatch(output.textContent, /还没有编译任务/);
  ui.run('pageCleanup()');
  const failed = harness(() => failure('ENCRYPTION_KEY_UNAVAILABLE'));
  const target = await failed.run('jobs()') as Element; failed.app.append(target);
  assert.match(target.textContent, /未提供解密密钥/); assert.ok(button(target, '重新读取任务'));
  failed.run('pageCleanup()');
});
