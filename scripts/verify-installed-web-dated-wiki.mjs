// Runs the installed server's actual browser asset against its authenticated HTTP
// routes in a small DOM. Rendering is verified separately in a real browser.
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';

class Element {
  children = []; parent = null; className = ''; name = ''; type = ''; value = '';
  disabled = false; required = false; checked = false; root = false; ownText = '';
  attributes = new Map(); listeners = new Map(); dataset = {};
  classList = { add: (...names) => { this.className = [this.className, ...names].filter(Boolean).join(' '); },
    contains: name => this.className.split(' ').includes(name) };
  constructor(tagName) { this.tagName = tagName; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.ownText = String(value); this.children.forEach(child => { child.parent = null; }); this.children = []; }
  get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
  append(...children) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.textContent = ''; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(type, listener) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]); }
  async fire(type) { if (type === 'click' && this.disabled) return; for (const listener of this.listeners.get(type) ?? []) await listener({ preventDefault() {}, stopPropagation() {} }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) { return nodes(this).slice(1).filter(node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector); }
  closest(selector) { return this.tagName === selector ? this : this.parent?.closest(selector) ?? null; }
  focus() {}
}
const nodes = node => [node, ...node.children.flatMap(nodes)];
function find(node, predicate) { const value = nodes(node).find(predicate); assert.ok(value, 'expected installed UI control'); return value; }
const named = (node, name) => find(node, item => item.name === name);
const button = (node, text) => find(node, item => item.tagName === 'button' && item.textContent === text);

export async function verifyInstalledWebDatedWiki(web, example, at) {
  const response = await fetch(web.url + '/app.js'); assert.equal(response.status, 200); const script = await response.text();
  const session = await fetch(web.url + '/api/session', { method: 'POST', headers: {
    Origin: web.url, Authorization: 'Bearer ' + web.token, 'Content-Type': 'application/json',
  }, body: '{}' }); assert.equal(session.status, 200);
  const identity = (await session.json()).result.principal;
  const body = new Element('body'); body.root = true; const app = new Element('div'), notice = new Element('div'); body.append(app, notice);
  const requests = [], document = { body, getElementById: id => id === 'app' ? app : notice, createElement: tag => new Element(tag),
    createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; }, querySelectorAll: selector => body.querySelectorAll(selector) };
  const context = createContext({ document, AbortController, setTimeout: () => 0, clearTimeout() {}, confirmResult: true,
    confirm: () => context.confirmResult, fixtureToken: web.token, fixtureIdentity: identity,
    fetch: async (url, init) => {
      requests.push({ operation: url.replace('/api/', ''), data: JSON.parse(init.body) });
      return fetch(web.url + url, { ...init, headers: { ...init.headers, Origin: web.url } });
    } });
  try {
    runInContext(script, context); runInContext('token=fixtureToken;principal=fixtureIdentity;', context);
    const output = await runInContext('merges()', context); app.append(output);
    const selector = nodes(output).filter(node => node.tagName === 'form')[0], editor = nodes(output).filter(node => node.tagName === 'form')[1];
    const mode = named(output, 'historySelector'), date = named(output, 'at'), commit = named(output, 'fromCommit');
    assert.equal(mode.value, 'commit'); assert.equal(date.disabled, true); assert.equal(commit.required, true);
    mode.value = 'at'; await mode.fire('change'); commit.value = 'INACTIVE_VALUE_MUST_NOT_BE_SENT';
    assert.equal(commit.disabled, true); assert.equal(commit.required, false); assert.equal(date.required, true); assert.equal(date.disabled, false);
    date.value = '2026-02-30T12:00:00Z'; await date.fire('input'); await selector.fire('submit');
    assert.match(output.textContent, /VALIDATION_FAILED/); assert.equal(button(output, '生成合并审核方案').disabled, true);
    assert.equal(nodes(output).some(node => node.classList.contains('recorded-selection')), false);
    date.value = at; await date.fire('input'); const start = requests.length; await selector.fire('submit');
    const pageKey = (await example.vault.wikiCatalog()).find(page => page.pageType === 'entity').key;
    const reads = requests.slice(start); assert.equal(reads.length, 2);
    assert.deepEqual(reads[0], { operation: 'wiki-snapshot', data: { at, pageKeys: [pageKey], includeSensitive: false, includeSecret: false } });
    assert.equal('at' in reads[1].data, false); assert.equal(reads[1].data.commit, await example.vault.git.run(['rev-parse', 'HEAD']));
    assert.match(output.textContent, /请求时刻（UTC）：2026-01-15T00:00:00.000Z/);
    assert.match(output.textContent, /选中提交者时间：2026-01-10T00:00:00.000Z/); assert.ok(output.textContent.includes(example.versions[0].commit));
    assert.ok(output.textContent.includes(example.versions[0].body)); assert.match(output.textContent, /Git 时间可被改写/);
    named(output, 'body').value += '\n\nExplicit human amendment 中文 🧠.'; await named(output, 'body').fire('input');
    await editor.fire('submit'); const prepare = requests.find(request => request.operation === 'merge-prepare'); assert.ok(prepare);
    assert.equal(prepare.data.fromCommit, example.versions[0].commit); assert.equal('at' in prepare.data, false); assert.equal('historySelector' in prepare.data, false);
    const plan = requests.find(request => request.operation === 'preview').data.plan; assert.equal(plan.merge.fromCommit, example.versions[0].commit);
    assert.match(output.textContent, /日期已解析为实际提交/); assert.equal(requests.some(request => request.operation === 'apply'), false);
    const approve = button(output, '批准并保存这次合并'); context.confirmResult = false; await approve.fire('click');
    assert.equal(requests.some(request => request.operation === 'apply'), false);
    const draft = named(output, 'body').value, count = requests.length; date.value = '2026-01-16T00:00:00Z'; await date.fire('input');
    assert.equal(nodes(output).some(node => node.classList.contains('recorded-selection')), false); assert.equal(named(output, 'body').value, draft);
    assert.equal(button(output, '生成合并审核方案').disabled, true); await approve.fire('click'); await selector.fire('submit'); assert.equal(requests.length, count);
    context.confirmResult = true; mode.value = 'commit'; await mode.fire('change'); commit.value = example.versions[0].commit; await commit.fire('input');
    const hashStart = requests.length; await selector.fire('submit'); assert.equal(requests.length, hashStart + 2);
    assert.equal('at' in requests[hashStart].data, false); assert.equal(requests[hashStart].data.commit, example.versions[0].commit);
    assert.equal(nodes(output).some(node => node.classList.contains('recorded-selection')), false);
    runInContext('pageCleanup(); generation++;', context); assert.equal(output.textContent, ''); assert.equal(date.value, '');
    console.log('Installed Web asset: real authenticated HTTP, exclusive date/hash UI handlers, invalid dates, complete resolved text, hash-bound signed preparation, cancelled confirmation, stale approval refusal and cleanup passed (small DOM; no browser-rendering or automatic-write claim).');
  } finally { runInContext("pageCleanup();token='';principal=null;", context); }
}
