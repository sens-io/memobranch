import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { LlmClient } from '../src/llm.js';
import { MemoryVault } from '../src/vault.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { searchVault } from '../src/search.js';
import { wikiPageId, wikiPagePath } from '../src/wiki-schema.js';
import { renderPublicWikiCatalog } from '../src/wiki.js';
import type { WikiPageDraft, WikiPageMeta } from '../src/wiki-types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
type Operation = 'navigate' | 'compile' | 'query' | 'lint';
type Input = { catalog?: Array<{ key: string }>; sources?: Array<{ id: string; body: string }>; pages?: Array<WikiPageMeta & { body: string }> };
class ReviewClient extends LlmClient {
  calls: Operation[] = [];
  hook?: (operation: Operation, input: Input, output: unknown) => unknown | Promise<unknown>;
  constructor() { super({ apiKey: 'fixture', model: 'review-regression', embeddingModel: '' }); }
  override async wiki<T = unknown>(operation: Operation, value: object): Promise<T> {
    this.calls.push(operation);
    const input = value as Input;
    let output: unknown;
    if (operation === 'navigate') output = { keys: input.catalog!.map((entry) => entry.key) };
    else if (operation === 'query') output = { answer: 'Supported Marker answer.', citations: input.pages!.map((page) => page.key), uncertainty: [] };
    else if (operation === 'lint') output = { suggestions: [] };
    else {
      const sources = input.sources!;
      const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string): WikiPageDraft => ({ key, pageType, title: 'Marker page', summary: 'Marker summary', body, evidenceIds: sources.map((source) => source.id), links: [], conditions: [], uncertainty: [], status: 'active' });
      output = { pages: [
        ...sources.map((source) => draft(`source:${source.id}`, 'source', source.body)),
        draft('entity:marker', 'entity', `${input.pages?.find((page) => page.key === 'entity:marker')?.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0] ?? ''}\n${sources.map((source) => source.body).join('\n')}`),
      ] };
    }
    return (this.hook ? await this.hook(operation, input, output) : output) as T;
  }
}

async function fixture(compiled = false) {
  const root = await mkdtemp(join(tmpdir(), 'wiki-review-regression-')); roots.push(root);
  const llm = new ReviewClient();
  const vault = new MemoryVault(root, { llm });
  await vault.initialize('review-regression');
  const source = await vault.capture({ content: 'Marker first evidence.', scope: 'public', sensitivity: 'public' });
  if (compiled) await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
  return { vault, llm, source };
}

async function canonical(vault: MemoryVault): Promise<string> {
  return `${await vault.git.run(['rev-parse', 'HEAD'])}\n${await vault.git.run(['status', '--porcelain=v1'])}\n${await readFile(join(vault.root, 'log.md'), 'utf8')}`;
}

async function alterConfig(vault: MemoryVault): Promise<void> {
  const path = join(vault.root, 'agent-memory.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.limits.maxContextCharacters = 500;
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

test('I05: duplicate provider targets are rejected before expansion without a write', async () => {
  const { vault, llm, source } = await fixture();
  llm.hook = (_operation, _input, output) => {
    const response = output as { pages: WikiPageDraft[] };
    return { pages: [...response.pages, { ...response.pages[0]!, body: 'Silently overwritten body' }] };
  };
  const before = await canonical(vault);
  await assert.rejects(vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true }), /Duplicate Wiki target/);
  assert.equal(await canonical(vault), before);
  assert.deepEqual(await vault.wikiCatalog(), []);
});

test('I01 I07 I08: incremental non-link dependencies use actual committed revisions and ignore unconsulted raw capture', async () => {
  const { vault, llm, source } = await fixture(true);
  const second = await vault.capture({ content: 'Marker second evidence.', scope: 'public', sensitivity: 'public' });
  const before = await canonical(vault);
  const requests = llm.calls.length;
  assert.equal((await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true })).duplicate, true);
  assert.equal(llm.calls.length, requests, 'uncompiled raw capture was not consulted by the earlier compiler');
  assert.equal(await canonical(vault), before);
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const pages = await vault.wikiCatalog();
  for (const item of pages) {
    const page = await vault.get(item.id);
    for (const [key, revision] of Object.entries(page.meta.dependencies as Record<string, number>)) assert.equal(revision, pages.find((target) => target.key === key)?.revision, `${item.key} -> ${key}`);
  }
  assert.ok(!(await vault.wikiLint()).issues.some((issue) => issue.kind === 'stale'));
  assert.equal((await vault.doctor()).healthy, true);
});

