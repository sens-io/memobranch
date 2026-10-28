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
  querySelectorAll(selector: string): Element[] { return nodes(this).slice(1).filter(node => selector.split(',').some(part => part.trim().startsWith('.') ? node.className.split(' ').includes(part.trim().slice(1)) : node.tagName === part.trim())); }
  closest(selector: string): Element | null { return this.tagName === selector ? this : this.parent?.closest(selector) ?? null; }
  focus() {}
  click() { void this.fire('click'); }
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
type Request = { operation: string; data: any; headers: Record<string, string>; signal?: AbortSignal };

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
    fetch: async (url: string, init: { body: string; headers: Record<string, string>; signal: AbortSignal }) => {
      const request = { operation: url.replace('/api/', ''), data: JSON.parse(init.body), headers: init.headers, signal: init.signal };
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

test('time UI: pending saves freeze reads and edits until either outcome, without hidden failures or lost drafts', async () => {
  for (const accepted of [false, true]) {
    const pending = deferred<Response>(); let current = timeDocument;
    const ui = harness(request => request.operation === 'get' ? success(current) : pending.promise);
    await ui.run("openDocument('record')"); const dialog = find(ui.body, node => node.tagName === 'dialog');
    const form = find(dialog, node => node.tagName === 'form'), from = named(dialog, 'validFrom');
    const refresh = button(dialog, '重新读取当前版本');
    const saving = form.fire('submit');
    assert.equal(from.disabled, true); assert.equal(refresh.disabled, true);
    assert.equal(button(dialog, '撤回记忆').disabled, true);
    assert.equal(button(dialog, '关闭').disabled, false);
    await refresh.fire('click'); await form.fire('submit');
    assert.deepEqual(ui.requests.map(r => r.operation), ['get', 'memory-validity']);
    current = { ...timeDocument, meta: { ...timeDocument.meta, revision: 8 } };
    pending.resolve(accepted ? success({ revision: 8, commit: 'saved-commit' }) : failure('VALIDATION_FAILED'));
    await saving;
    if (!accepted) {
      assert.match(dialog.textContent, /未自动重试/);
      assert.equal(nodes(dialog).some(node => node.tagName === 'form'), false);
      await refresh.fire('click');
    }
    assert.match(dialog.textContent, /当前版本 v8/);
    assert.equal(named(dialog, 'validFrom').disabled, false);
    named(dialog, 'validFrom').value = '2030-06-01T00:00';
    await Promise.resolve();
    assert.equal(named(dialog, 'validFrom').value, '2030-06-01T00:00');
    assert.deepEqual(ui.requests.map(r => r.operation), ['get', 'memory-validity', 'get']);
  }
});

test('time UI: unsupported native calendar years remain exact text instead of becoming unknown on save', async () => {
  const document = { ...timeDocument, meta: { ...timeDocument.meta, validFrom: '0000-01-01T00:00:00.000Z' } };
  const ui = harness(request => request.operation === 'get' ? success(document) : failure('VALIDATION_FAILED'));
  const create = ui.document.createElement;
  ui.document.createElement = tag => {
    const node = create(tag); let value = '';
    if (tag === 'input') Object.defineProperty(node, 'value', {
      get: () => value,
      set: (next: string) => { value = node.type === 'datetime-local' && next.startsWith('0000-') ? '' : next; },
    });
    return node;
  };
  await ui.run("openDocument('record')"); const dialog = find(ui.body, node => node.tagName === 'dialog');
  assert.equal(named(dialog, 'validFrom').type, 'text');
  assert.equal(named(dialog, 'validFrom').value, '0000-01-01T00:00:00.000');
  assert.match(dialog.textContent, /原始日期不受浏览器日历支持.*不会自动清空/);
  await find(dialog, node => node.tagName === 'form').fire('submit');
  assert.equal(ui.requests.find(r => r.operation === 'memory-validity')?.data.validFrom, document.meta.validFrom);
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

const mergeCommit='a'.repeat(40),mergeHead='b'.repeat(40);
const mergeOld={meta:{...wikiDocument.meta,revision:2,summary:'Current summary.',uncertainty:before.uncertainty},body:before.body,currentRevision:3};
const mergeCurrent={...mergeOld,meta:{...mergeOld.meta,revision:3},body:after.body+'\n\n<!-- MEMOBRANCH_WIKI_LINKS -->\nGenerated sources'};
const mergeBase={commit:mergeCommit,authorityHead:mergeHead,pages:[mergeOld]},mergeLive={commit:mergeHead,authorityHead:mergeHead,pages:[mergeCurrent]};
const mergePlan={...plan,kind:'merge',merge:{fromCommit:mergeCommit,key:wikiDocument.meta.key}};
const mergePrepared={plan:mergePlan,comparison:{base:mergeBase,current:mergeCurrent}};
function mergeRoute(request: Request): Response {
  if(request.operation==='catalog')return success([{key:wikiDocument.meta.key,title:'退货政策',revision:3},{key:'legacy:mem-123456789abc',title:'Not compiled',revision:1}]);
  if(request.operation==='wiki-snapshot')return success(request.data.commit===mergeCommit?mergeBase:mergeLive);
  if(request.operation==='merge-prepare')return success(mergePrepared);
  if(request.operation==='preview')return success({...preview,kind:'merge'});
  if(request.operation==='apply')return success({commit:'merge-saved-commit',pageIds:['page']});
  throw Error('Unexpected merge request '+request.operation);
}
async function mergeView(ui: ReturnType<typeof harness>){const output=await ui.run('merges()') as Element;ui.app.append(output);named(output,'fromCommit').value=mergeCommit;return output;}
const mergeSelector=(output: Element)=>nodes(output).filter(node=>node.tagName==='form')[0]!;
const mergeEditor=(output: Element)=>nodes(output).filter(node=>node.tagName==='form')[1]!;

const requestedWikiTime='2026-01-15T12:00:00+08:00';
const datedMergeBase={...mergeBase,selection:{kind:'git-committer-time',at:'2026-01-15T04:00:00.000Z',committedAt:'2026-01-10T00:00:00.000Z',traversal:'first-parent',scannedCommits:4},warnings:['Mutable Git clocks do not establish historical agent knowledge.']};
const datedMergeRoute=(request: Request)=>request.operation==='wiki-snapshot'&&request.data.at!==undefined?success(datedMergeBase):mergeRoute(request);
async function dateMode(output: Element){named(output,'historySelector').value='at';await named(output,'historySelector').fire('change');named(output,'at').value=requestedWikiTime;await named(output,'at').fire('input');}

test('Web dated Wiki UI: exclusive controls pin the resolved hash and retain complete date metadata through preparation',async()=>{
  const ui=harness(datedMergeRoute),output=await mergeView(ui),commit=named(output,'fromCommit'),at=named(output,'at');
  assert.equal(named(output,'historySelector').value,'commit');assert.equal(commit.required,true);assert.equal(at.required,false);assert.equal(at.disabled,true);
  await dateMode(output);commit.value='IGNORED_INACTIVE_COMMIT';assert.equal(commit.disabled,true);assert.equal(commit.required,false);assert.equal(at.required,true);assert.equal(at.disabled,false);
  await mergeSelector(output).fire('submit');const reads=ui.requests.filter(request=>request.operation==='wiki-snapshot');
  assert.deepEqual(reads.map(request=>request.data),[{at:requestedWikiTime,pageKeys:[wikiDocument.meta.key],includeSensitive:false,includeSecret:false},{commit:mergeHead,pageKeys:[wikiDocument.meta.key],includeSensitive:false,includeSecret:false}]);
  assert.match(output.textContent,/请求时刻（UTC）：2026-01-15T04:00:00.000Z/);assert.match(output.textContent,/选中提交者时间：2026-01-10T00:00:00.000Z/);assert.match(output.textContent,/第一父链检查 4 条/);assert.match(output.textContent,/Git 时间可被改写/);assert.match(output.textContent,/Mutable Git clocks/);assert.match(output.textContent,new RegExp(mergeCommit));
  assert.match(output.textContent,/旧政策/);assert.match(output.textContent,/<script>untrusted\(\)<\/script>/);assert.equal(nodes(output).some(node=>node.tagName==='script'),false);
  named(output,'body').value='Reviewed dated 中文 🧠';await named(output,'body').fire('input');await mergeEditor(output).fire('submit');
  const prepared=ui.requests.find(request=>request.operation==='merge-prepare')!.data;assert.equal(prepared.fromCommit,mergeCommit);assert.equal('at' in prepared,false);assert.equal('historySelector' in prepared,false);
  assert.match(output.textContent,/日期已解析为实际提交/);assert.equal(ui.requests.filter(request=>request.operation==='wiki-snapshot').length,2);assert.equal(ui.requests.some(request=>request.operation==='apply'),false);
  ui.context.confirmResult=false;await button(output,'批准并保存这次合并').fire('click');assert.equal(ui.requests.some(request=>request.operation==='apply'),false);
});

test('Web dated Wiki UI: empty and unsupported modes stop locally; server date rejection never falls back to current text',async()=>{
  const ui=harness(request=>request.operation==='wiki-snapshot'?failure('VALIDATION_FAILED'):mergeRoute(request)),output=await mergeView(ui);await dateMode(output);
  named(output,'at').value=' ';await mergeSelector(output).fire('submit');assert.equal(ui.requests.length,1);assert.match(output.textContent,/带时区的 ISO/);
  named(output,'historySelector').value='foreign';await named(output,'historySelector').fire('change');await mergeSelector(output).fire('submit');assert.equal(ui.requests.length,1);assert.match(output.textContent,/有效的历史版本/);
  await dateMode(output);named(output,'at').value='2026-02-30T12:00:00Z';await mergeSelector(output).fire('submit');
  assert.equal(ui.requests.length,2);assert.equal(ui.requests[1]!.data.at,'2026-02-30T12:00:00Z');assert.match(output.textContent,/VALIDATION_FAILED/);assert.equal(button(output,'生成合并审核方案').disabled,true);
  assert.equal(nodes(output).some(node=>node.classList.contains('recorded-selection')),false);assert.doesNotMatch(output.textContent,/旧政策/);assert.equal(ui.requests.some(request=>['apply','merge-prepare'].includes(request.operation)),false);
});

for(const name of ['at','historySelector'])test(`Web dated Wiki UI: ${name} edits remove resolved metadata and detached approval while preserving an unsaved draft`,async()=>{
  const ui=harness(datedMergeRoute),output=await mergeView(ui);await dateMode(output);await mergeSelector(output).fire('submit');named(output,'body').value='Keep this unsaved draft.';await named(output,'body').fire('input');await mergeEditor(output).fire('submit');
  const old=button(output,'批准并保存这次合并'),count=ui.requests.length;if(name==='at')named(output,name).value='2026-01-16T00:00:00Z';else named(output,name).value='commit';await named(output,name).fire(name==='at'?'input':'change');
  assert.equal(nodes(output).some(node=>node.classList.contains('recorded-selection')),false);assert.equal(named(output,'body').value,'Keep this unsaved draft.');assert.equal((find(output,node=>node.classList.contains('merge-editor')) as Element & {hidden:boolean}).hidden,false);
  assert.equal(button(output,'生成合并审核方案').disabled,true);await old.fire('click');assert.equal(ui.requests.length,count);ui.context.confirmResult=false;await mergeSelector(output).fire('submit');assert.equal(ui.requests.length,count);assert.equal(named(output,'body').value,'Keep this unsaved draft.');
});

for(const boundary of ['mode','date','leave'])test(`Web dated Wiki UI: ${boundary} cancels the owned pending read and ignores its late result`,async()=>{
  const pending=deferred<Response>(),ui=harness(request=>request.operation==='wiki-snapshot'?pending.promise:mergeRoute(request)),output=await mergeView(ui);await dateMode(output);
  const reading=mergeSelector(output).fire('submit');await settle();const request=ui.requests.find(item=>item.operation==='wiki-snapshot')!;assert.equal(request.signal!.aborted,false);
  if(boundary==='mode'){named(output,'historySelector').value='commit';await named(output,'historySelector').fire('change');}else if(boundary==='date'){named(output,'at').value='2026-01-16T00:00:00Z';await named(output,'at').fire('input');}else ui.run('pageCleanup();generation++');
  assert.equal(request.signal!.aborted,true);pending.resolve(success(datedMergeBase));await reading;
  assert.equal(ui.requests.filter(item=>item.operation==='wiki-snapshot').length,1);assert.equal(nodes(output).some(node=>node.classList.contains('recorded-selection')),false);assert.doesNotMatch(output.textContent,/旧政策/);assert.equal(ui.requests.some(item=>item.operation==='apply'),false);
});

test('Web dated Wiki UI: read-only users compare but cannot prepare or approve dated content',async()=>{
  const ui=harness(datedMergeRoute,['read']),output=await mergeView(ui);await dateMode(output);await mergeSelector(output).fire('submit');await mergeEditor(output).fire('submit');
  assert.match(output.textContent,/日期已解析为实际提交/);assert.match(output.textContent,/没有写入权限/);assert.equal(ui.requests.some(request=>['merge-prepare','apply'].includes(request.operation)),false);assert.equal((find(output,node=>node.classList.contains('merge-editor')) as Element & {hidden:boolean}).hidden,true);
});

test('Web dated Wiki UI: pending approval disables both new controls and retries only the same signed hash-bound plan',async()=>{
  let applies=0;const pending=deferred<Response>(),ui=harness(request=>request.operation==='apply'?(++applies===1?pending.promise:success({commit:null,pageIds:[]})):datedMergeRoute(request)),output=await mergeView(ui);
  await dateMode(output);await mergeSelector(output).fire('submit');await mergeEditor(output).fire('submit');const approve=button(output,'批准并保存这次合并'),saving=approve.fire('click');await settle();
  assert.equal(named(output,'historySelector').disabled,true);assert.equal(named(output,'at').disabled,true);assert.equal(named(output,'fromCommit').disabled,true);await approve.fire('click');assert.equal(applies,1);
  pending.resolve(failure('OPERATION_CANCELLED'));await saving;await button(output,'重试原签名方案').fire('click');assert.equal(applies,2);
  const saves=ui.requests.filter(request=>request.operation==='apply');assert.deepEqual(saves[0]!.data,saves[1]!.data);assert.equal(saves[0]!.data.plan.merge.fromCommit,mergeCommit);assert.equal(ui.requests.filter(request=>request.operation==='wiki-snapshot').length,2);
});

test('Web merge UI: complete text, safe rendering and signed review precede separate confirmed approval',async()=>{
  const ui=harness(mergeRoute),output=await mergeView(ui);await mergeSelector(output).fire('submit');
  assert.match(output.textContent,/旧政策/);assert.match(output.textContent,/<script>untrusted\(\)<\/script>/);assert.equal(nodes(output).some(node=>node.tagName==='script'),false);
  assert.equal(named(output,'body').value,after.body);assert.doesNotMatch(named(output,'body').value,/MEMOBRANCH_WIKI_LINKS|Generated sources/);
  assert.equal(nodes(output).some(node=>node.tagName==='option'&&node.value.startsWith('legacy:')),false);
  named(output,'body').value='Reviewed 中文 🧠';await named(output,'body').fire('input');await mergeEditor(output).fire('submit');
  assert.deepEqual(ui.requests.find(request=>request.operation==='merge-prepare')!.data,{fromCommit:mergeCommit,pageKey:wikiDocument.meta.key,expectedRevision:3,includeSensitive:false,includeSecret:false,body:'Reviewed 中文 🧠',summary:'Current summary.',title:wikiDocument.meta.title});
  assert.match(output.textContent,/受影响页面/);assert.match(output.textContent,/仅限线上订单/);const approve=button(output,'批准并保存这次合并');
  ui.context.confirmResult=false;await approve.fire('click');assert.equal(ui.requests.some(request=>request.operation==='apply'),false);
  ui.context.confirmResult=true;await approve.fire('click');assert.deepEqual(ui.requests.find(request=>request.operation==='apply')!.data,{plan:mergePlan,confirm:true});assert.match(output.textContent,/merge-saved-commit/);
});
test('Web merge UI: readers compare, writers prepare, only reviewers can approve',async()=>{
  for(const permissions of [['read'],['read','write']]){const ui=harness(mergeRoute,permissions),output=await mergeView(ui);await mergeSelector(output).fire('submit');await mergeEditor(output).fire('submit');
    assert.equal(ui.requests.filter(request=>request.operation==='merge-prepare').length,permissions.includes('write')?1:0);
    assert.equal(nodes(output).some(node=>node.tagName==='button'&&node.textContent==='批准并保存这次合并'),false);assert.match(output.textContent,permissions.includes('write')?/没有审核权限/:/没有写入权限/);}
});
test('Web merge UI: every draft/selection edit removes old approval, including retained detached buttons',async()=>{
  for(const name of ['body','summary','title','fromCommit','pageKey','includeSensitive','includeSecret']){const ui=harness(mergeRoute),output=await mergeView(ui);await mergeSelector(output).fire('submit');await mergeEditor(output).fire('submit');
    const old=button(output,'批准并保存这次合并');await named(output,name).fire('input');await old.fire('click');assert.equal(old.isConnected,false);assert.equal(ui.requests.some(request=>request.operation==='apply'),false);}
});
test('Web merge UI: editing during preparation rejects late content and preserves newer text',async()=>{
  const pending=deferred<Response>(),ui=harness(request=>request.operation==='merge-prepare'?pending.promise:mergeRoute(request)),output=await mergeView(ui);await mergeSelector(output).fire('submit');
  const preparing=mergeEditor(output).fire('submit');await settle();named(output,'body').value='A newer draft.';await named(output,'body').fire('input');pending.resolve(success(mergePrepared));await preparing;
  assert.equal(named(output,'body').value,'A newer draft.');assert.equal(nodes(output).some(node=>node.tagName==='button'&&node.textContent==='批准并保存这次合并'),false);
});
test('Web merge UI: cancelling a version reload leaves the prior unsaved draft visible for copying but not approval',async()=>{
  const ui=harness(mergeRoute),output=await mergeView(ui);await mergeSelector(output).fire('submit');
  named(output,'body').value='Unsaved human draft worth keeping.';await named(output,'body').fire('input');await mergeEditor(output).fire('submit');
  const old=button(output,'批准并保存这次合并'),count=ui.requests.length;
  named(output,'fromCommit').value='c'.repeat(40);await named(output,'fromCommit').fire('input');ui.context.confirmResult=false;await mergeSelector(output).fire('submit');
  const editor=find(output,node=>node.classList.contains('merge-editor')) as Element & {hidden:boolean};
  assert.equal(editor.hidden,false);assert.equal(named(output,'body').value,'Unsaved human draft worth keeping.');assert.equal(named(output,'body').disabled,false);
  assert.equal(button(output,'生成合并审核方案').disabled,true);await old.fire('click');assert.equal(ui.requests.length,count);
  named(output,'fromCommit').value=mergeCommit;await named(output,'fromCommit').fire('input');await mergeSelector(output).fire('submit');assert.equal(editor.hidden,false);assert.equal(ui.requests.length,count);
});
for(const boundary of ['wiki-snapshot','merge-prepare','apply']){
  test(`Web merge UI: leaving during ${boundary} clears text and ignores late responses`,async()=>{
    const pending=deferred<Response>(),ui=harness(request=>request.operation===boundary?pending.promise:mergeRoute(request)),output=await mergeView(ui);
    const loading=mergeSelector(output).fire('submit');if(boundary==='wiki-snapshot'){await settle();ui.run('pageCleanup();generation++');pending.resolve(success(mergeBase));await loading;}
    else{await loading;const preparing=mergeEditor(output).fire('submit');if(boundary==='merge-prepare'){await settle();ui.run('pageCleanup();generation++');pending.resolve(success(mergePrepared));await preparing;}
      else{await preparing;const saving=button(output,'批准并保存这次合并').fire('click');await settle();ui.run('pageCleanup();generation++');pending.resolve(success({commit:'late-commit'}));await saving;}}
    assert.equal(output.textContent,'');assert.equal(nodes(output).length,1);
  });
}
test('Web merge UI: incompatible heads and failed pre-approval validation cannot apply',async()=>{
  const changed=harness(request=>request.operation==='wiki-snapshot'&&request.data.commit===mergeHead?success({...mergeLive,authorityHead:'c'.repeat(40)}):mergeRoute(request)),output=await mergeView(changed);
  await mergeSelector(output).fire('submit');assert.match(output.textContent,/资料已变化/);assert.equal(button(output,'生成合并审核方案').disabled,true);
  let reads=0;const ui=harness(request=>request.operation==='preview'&&++reads===2?failure('VALIDATION_FAILED'):mergeRoute(request)),target=await mergeView(ui);
  await mergeSelector(target).fire('submit');await mergeEditor(target).fire('submit');await button(target,'批准并保存这次合并').fire('click');assert.match(target.textContent,/不能批准/);assert.equal(ui.requests.some(request=>request.operation==='apply'),false);
});
test('Web merge UI: uncertain saves allow only explicit original-plan replay, without a stale preview or duplicate click',async()=>{
  let applies=0,previews=0;const pending=deferred<Response>();
  const ui=harness(request=>{if(request.operation==='preview'){previews++;return mergeRoute(request);}if(request.operation==='apply'){applies++;return applies===1?pending.promise:success({commit:null,pageIds:[]});}return mergeRoute(request);}),output=await mergeView(ui);
  await mergeSelector(output).fire('submit');await mergeEditor(output).fire('submit');const approve=button(output,'批准并保存这次合并'),saving=approve.fire('click');await settle();await approve.fire('click');assert.equal(applies,1);assert.equal(named(output,'body').disabled,true);
  pending.resolve(failure('OPERATION_CANCELLED'));await saving;assert.match(output.textContent,/保存结果未确认/);assert.equal(applies,1);await button(output,'重试原签名方案').fire('click');assert.equal(applies,2);assert.equal(previews,2);
  const requests=ui.requests.filter(request=>request.operation==='apply');assert.deepEqual(requests[0]!.data,requests[1]!.data);assert.match(output.textContent,/本次没有新增提交/);
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

const experiencePlan = { name: 'normalize-ascii-labels', scope: 'user', sensitivity: 'internal',
  expiresAt: '2099-01-01T00:00:00.000Z', procedure: 'Trim and uppercase <script>untrusted()</script>', proof: 'signed', sources: [] };
const experienceValidation = { evidenceId: 'ev-123456789abc', passed: true, report: { results: [
  { caseId: 'case-1', status: 'completed', observed: '<script>observed()</script>', checks: [{ criterion: 'equal', passed: true }] },
] } };
const experienceFiles = { files: { 'SKILL.md': '---\nname: normalize-ascii-labels\n---\nPrivate body', 'references/validation.md': 'Exact selected checks.' } };
async function experienceView(ui: ReturnType<typeof harness>) { const output=await ui.run('experiences()') as Element;ui.app.append(output);return output; }
async function prepareExperience(output: Element) {
  const form=named(output,'traceIds').closest('form')!;
  for(const name of ['traceIds','name','description','procedure','conditions','limitations'])named(form,name).value=name==='traceIds'?'ev-111111111111\nev-222222222222':name;
  await form.fire('submit');await settle();
}
async function submitExperience(ui: ReturnType<typeof harness>, form: Element, accept=true) {
  const submitted=form.fire('submit');await settle();
  await button(ui.body,accept?'确认继续':'取消').fire('click');await submitted;await settle();
}

test('experience UI: no default evaluator, honest raw marker listing, opt-in and separate capture confirmation', async () => {
  const ui=harness(request=>request.operation==='experience-status'?success({evaluatorAvailable:false}):request.operation==='experience-records'?success({total:1,offset:0,limit:20,items:[{id:'ev-111111111111',scope:'user',sensitivity:'internal',snippet:'<script>notExecutable()</script>'}]}):success({evidenceId:'ev-222222222222'}));
  const output=await experienceView(ui);assert.match(output.textContent,/当前宿主未提供验证程序/);assert.equal(button(output,'确认运行宿主验证').disabled,true);
  assert.equal(ui.requests.length,1,'opening must not capture, validate, list private data or export');
  await button(output,'读取记录').fire('click');
  assert.deepEqual(ui.requests[1]!.data,{kind:'trace',offset:0,includeSensitive:false,includeSecret:false});assert.match(output.textContent,/列表标记不代表验证通过/);
  assert.match(output.textContent,/<script>notExecutable\(\)<\/script>/);
  await button(output,'加入候选来源').fire('click');assert.equal(named(output,'traceIds').value,'ev-111111111111');
  const capture=named(output,'family').closest('form')!;await submitExperience(ui,capture,false);assert.equal(ui.requests.length,2);
  await submitExperience(ui,capture);assert.equal(ui.requests[2]!.operation,'experience-capture');assert.match(output.textContent,/已保存经历：ev-222222222222/);
});

test('experience UI: exact candidate and case inputs, separate export, explicit downloads and edit invalidation', async () => {
  const ui=harness(request=>success(request.operation==='experience-status'?{evaluatorAvailable:true}:request.operation==='experience-prepare'?experiencePlan:request.operation==='experience-validate'?experienceValidation:experienceFiles));
  let downloads=0;ui.context.Blob=Blob;ui.context.URL={createObjectURL:()=>{downloads++;return 'blob:synthetic';},revokeObjectURL:()=>{}};
  const output=await experienceView(ui);await prepareExperience(output);
  assert.equal(button(output,'确认运行宿主验证').disabled,false);assert.match(output.textContent,/Trim and uppercase <script>untrusted\(\)<\/script>/);
  const form=named(output,'suiteName').closest('form')!;named(form,'suiteName').value='Independent checks';
  const checkFields=nodes(form).filter(node=>node.tagName==='fieldset');assert.equal(checkFields.length,4);
  assert.deepEqual(checkFields.map(item=>named(item,'category').value),['transfer','transfer','retention','safety']);
  for(const item of checkFields){named(item,'input').value='Input';named(item,'criteria').value='first criterion\nsecond criterion';}
  await submitExperience(ui,form,false);assert.equal(ui.requests.length,2);
  await submitExperience(ui,form);
  const validation=ui.requests.find(request=>request.operation==='experience-validate')!;
  assert.deepEqual(validation.data.plan,experiencePlan);assert.equal(validation.data.confirm,true);assert.equal(validation.data.suite.cases.length,4);
  assert.deepEqual(validation.data.suite.cases[0].criteria,['first criterion','second criterion']);assert.equal('runner' in validation.data,false);assert.equal('passed' in validation.data,false);
  assert.equal(named(output,'validationId').value,experienceValidation.evidenceId);assert.match(output.textContent,/不是通用能力保证/);
  assert.equal(ui.requests.some(request=>request.operation==='experience-export'),false,'validation never auto exports');
  const exportForm=named(output,'validationId').closest('form')!;await submitExperience(ui,exportForm,false);assert.equal(ui.requests.length,3);
  await submitExperience(ui,exportForm);assert.equal(downloads,0,'export is not automatic download');
  const download=button(output,'下载 SKILL.md');await download.fire('click');assert.equal(downloads,1);
  const proposal=named(output,'traceIds').closest('form')!;named(proposal,'procedure').value='Edited';await proposal.fire('input');
  assert.equal(button(output,'确认运行宿主验证').disabled,true);assert.equal(named(output,'validationId').value,'');assert.equal(nodes(output).includes(download),false);
  await download.fire('click');assert.equal(downloads,1,'detached old download cannot export a stale copy');
});

test('experience UI: stopped or navigation-late work cannot revive a plan or export controls, drafts stay intact', async () => {
  const pending=deferred<Response>();
  const ui=harness(request=>request.operation==='experience-status'?success({evaluatorAvailable:true}):pending.promise);
  const output=await experienceView(ui);await prepareExperience(output);
  const request=ui.requests.find(item=>item.operation==='experience-prepare')!;assert.equal(named(output,'procedure').disabled,true);
  await button(output,'停止当前操作').fire('click');assert.equal(request.signal?.aborted,true);assert.equal(named(output,'procedure').value,'procedure');
  pending.resolve(success(experiencePlan));await settle();assert.equal(button(output,'确认运行宿主验证').disabled,true);assert.doesNotMatch(output.textContent,/候选已生成/);
  const delayed=deferred<Response>();const other=harness(request=>request.operation==='experience-status'?success({evaluatorAvailable:true}):delayed.promise);
  const view=await experienceView(other);await prepareExperience(view);other.run('pageCleanup(); generation++');
  delayed.resolve(success(experiencePlan));await settle();assert.equal(button(view,'确认运行宿主验证').disabled,true);
});

test('experience UI: read-only identities, confidential selection and failures never offer installation or implicit retry', async () => {
  const reader=harness(request=>request.operation==='experience-status'?success({evaluatorAvailable:true}):failure('ENCRYPTION_KEY_UNAVAILABLE'),['read']);
  const output=await experienceView(reader);assert.equal(nodes(output).some(node=>node.name==='traceIds'),false);
  assert.equal(button(output,'确认运行宿主验证').disabled,true);assert.equal(button(output,'确认读取技能文件').disabled,true);
  await button(output,'读取记录').fire('click');assert.match(output.textContent,/未提供解密密钥/);assert.equal(reader.requests.length,2);
  const ui=harness(request=>success(request.operation==='experience-status'?{evaluatorAvailable:true}:request.operation==='experience-prepare'?experiencePlan:experienceFiles));
  ui.run("principal.maxSensitivity='secret'");const view=await experienceView(ui);await prepareExperience(view);
  named(view,'validationId').value='ev-123456789abc';await named(view,'validationId').fire('input');await submitExperience(ui,named(view,'validationId').closest('form')!);assert.ok(button(view,'下载 SKILL.md'));
  named(view,'includeSecret').checked=true;await named(view,'includeSecret').fire('change');assert.equal(named(view,'validationId').value,'');assert.equal(button(view,'确认运行宿主验证').disabled,true);
  assert.equal(nodes(view).some(node=>node.tagName==='button'&&node.textContent==='下载 SKILL.md'),false);
  assert.equal(ui.requests.some(request=>/install|execute/.test(request.operation)),false);
});

test('experience UI: navigation closes an unconfirmed dialog without starting validation', async () => {
  const ui=harness(request=>success(request.operation==='experience-status'?{evaluatorAvailable:true}:experiencePlan));
  const output=await experienceView(ui);await prepareExperience(output);
  const pending=named(output,'suiteName').closest('form')!.fire('submit');await settle();
  const dialog=find(ui.body,node=>node.tagName==='dialog');assert.equal(dialog.open,true);assert.match(dialog.textContent,/候选：normalize-ascii-labels/);
  ui.run('pageCleanup(); generation++');await pending;await settle();
  assert.equal(dialog.isConnected,false);assert.equal(ui.requests.some(request=>request.operation==='experience-validate'),false);
});

const availabilityReceipt = { evidenceId:'ev-0123456789ab', observedAt:'2030-01-01T00:00:00.123Z', observedCommit:'a'.repeat(40), pageKeys:['concept:labels'] };
const availabilityView = (body='Observed body <script>untrusted()</script>') => ({ at:availabilityReceipt.observedAt,coverage:{mode:'explicit-observation-ids'},warnings:['Partial observations only.'],items:[
  {key:'concept:labels',status:'observed',observationId:availabilityReceipt.evidenceId,observedAt:availabilityReceipt.observedAt,snapshot:{commit:availabilityReceipt.observedCommit,pages:[{body}],sources:[],rules:[]}},
  {key:'concept:unknown',status:'unknown',reason:'No observation.',snapshot:{body:'MUST_NOT_RENDER_UNKNOWN_BODY'}},
] });
async function availabilityPage(ui:ReturnType<typeof harness>){const output=await ui.run('availability()') as Element;ui.app.append(output);named(output,'availabilityKeys').value='concept:labels';return output;}
async function saveAvailability(ui:ReturnType<typeof harness>,output:Element,accept=true){const pending=button(output,'确认记录当前知识').fire('click');await settle();await button(ui.body,accept?'确认保存观察':'取消').fire('click');await pending;await settle();}

test('availability UI: no automatic observation, cancel-first confirmation and separate exact historical read',async()=>{
  const ui=harness(request=>success(request.operation==='wiki-observe'?availabilityReceipt:availabilityView()));const output=await availabilityPage(ui);
  assert.equal(ui.requests.length,0);await saveAvailability(ui,output,false);assert.equal(ui.requests.length,0);
  await saveAvailability(ui,output);assert.equal(ui.requests.length,1);assert.deepEqual(ui.requests[0]!.data,{pageKeys:['concept:labels'],includeSensitive:false,includeSecret:false,confirm:true});
  assert.match(output.textContent,/已保存观察/);assert.equal(ui.requests.some(request=>request.operation==='wiki-as-known-at'),false);
  await button(output,'只查本次观察').fire('click');await settle();
  assert.deepEqual(ui.requests[1]!.data,{pageKeys:['concept:labels'],includeSensitive:false,includeSecret:false,at:availabilityReceipt.observedAt,observationIds:[availabilityReceipt.evidenceId]});
  assert.match(output.textContent,/集合外的更新或冲突未排除/);assert.match(output.textContent,/<script>untrusted\(\)<\/script>/);assert.doesNotMatch(output.textContent,/MUST_NOT_RENDER_UNKNOWN_BODY/);
  assert.equal(nodes(output).some(node=>node.tagName==='script'),false);
  named(output,'availabilityAt').value='2031-01-01T00:00:00Z';await named(output,'availabilityAt').fire('input');
  assert.doesNotMatch(output.textContent,/Observed body/);assert.equal(nodes(output).some(node=>node.textContent==='只查本次观察'),false);assert.equal(ui.requests.length,2);
});

test('availability UI: stop and a newer read suppress old responses while keeping the current selection',async()=>{
  const pending=deferred<Response>();let reads=0;
  const ui=harness(()=>++reads===1?pending.promise:success(availabilityView('FRESH_RESULT'))),output=await availabilityPage(ui),keys=named(output,'availabilityKeys'),form=named(output,'availabilityAt').closest('form')!;
  await form.fire('submit');await settle();assert.equal(keys.disabled,true);const old=ui.requests[0]!;
  await button(output,'停止当前操作').fire('click');assert.equal(old.signal?.aborted,true);assert.equal(keys.value,'concept:labels');
  await form.fire('submit');await settle();assert.match(output.textContent,/FRESH_RESULT/);
  pending.resolve(success(availabilityView('STALE_RESULT')));await settle();assert.match(output.textContent,/FRESH_RESULT/);assert.doesNotMatch(output.textContent,/STALE_RESULT/);
  ui.run('pageCleanup();generation++');assert.equal(keys.value,'');assert.equal(output.children.length,0);
});

test('availability UI: navigation cancels an unconfirmed observation and no late read revives removed content',async()=>{
  const ui=harness(()=>success(availabilityReceipt)),output=await availabilityPage(ui),keys=named(output,'availabilityKeys');
  const unconfirmed=button(output,'确认记录当前知识').fire('click');await settle();const dialog=find(ui.body,node=>node.tagName==='dialog');assert.equal(dialog.open,true);
  ui.run('pageCleanup();generation++');await unconfirmed;await settle();assert.equal(dialog.isConnected,false);assert.equal(ui.requests.length,0);assert.equal(keys.value,'');
  const delayed=deferred<Response>(),other=harness(()=>delayed.promise),view=await availabilityPage(other);
  await named(view,'availabilityAt').closest('form')!.fire('submit');await settle();const request=other.requests[0]!;other.run('pageCleanup();session++;generation++');assert.equal(request.signal?.aborted,true);
  delayed.resolve(success(availabilityView('LATE_PRIVATE_RESULT')));await settle();assert.equal(view.children.length,0);assert.doesNotMatch(other.body.textContent,/LATE_PRIVATE_RESULT/);
});

test('availability UI: read-only selection, confidential flags and safe errors never auto-observe or retry',async()=>{
  const ui=harness(()=>failure('ENCRYPTION_KEY_UNAVAILABLE'),['read']);ui.run("principal.maxSensitivity='secret'");const output=await availabilityPage(ui);
  assert.equal(nodes(output).some(node=>node.tagName==='button'&&node.textContent==='确认记录当前知识'),false);
  named(output,'availabilitySecret').checked=true;await named(output,'availabilitySecret').fire('change');
  await named(output,'availabilityAt').closest('form')!.fire('submit');await settle();assert.equal(ui.requests.length,1);assert.equal(ui.requests[0]!.data.includeSecret,true);
  assert.equal(ui.requests[0]!.operation,'wiki-as-known-at');assert.match(output.textContent,/未提供解密密钥/);
  const saved=harness(()=>({ok:false,json:async()=>({error:{code:'AUTHORIZATION_DENIED',completedAvailability:{evidenceId:availabilityReceipt.evidenceId,commit:availabilityReceipt.observedCommit}}})}));
  const view=await availabilityPage(saved);await saveAvailability(saved,view);assert.match(view.textContent,/已保存观察（请先核查，勿重复提交）/);assert.equal(saved.requests.length,1);
  named(view,'availabilityKeys').value='concept:labels\nconcept:labels';await named(view,'availabilityKeys').fire('input');await named(view,'availabilityAt').closest('form')!.fire('submit');await settle();assert.equal(saved.requests.length,1);assert.match(view.textContent,/不同的页面名称/);
});

const sharedCatalog = {configured:true,sources:[
  {id:'team-one',title:'Team one <script>label()</script>',commit:'a'.repeat(40),scopes:['user'],maxSensitivity:'secret'},
  {id:'team-two',title:'Team two',commit:'b'.repeat(40),scopes:['user'],maxSensitivity:'internal'},
]};
function sharedResult(id='team-one',body='Shared old body <script>untrusted()</script>'){
  const source=sharedCatalog.sources.find(item=>item.id===id)!;return {kind:'shared-wiki-view',source:{id,title:source.title,commit:source.commit,vaultId:'shared-vault',tenantId:'shared-tenant'},warnings:['Offline plaintext cannot be recalled.'],snapshot:{commit:source.commit,pages:[{meta:{id:'wp-synthetic',type:'wiki-page',key:'concept:shared',title:'Shared page',revision:1,scope:'user',sensitivity:'internal',conditions:['Synthetic only'],uncertainty:['Not current advice']},body,currentRevision:2}],warnings:['Historical content, not current advice.']}};
}
async function sharedPage(ui:ReturnType<typeof harness>){const output=await ui.run('sharedWiki()') as Element;ui.app.append(output);await settle();return output;}

test('shared UI: opening reads only catalog; snapshots bind displayed pin and render literal complete content without writes',async()=>{
  const ui=harness(request=>success(request.operation==='shared-catalog'?sharedCatalog:sharedResult()),['read']);ui.run("principal.maxSensitivity='secret'");
  const output=await sharedPage(ui);assert.equal(ui.requests.length,1);assert.equal(ui.requests[0]!.operation,'shared-catalog');
  assert.equal(named(output,'sharedSource').value,'team-one');assert.match(output.textContent,/<script>label\(\)<\/script>/);
  named(output,'sharedKeys').value='concept:shared';named(output,'sharedSecret').checked=true;await named(output,'sharedSecret').fire('change');
  await named(output,'sharedKeys').closest('form')!.fire('submit');await settle();
  assert.deepEqual(ui.requests[1]!.data,{sourceId:'team-one',pageKeys:['concept:shared'],expectedCommit:'a'.repeat(40),includeSensitive:false,includeSecret:true});
  assert.match(output.textContent,/Shared old body <script>untrusted\(\)<\/script>/);assert.match(output.textContent,/保留版本 1 · 当前版本 2/);
  assert.equal(nodes(output).some(node=>node.tagName==='script'),false);assert.equal(ui.requests.some(request=>/apply|capture|import|merge|grant/.test(request.operation)),false);
  named(output,'sharedSource').value='team-two';await named(output,'sharedSource').fire('change');
  assert.doesNotMatch(output.textContent,/Shared old body/);assert.equal(named(output,'sharedSecret').checked,false);assert.equal(named(output,'sharedSecret').disabled,true);
});

test('shared UI: stale pin or mismatched source responses never render content or auto-retry',async()=>{
  for(const mismatch of ['pin','source']){
    const result=sharedResult();if(mismatch==='pin')result.source.commit='c'.repeat(40);else result.source.id='team-two';
    const ui=harness(request=>success(request.operation==='shared-catalog'?sharedCatalog:result)),output=await sharedPage(ui);
    named(output,'sharedKeys').value='concept:shared';await named(output,'sharedKeys').closest('form')!.fire('submit');await settle();
    assert.match(output.textContent,/固定提交已变化/);assert.doesNotMatch(output.textContent,/Shared old body/);assert.equal(ui.requests.length,2);
  }
});

test('shared UI: source changes, stop/new reads and leaving cannot revive late shared plaintext',async()=>{
  const delayed=deferred<Response>();let reads=0;
  const ui=harness(request=>request.operation==='shared-catalog'?success(sharedCatalog):++reads===1?delayed.promise:success(sharedResult('team-two','FRESH_SHARED'))),output=await sharedPage(ui);
  named(output,'sharedKeys').value='concept:shared';const form=named(output,'sharedKeys').closest('form')!;await form.fire('submit');await settle();const pending=ui.requests[1]!;
  await button(output,'停止当前操作').fire('click');assert.equal(pending.signal?.aborted,true);assert.equal(named(output,'sharedKeys').value,'concept:shared');
  named(output,'sharedSource').value='team-two';await named(output,'sharedSource').fire('change');await form.fire('submit');await settle();assert.match(output.textContent,/FRESH_SHARED/);
  delayed.resolve(success(sharedResult('team-one','LATE_SHARED_SECRET')));await settle();assert.doesNotMatch(output.textContent,/LATE_SHARED_SECRET/);assert.match(output.textContent,/FRESH_SHARED/);
  const keys=named(output,'sharedKeys');ui.run('pageCleanup();generation++');assert.equal(keys.value,'');assert.equal(output.children.length,0);
});

test('shared UI: cancelled catalog, unconfigured hosts and read failures keep snapshots disabled without grant controls',async()=>{
  const pending=deferred<Response>(),ui=harness(()=>pending.promise),output=await sharedPage(ui);
  assert.equal(button(output,'读取共享知识').disabled,true);await button(output,'停止当前操作').fire('click');pending.resolve(success(sharedCatalog));await settle();
  assert.equal(button(output,'读取共享知识').disabled,true);assert.doesNotMatch(output.textContent,/Team one/);
  const off=harness(()=>success({configured:false,sources:[]})),emptyView=await sharedPage(off);assert.match(emptyView.textContent,/宿主尚未配置/);assert.equal(button(emptyView,'读取共享知识').disabled,true);
  const failed=harness(request=>request.operation==='shared-catalog'?success(sharedCatalog):failure('ENCRYPTION_KEY_UNAVAILABLE')),view=await sharedPage(failed);
  named(view,'sharedKeys').value='concept:shared';await named(view,'sharedKeys').closest('form')!.fire('submit');await settle();assert.match(view.textContent,/未提供解密密钥/);assert.equal(failed.requests.length,2);
  assert.equal(nodes(view).some(node=>node.tagName==='button'&&/增加授权|批准|导入|合并/.test(node.textContent)),false);
});

test('shared UI: logout clears selected names and drafts and suppresses pending read responses',async()=>{
  const pending=deferred<Response>(),ui=harness(request=>request.operation==='shared-catalog'?success(sharedCatalog):pending.promise),output=await sharedPage(ui);
  const keys=named(output,'sharedKeys'),source=named(output,'sharedSource');keys.value='concept:shared';await keys.closest('form')!.fire('submit');await settle();const request=ui.requests[1]!;
  ui.run('logout()');assert.equal(request.signal?.aborted,true);assert.equal(keys.value,'');assert.equal(source.value,'');
  pending.resolve(success(sharedResult('team-one','AFTER_LOGOUT_SHARED_SECRET')));await settle();assert.doesNotMatch(ui.body.textContent,/AFTER_LOGOUT_SHARED_SECRET|Team one/);
});

const importArtifact={source:{id:'team-one',title:'Imported team <script>title()</script>',commit:'a'.repeat(40)},pages:[
 {key:'concept:shared',title:'Imported page',revision:1,scope:'user',sensitivity:'internal',body:'COMPLETE_IMPORTED_BODY <script>data()</script>',conditions:['Source condition'],uncertainty:['Unverified original']}],
 sources:[{id:'ev-original',sha256:'source-hash'}],rules:[{id:'rule-original',revision:1}],support:{conditions:['Current source condition']}};
const importPlan={kind:'shared-wiki-import-plan',proof:'signed-copy-proof',selection:{sourceId:'team-one',expectedCommit:'a'.repeat(40)},artifact:importArtifact,scope:'user',sensitivity:'internal'};
const integratedPlan={...plan,kind:'integrate',proof:'signed-integration-proof',integration:{evidenceId:'ev-123456789abc'}};
const integratedResult={plan:integratedPlan,comparison:{artifact:importArtifact,current:wikiDocument},preview:{...preview,kind:'integrate'}};
function importRoute(request:Request){return success(request.operation==='shared-catalog'?sharedCatalog:request.operation==='shared-import-prepare'?{plan:importPlan}
 :request.operation==='shared-import-apply'?{evidenceId:'ev-123456789abc',commit:'c'.repeat(40),duplicate:false}:request.operation==='integration-prepare'?integratedResult
 :request.operation==='preview'?integratedResult.preview:{pageIds:['wiki-result'],commit:'d'.repeat(40)});}
async function importsPage(ui:ReturnType<typeof harness>){const output=await ui.run('wikiImports()') as Element;ui.app.append(output);await settle();return output;}
async function prepareImportCopy(output:Element){named(output,'importKeys').value='concept:shared';await named(output,'importKeys').closest('form')!.fire('submit');await settle();}
async function prepareImportIntegration(output:Element){
 for(const [name,value] of Object.entries({importEvidenceId:'ev-123456789abc',integrationKey:'return-policy',integrationRevision:'2',integrationTitle:'Reviewed title',integrationSummary:'Human summary',integrationBody:'HUMAN_DRAFT <script>literal()</script>'}))named(output,name).value=value;
 await named(output,'integrationBody').closest('form')!.fire('submit');await settle();
}

test('import UI: opening only lists sources; full copy and human integration use two checked, separate approvals',async()=>{
 const ui=harness(importRoute),output=await importsPage(ui);assert.deepEqual(ui.requests.map(request=>request.operation),['shared-catalog']);
 await prepareImportCopy(output);assert.match(output.textContent,/COMPLETE_IMPORTED_BODY <script>data\(\)<\/script>/);assert.match(output.textContent,/Current source condition/);
 const copy=button(output,'确认复制为证据');assert.equal(copy.disabled,true);named(output,'copyChecked').checked=true;await named(output,'copyChecked').fire('change');
 ui.context.confirmResult=false;await copy.fire('click');assert.equal(ui.requests.length,2);ui.context.confirmResult=true;await copy.fire('click');await settle();
 assert.equal(ui.requests[2]!.operation,'shared-import-apply');assert.deepEqual(ui.requests[2]!.data,{plan:importPlan,confirm:true});
 assert.equal(named(output,'importEvidenceId').value,'ev-123456789abc');assert.equal(ui.requests.some(request=>request.operation==='integration-prepare'||request.operation==='apply'),false);
 await prepareImportIntegration(output);assert.match(output.textContent,/COMPLETE_IMPORTED_BODY/);assert.match(output.textContent,/旧政策|新政策/);assert.match(output.textContent,/受影响页面/);
 assert.equal(ui.requests[3]!.operation,'integration-prepare');assert.equal(ui.requests[3]!.data.body,'HUMAN_DRAFT <script>literal()</script>');assert.equal(ui.requests[4]!.operation,'preview');
 const approve=button(output,'批准并保存整合知识');assert.equal(approve.disabled,true);named(output,'integrationChecked').checked=true;await named(output,'integrationChecked').fire('change');
 await approve.fire('click');await settle();assert.deepEqual(ui.requests.slice(-2).map(request=>request.operation),['preview','apply']);assert.deepEqual(ui.requests.at(-1)!.data,{plan:integratedPlan,confirm:true});
 assert.match(output.textContent,/整合审核已完成/);assert.equal(nodes(output).some(node=>node.tagName==='script'),false);
});

test('import UI: source/classification edits and authored changes invalidate old approvals without automatic retry',async()=>{
 const ui=harness(importRoute),output=await importsPage(ui);await prepareImportCopy(output);named(output,'copyChecked').checked=true;await named(output,'copyChecked').fire('change');
 const copy=button(output,'确认复制为证据');named(output,'importSource').value='team-two';await named(output,'importSource').fire('change');assert.equal(copy.disabled,true);
 await copy.fire('click');assert.equal(ui.requests.some(request=>request.operation==='shared-import-apply'),false);
 await prepareImportIntegration(output);named(output,'integrationChecked').checked=true;await named(output,'integrationChecked').fire('change');
 const approval=button(output,'批准并保存整合知识');named(output,'integrationSensitivity').value='public';await named(output,'integrationSensitivity').fire('change');assert.equal(approval.disabled,true);assert.doesNotMatch(output.textContent,/COMPLETE_IMPORTED_BODY/);
 await approval.fire('click');assert.equal(ui.requests.some(request=>request.operation==='apply'),false);
 await prepareImportIntegration(output);named(output,'integrationBody').value='Edited after preview';await named(output,'integrationBody').fire('input');assert.equal(approval.disabled,true);assert.equal(named(output,'integrationBody').value,'Edited after preview');
});

test('import UI: late copy or integration responses cannot restore approvals after edits, stop, navigation or logout',async()=>{
 for(const operation of ['shared-import-prepare','integration-prepare'])for(const action of ['edit','stop','navigation','logout']){
  const pending=deferred<Response>(),ui=harness(request=>request.operation===operation?pending.promise:importRoute(request)),output=await importsPage(ui);
  const preparation=operation==='shared-import-prepare'?prepareImportCopy(output):prepareImportIntegration(output);await settle();
  const request=ui.requests.find(request=>request.operation===operation)!;assert.ok(request);
  if(action==='edit'){const input=named(output,operation==='shared-import-prepare'?'importKeys':'integrationBody');input.value='Changed while preparing';await input.fire('input');}
  else if(action==='stop')await button(output,'停止当前操作').fire('click');else ui.run(action==='logout'?'logout()':'pageCleanup();generation++');
  assert.equal(request.signal?.aborted,true);pending.resolve(success(operation==='shared-import-prepare'?{plan:importPlan}:integratedResult));await preparation;await settle();
  assert.doesNotMatch(ui.body.textContent,/COMPLETE_IMPORTED_BODY|signed-copy-proof|signed-integration-proof/);assert.equal(ui.requests.some(request=>request.operation==='shared-import-apply'||request.operation==='apply'),false);
 }
});

test('import UI: retained evidence works without sharing setup and read-only users cannot prepare or approve',async()=>{
 const ui=harness(request=>request.operation==='shared-catalog'?success({configured:false,sources:[]}):importRoute(request)),output=await importsPage(ui);
 assert.match(output.textContent,/已有的本机导入证据仍可/);assert.equal(button(output,'预览复制方案').disabled,true);
 await prepareImportIntegration(output);assert.ok(ui.requests.some(request=>request.operation==='integration-prepare'));assert.match(output.textContent,/COMPLETE_IMPORTED_BODY/);
 const read=harness(importRoute,['read']),view=await importsPage(read);assert.equal(button(view,'预览复制方案').disabled,true);assert.equal(button(view,'生成整合审核方案').disabled,true);
 await named(view,'importKeys').closest('form')!.fire('submit');await prepareImportIntegration(view);assert.deepEqual(read.requests.map(request=>request.operation),['shared-catalog']);
});

test('import UI: exact explicit retry retains the original integration plan after uncertain application and clears on edit',async()=>{
 let applies=0;const ui=harness(request=>request.operation==='apply'&&++applies===1?failure('OPERATION_CANCELLED'):importRoute(request)),output=await importsPage(ui);
 await prepareImportIntegration(output);named(output,'integrationChecked').checked=true;await named(output,'integrationChecked').fire('change');await button(output,'批准并保存整合知识').fire('click');await settle();
 assert.match(output.textContent,/保存结果未确认/);const before=ui.requests.length;await button(output,'重试原整合方案').fire('click');await settle();
 assert.equal(ui.requests.length,before+1);assert.equal(ui.requests.at(-1)!.operation,'apply');assert.deepEqual(ui.requests.at(-1)!.data.plan,integratedPlan);assert.match(output.textContent,/整合审核已完成/);
});

test('import UI: source mismatch, key errors and completed-copy identifiers remain literal and never auto-confirm',async()=>{
 const stale=harness(request=>request.operation==='shared-import-prepare'?success({plan:{...importPlan,selection:{...importPlan.selection,expectedCommit:'b'.repeat(40)}}}):importRoute(request)),output=await importsPage(stale);
 await prepareImportCopy(output);assert.match(output.textContent,/来源或固定提交已变化/);assert.equal(button(output,'确认复制为证据').disabled,true);assert.doesNotMatch(output.textContent,/COMPLETE_IMPORTED_BODY/);
 const ui=harness(request=>request.operation==='shared-import-apply'?{ok:false,json:async()=>({error:{code:'AUTHORIZATION_DENIED',completedImport:{evidenceId:'ev-123456789abc',commit:'c'.repeat(40),duplicate:false}}})}:importRoute(request)),view=await importsPage(ui);
 await prepareImportCopy(view);named(view,'copyChecked').checked=true;await named(view,'copyChecked').fire('change');await button(view,'确认复制为证据').fire('click');await settle();
 assert.match(view.textContent,/已保留导入证据（请先核查）/);assert.equal(ui.requests.length,3);assert.equal(named(view,'importEvidenceId').value,'');assert.equal(button(view,'重试原复制方案').disabled,false);
});