test('W04 L02: built-in rules and actual inspected page revisions survive ingest, answer and lint', async () => {
  const { vault, llm, source } = await fixture(true);
  const page = (await vault.wikiCatalog()).find((item) => item.key === 'entity:marker')!;
  const expected = { 'builtin-wiki-rules-v1': 1 };
  assert.deepEqual((await vault.get(page.id)).meta.rules, expected);
  const answer = await vault.wikiQuery('Marker?');
  assert.deepEqual(answer.ruleIds, Object.keys(expected));
  assert.deepEqual(answer.ruleVersions, expected);
  llm.hook = (operation, _input, output) => operation === 'lint' ? { suggestions: [{ kind: 'gap', message: 'Measure throughput.', pageKeys: [page.key], evidenceIds: [source.evidenceId] }] } : output;
  const result = await vault.wikiLint({ semantic: true });
  assert.equal(result.semantic, 'available');
  assert.deepEqual(result.ruleVersions, expected);
  assert.deepEqual(result.issues.find((issue) => issue.kind === 'gap')?.pageVersions, { [page.key]: page.revision });
  const filed = await vault.wikiFile(answer, { title: 'Marker analysis', apply: true });
  assert.deepEqual(filed.plan.ruleIds, Object.keys(expected));
  assert.deepEqual((await vault.get(wikiPageId(filed.plan.query!.key))).meta.rules, expected);
});

test('L03: a late invalid semantic suggestion discards earlier uncommitted semantic suggestions', async () => {
  const { vault, llm, source } = await fixture(true);
  const before = await canonical(vault);
  llm.hook = (operation, _input, output) => operation === 'lint' ? { suggestions: [
    { kind: 'gap', message: 'First suggestion.', pageKeys: ['entity:marker'], evidenceIds: [source.evidenceId] },
    { kind: 'gap', message: 'Fabricated suggestion.', pageKeys: ['entity:absent'], evidenceIds: [] },
  ] } : output;
  const result = await vault.wikiLint({ semantic: true });
  assert.equal(result.semantic, 'failed');
  assert.ok(!result.issues.some((issue) => issue.message.includes('suggestion.')));
  assert.deepEqual(result.plans, []);
  assert.equal(await canonical(vault), before);
});

test('I06 G01: config changed during navigation prevents the next provider dispatch', async () => {
  const { vault, llm } = await fixture(true);
  const source = await vault.capture({ content: 'Marker changed source.', scope: 'public', sensitivity: 'public' });
  let intervening = '';
  llm.hook = async (operation, _input, output) => {
    if (operation === 'navigate') { await alterConfig(vault); intervening = await canonical(vault); }
    return output;
  };
  const calls = llm.calls.length;
  await assert.rejects(vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true }), /configuration changed/);
  assert.deepEqual(llm.calls.slice(calls), ['navigate']);
  assert.equal(await canonical(vault), intervening);
});

test('I06 Q04: signed pending plans and answers are invalidated by changed configuration', async () => {
  const { vault, source } = await fixture(true);
  const plan = (await vault.wikiIngest({ evidenceIds: [source.evidenceId, (await vault.capture({ content: 'Another Marker input.', scope: 'public', sensitivity: 'public' })).evidenceId] })).plan!;
  const answer = await vault.wikiQuery('Marker?');
  await alterConfig(vault);
  const before = await canonical(vault);
  await assert.rejects(vault.wikiApply(plan), /configuration changed/);
  await assert.rejects(vault.wikiFile(answer, { title: 'Stale configuration answer', apply: true }), /configuration changed/);
  assert.equal(await canonical(vault), before);
});

test('S05 Q01: support that expires during the answer request cannot be returned or sealed', async () => {
  const { vault, llm } = await fixture(true);
  const expiresAt = new Date(Date.now() + 800).toISOString();
  for (const page of await vault.wikiCatalog()) {
    const path = join(vault.root, page.path);
    const doc = parseMarkdown<WikiPageMeta>(await readFile(path, 'utf8'));
    await writeFile(path, serializeMarkdown({ ...doc.meta, expiresAt }, doc.body));
  }
  llm.hook = async (operation, _input, output) => {
    if (operation === 'query') await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(expiresAt) - Date.now()) + 30));
    return output;
  };
  const before = await canonical(vault);
  await assert.rejects(vault.wikiQuery('Marker?'), /lifecycle changed/);
  assert.deepEqual(await vault.wikiCatalog(), []);
  assert.equal(await canonical(vault), before);
});

test('W03 S10: imported source identity must resolve to an attributed immutable input', async () => {
  const { vault, source } = await fixture(true);
  const original = await vault.get(wikiPageId(`source:${source.evidenceId}`));
  const key = 'source:ev-ffffffffffff';
  const path = wikiPagePath(key);
  await writeFile(join(vault.root, path), serializeMarkdown({ ...original.meta, key, id: wikiPageId(key) }, original.body));
  assert.ok(!(await vault.wikiCatalog()).some((entry) => entry.key === key));
  await assert.rejects(vault.get(wikiPageId(key)), /unavailable/);
  assert.ok((await vault.wikiLint()).issues.some((issue) => issue.kind === 'missing-source' && issue.pageKeys.includes(key)));
  assert.equal((await vault.doctor()).healthy, false);
});

test('I05 L01: all rendered local Markdown targets are checked, not only md suffixes', async () => {
  const { vault, llm, source } = await fixture();
  const before = await canonical(vault);
  const invalid = [
    '[key](../../.amem/wiki-proof-key)', '[missing](../../absent.txt)', '[outside](../../../outside/config)',
    '[ref][target]\n\n[target]: ../../.amem/wiki-proof-key', '[target][]\n\n[target]: ../../absent.txt',
    '[target]\n\n[target]: ../../../outside/config', '![image](../../absent.png)',
    '[encoded](%2e%2e/%2e%2e/.amem/wiki-proof-key)', '[entity](&#46;&#46;/&#46;&#46;/.amem/wiki-proof-key)',
    '[file](file:///tmp/private)', '[script](javascript:alert%281%29)', '<a href="../../.amem/wiki-proof-key">key</a>',
  ];
  for (const body of invalid) {
    llm.hook = (_operation, _input, output) => { const result = output as { pages: WikiPageDraft[] }; result.pages[0]!.body = body; return result; };
    await assert.rejects(vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true }), /Markdown|link/, body);
    assert.equal(await canonical(vault), before);
  }
  llm.hook = (_operation, _input, output) => {
    const result = output as { pages: WikiPageDraft[] };
    result.pages[0]!.body = `[raw][evidence]\n\n[evidence]: ../../${source.evidencePath} "Read evidence"\n\n[web](https://example.com/source)\n\n\`[example](../../absent.txt)\``;
    return result;
  };
  assert.ok((await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true })).commit);
  assert.equal((await vault.doctor()).healthy, true);
});

test('L01: altered and missing persisted catalog are diagnosed without repair', async () => {
  const { vault } = await fixture(true);
  const path = join(vault.root, 'WIKI.md');
  const good = await readFile(path, 'utf8');
  assert.ok(!(await vault.wikiLint()).issues.some((issue) => issue.kind === 'catalog-mismatch'));
  await writeFile(path, '# Wiki\n\n[missing](wiki/pages/absent.md)\n');
  const bad = await readFile(path, 'utf8');
  assert.ok((await vault.wikiLint()).issues.some((issue) => issue.kind === 'catalog-mismatch'));
  assert.equal((await vault.doctor()).healthy, false);
  assert.equal(await readFile(path, 'utf8'), bad);
  await unlink(path);
  assert.ok((await vault.wikiLint()).issues.some((issue) => issue.kind === 'catalog-mismatch'));
  await writeFile(path, good);
  assert.equal((await vault.doctor()).healthy, true);
});

test('W03 L01: imported invalid body links are excluded from both authenticated and public projections', async () => {
  const { vault, source } = await fixture(true);
  const document = await vault.get(wikiPageId(`source:${source.evidenceId}`));
  const body = `${document.body}\n\n[private file](../../.amem/wiki-proof-key)`;
  await writeFile(join(vault.root, document.path), serializeMarkdown(document.meta, body));
  assert.ok(!(await vault.wikiCatalog()).some((page) => page.id === document.meta.id));
  assert.ok((await vault.wikiLint()).issues.some((issue) => issue.kind === 'unavailable-link'));
  const evidence = await vault.get(source.evidenceId);
  const projected = renderPublicWikiCatalog([{ ...document, body }, evidence]);
  assert.ok(!projected.includes(`./${document.path}`));
  assert.equal((await vault.doctor()).healthy, false);
});

test('W06: standalone public search uses the same compiled-page read and lifecycle boundary', async () => {
  const { vault } = await fixture(true);
  const exported = await searchVault(vault.root, 'Marker');
  assert.deepEqual(exported.map((hit) => hit.id), (await vault.search('Marker')).map((hit) => hit.id));
  assert.ok(exported.some((hit) => hit.kind === 'entity'));
  await vault.wikiRevoke('entity:marker', 'Retired');
  assert.ok(!(await searchVault(vault.root, 'Marker')).some((hit) => hit.id === wikiPageId('entity:marker')));
});
