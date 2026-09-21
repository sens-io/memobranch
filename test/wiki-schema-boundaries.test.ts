import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { serializeMarkdown } from '../src/markdown.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId, wikiPagePath } from '../src/wiki-schema.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

const roots: string[] = [];
const canary = 'SCHEMA_BOUNDARY_UNTRUSTED_CANARY';
const entityKey = 'entity:schema-control';
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

type Operation = 'navigate' | 'compile' | 'query' | 'lint';
type RecordValue = Record<string, unknown>;
type Response = { pages: RecordValue[]; [key: string]: unknown };
class SchemaClient extends LlmClient {
  calls: Array<{ operation: Operation; input: object }> = [];
  mutate?: (response: Response) => void;
  constructor() { super({ apiKey: 'fixture', model: 'schema-boundaries', embeddingModel: '' }); }
  override async wiki<T = unknown>(operation: Operation, input: object): Promise<T> {
    this.calls.push({ operation, input });
    const value = input as { catalog?: Array<{ key: string }>; sources?: Array<{ id: string; body: string }> };
    if (operation === 'navigate') return { keys: value.catalog!.map((page) => page.key) } as T;
    if (operation === 'lint') return { suggestions: [] } as T;
    if (operation === 'query') return { answer: 'Schema control is supported.', citations: [entityKey], uncertainty: [] } as T;
    const sources = value.sources!;
    const draft = (key: string, pageType: WikiPageDraft['pageType']): RecordValue => ({
      key, pageType, title: 'Schema control', summary: 'Supported boundary control.', body: 'Schema control has immutable evidence.',
      evidenceIds: sources.map((source) => source.id), links: [], status: 'active', conditions: [], uncertainty: [],
    });
    const response: Response = { pages: [...sources.map((source) => draft(`source:${source.id}`, 'source')), draft(entityKey, 'entity')] };
    this.mutate?.(response);
    return response as T;
  }
}

async function fixture(compiled = false) {
  const root = await mkdtemp(join(tmpdir(), 'wiki-schema-boundaries-')); roots.push(root);
  const llm = new SchemaClient();
  const vault = new MemoryVault(root, { llm });
  await vault.initialize('schema-boundaries');
  const source = await vault.capture({ content: 'Schema control has immutable evidence.', scope: 'public', sensitivity: 'public' });
  if (compiled) await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
  return { vault, llm, source };
}

// Read actual files and the shadow repository, including untracked canonical files.
// Runtime caches, proof keys and metrics are deliberately outside canonical knowledge.
async function canonical(vault: MemoryVault) {
  const files: Array<[string, string, string]> = [];
  const visit = async (relative = ''): Promise<void> => {
    for (const entry of (await readdir(join(vault.root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!relative && ['.amem', '.git'].includes(entry.name)) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) files.push([path, 'symlink', await readlink(join(vault.root, path))]);
      else if (entry.isDirectory()) await visit(path);
      else files.push([path, 'file', (await readFile(join(vault.root, path))).toString('base64')]);
    }
  };
  await visit();
  return {
    head: await vault.git.run(['rev-parse', 'HEAD']),
    index: await vault.git.run(['ls-files', '--stage']),
    status: await vault.git.run(['status', '--porcelain=v1', '--untracked-files=all']),
    files,
  };
}

function rejection(code = 'VALIDATION_FAILED') {
  return (error: unknown): boolean => {
    assert.ok(error instanceof AgentMemoryError, 'public boundary must return a typed error');
    assert.equal(error.code, code);
    assert.ok(!JSON.stringify(error).includes(canary), 'validation must not echo untrusted content');
    assert.ok(!error.message.includes(canary));
    return true;
  };
}

const many = (prefix: string, count = 101) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
const evidenceIds = () => Array.from({ length: 101 }, (_, index) => `ev-${index.toString(16).padStart(12, '0')}`);
type DraftCase = { name: string; mutate: (response: Response) => void };
const draftField = (name: string, field: string, value: unknown): DraftCase => ({ name, mutate: (response) => { response.pages[1]![field] = value; } });
const draftCases: DraftCase[] = [
  { name: 'unknown response field', mutate: (response) => { response.instructions = canary; } },
  draftField('unknown destination traversal', 'path', `../../${canary}.md`),
  draftField('unknown absolute destination', 'path', `/tmp/${canary}.md`),
  draftField('unknown evidence deletion operation', 'delete', `evidence/${canary}.md`),
  draftField('unknown revision field', 'revision', 100),
  draftField('unknown page purpose', 'pageType', canary),
  draftField('invalid draft status', 'status', 'approved'),
  draftField('wrong title type', 'title', { text: canary }),
  draftField('wrong body type', 'body', [canary]),
  draftField('wrong evidence collection type', 'evidenceIds', 'ev-123456789abc'),
  draftField('null conditions', 'conditions', null),
  { name: 'targets collide after trimming', mutate: (response) => { response.pages.push({ ...response.pages[1], key: ` ${entityKey} ` }); } },
  draftField('links collide after trimming', 'links', [entityKey, ` ${entityKey} `]),
  ...['__proto__', 'constructor', 'prototype'].map((key) => draftField(`forbidden target ${key}`, 'key', key)),
  draftField('forbidden related key', 'links', ['__proto__']),
  draftField('malformed evidence identifier', 'evidenceIds', [`ev-${canary}`]),
  draftField('missing immutable source', 'evidenceIds', []),
  draftField('nonexistent immutable source', 'evidenceIds', ['ev-ffffffffffff']),
  draftField('nonexistent related page', 'links', [`entity:${canary}`]),
  draftField('invalid expiry', 'expiresAt', 'tomorrow'),
  draftField('oversized key', 'key', 'k'.repeat(201)),
  draftField('oversized title', 'title', 't'.repeat(301)),
  draftField('oversized summary', 'summary', 's'.repeat(2001)),
  draftField('oversized body', 'body', 'b'.repeat(100_001)),
  draftField('oversized condition', 'conditions', ['c'.repeat(4001)]),
  draftField('oversized uncertainty', 'uncertainty', ['u'.repeat(4001)]),
  draftField('too many evidence references', 'evidenceIds', evidenceIds()),
  draftField('too many links', 'links', many('entity:target-')),
  draftField('too many conditions', 'conditions', many('condition-')),
  draftField('too many uncertainty entries', 'uncertainty', many('uncertain-')),
  { name: 'empty page collection', mutate: (response) => { response.pages = []; } },
  { name: 'too many pages', mutate: (response) => { response.pages.push(...many('entity:extra-', 39).map((key) => ({ ...response.pages[1], key }))); } },
];

test('I05: public ingest rejects malformed and over-budget provider drafts before any canonical mutation', async (t) => {
  for (const entry of draftCases) await t.test(entry.name, async () => {
    const { vault, llm, source } = await fixture();
    llm.mutate = entry.mutate;
    const before = await canonical(vault);
    await assert.rejects(vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true }), rejection());
    const reopened = new MemoryVault(vault.root, { llm });
    assert.deepEqual(await canonical(reopened), before);
    assert.deepEqual(await reopened.wikiCatalog(), []);
  });
});

test('I05: public apply rejects malformed serialized plans with all files and Git state intact', async (t) => {
  const cases: Array<{ name: string; mutate: (plan: RecordValue) => void }> = [
    { name: 'future plan version', mutate: (plan) => { plan.version = 2; } },
    { name: 'unknown plan field', mutate: (plan) => { plan.instructions = canary; } },
    { name: 'unknown kind', mutate: (plan) => { plan.kind = canary; } },
    { name: 'malformed config hash', mutate: (plan) => { plan.configHash = canary; } },
    { name: 'traversing snapshot path', mutate: (plan) => { plan.snapshot = { [`evidence/../../${canary}.md`]: 'a'.repeat(64) }; } },
    { name: 'absolute snapshot path', mutate: (plan) => { plan.snapshot = { [`/tmp/${canary}.md`]: 'a'.repeat(64) }; } },
    { name: 'evidence overwrite field', mutate: (plan) => { plan.writes = [{ path: `evidence/${canary}.md`, body: canary }]; } },
    { name: 'unknown rule reference', mutate: (plan) => { plan.ruleIds = [canary]; } },
    { name: 'malformed source reference', mutate: (plan) => { plan.sourceIds = [canary]; } },
    { name: 'too many snapshot entries', mutate: (plan) => { plan.snapshot = Object.fromEntries(many('evidence/source-', 2001).map((key) => [`${key}.md`, 'a'.repeat(64)])); } },
    { name: 'too many context keys', mutate: (plan) => { plan.contextKeys = many('entity:context-'); } },
    { name: 'forbidden context key', mutate: (plan) => { plan.contextKeys = ['constructor']; } },
    ...['expectedRevisions', 'relevantPageVersions', 'ruleVersions', 'sourceHashes'].flatMap((field) => [
      { name: `missing ${field}`, mutate: (plan: RecordValue) => { delete plan[field]; } },
      { name: `invalid ${field} collection`, mutate: (plan: RecordValue) => { plan[field] = []; } },
      { name: `forbidden ${field} key`, mutate: (plan: RecordValue) => { plan[field] = { constructor: field === 'sourceHashes' ? 'a'.repeat(64) : 1 }; } },
      { name: `invalid ${field} value`, mutate: (plan: RecordValue) => { const values = plan[field] as RecordValue; values[Object.keys(values)[0] ?? 'entity:absent'] = field === 'sourceHashes' ? canary : -1; } },
    ]),
    ...draftCases.filter((entry) => entry.name !== 'unknown response field').map((entry) => ({ name: entry.name, mutate: (plan: RecordValue) => { entry.mutate(plan as Response); } })),
  ];
  for (const entry of cases) await t.test(entry.name, async () => {
    const { vault, llm, source } = await fixture();
    const prepared = (await vault.wikiIngest({ evidenceIds: [source.evidenceId] })).plan!;
    const before = await canonical(vault);
    const malformed = structuredClone(prepared) as unknown as RecordValue;
    entry.mutate(malformed);
    await assert.rejects(vault.wikiApply(malformed), rejection());
    assert.deepEqual(await canonical(new MemoryVault(vault.root, { llm })), before);
  });
});

test('I05: legal normalized fields and exact field/array boundaries survive durable apply', async () => {
  const { vault, llm, source } = await fixture();
  const key = `entity:${'k'.repeat(193)}`;
  llm.mutate = (response) => {
    Object.assign(response.pages[1]!, {
      key: ` ${key} `, title: 't'.repeat(300), summary: 's'.repeat(2000),
      conditions: ['c'.repeat(4000), ...many('condition-', 99)], uncertainty: ['u'.repeat(4000), ...many('uncertain-', 99)],
      links: [` source:${source.evidenceId} `],
    });
  };
  const plan = (await vault.wikiIngest({ evidenceIds: [source.evidenceId] })).plan!;
  assert.equal(plan.pages[1]!.key, key);
  const result = await vault.wikiApply(plan);
  assert.ok(result.commit);
  const reopened = new MemoryVault(vault.root, { llm });
  const page = await reopened.get(wikiPageId(key));
  assert.equal(page.meta.title, 't'.repeat(300));
  assert.equal(page.meta.summary, 's'.repeat(2000));
  assert.equal((page.meta.conditions as string[]).length, 100);
  assert.equal((page.meta.uncertainty as string[]).length, 100);
  assert.deepEqual(page.meta.links, [`source:${source.evidenceId}`]);
  assert.equal((await reopened.doctor()).healthy, true);
});

type Imported = { meta: RecordValue; body: string; path: string; raw?: string };
async function imported(vault: MemoryVault): Promise<Imported> {
  const original = await vault.get(wikiPageId(entityKey));
  const key = 'entity:quarantined-import';
  return { path: wikiPagePath(key), meta: { ...original.meta, key, id: wikiPageId(key), title: canary, summary: canary, links: [], dependencies: {} }, body: canary };
}

test('W03 I05: imported malformed canonical metadata fails closed while diagnostics inspect healthy neighbors', async (t) => {
  const cases: Array<{ name: string; mutate: (document: Imported) => void }> = [
    { name: 'malformed YAML metadata', mutate: (document) => { document.raw = `---\ntype: wiki-page\ntitle: [${canary}\n---\n\n${canary}\n`; } },
    { name: 'future document schema', mutate: (document) => { document.meta.version = 2; } },
    { name: 'future document type', mutate: (document) => { document.meta.type = 'wiki-page-v2'; } },
    { name: 'invalid page purpose', mutate: (document) => { document.meta.pageType = canary; } },
    { name: 'invalid status', mutate: (document) => { document.meta.status = 'verified'; } },
    { name: 'zero revision', mutate: (document) => { document.meta.revision = 0; } },
    { name: 'fractional revision', mutate: (document) => { document.meta.revision = 1.5; } },
    { name: 'unsafe integer revision', mutate: (document) => { document.meta.revision = Number.MAX_SAFE_INTEGER + 1; } },
    { name: 'string revision', mutate: (document) => { document.meta.revision = '1'; } },
    { name: 'missing evidence', mutate: (document) => { delete document.meta.evidence; } },
    { name: 'empty evidence', mutate: (document) => { document.meta.evidence = []; } },
    { name: 'traversing evidence path', mutate: (document) => { document.meta.evidence = [`evidence/../../${canary}.md`]; } },
    { name: 'absolute evidence path', mutate: (document) => { document.meta.evidence = [`/tmp/${canary}.md`]; } },
    { name: 'malformed dependency revision', mutate: (document) => { document.meta.dependencies = { [entityKey]: 0 }; } },
    { name: 'forbidden dependency key', mutate: (document) => { document.meta.dependencies = { constructor: 1 }; } },
    { name: 'forged lifecycle relation', mutate: (document) => { document.meta.supersededBy = canary; } },
    { name: 'inconsistent canonical identity', mutate: (document) => { document.meta.id = wikiPageId('entity:another-identity'); } },
    { name: 'duplicate identity at another path', mutate: (document) => { document.meta.key = entityKey; document.meta.id = wikiPageId(entityKey); } },
    { name: 'empty body', mutate: (document) => { document.body = ''; } },
  ];
  for (const entry of cases) await t.test(entry.name, async () => {
    const { vault, llm, source } = await fixture(true);
    const next = await vault.capture({ content: 'Additional boundary evidence.', scope: 'public', sensitivity: 'public' });
    const plan = (await vault.wikiIngest({ evidenceIds: [next.evidenceId] })).plan!;
    const document = await imported(vault);
    entry.mutate(document);
    await writeFile(join(vault.root, document.path), document.raw ?? serializeMarkdown(document.meta, document.body));
    const before = await canonical(vault);
    const reopened = new MemoryVault(vault.root, { llm });
    const count = llm.calls.length;
    for (const operation of [
      () => reopened.wikiCatalog(), () => reopened.get(wikiPageId(entityKey)), () => reopened.search(canary),
      () => reopened.wikiIngest({ evidenceIds: [source.evidenceId], apply: true }), () => reopened.wikiApply(plan),
    ]) await assert.rejects(operation(), rejection());
    assert.equal(llm.calls.length, count, 'invalid canonical data must fail before provider dispatch');
    const report = await reopened.wikiLint({ semantic: true });
    assert.equal(report.semantic, 'failed', 'the strict pre-dispatch check refuses a corrupt canonical vault');
    assert.equal(report.semanticError?.code, 'VALIDATION_FAILED');
    assert.equal(llm.calls.length, count);
    assert.equal(report.coverage.pages, 2, 'tolerant diagnostics retain the two healthy pages');
    assert.ok(report.issues.some((issue) => issue.kind === 'invalid-document'));
    const doctor = await reopened.doctor();
    assert.equal(doctor.healthy, false);
    assert.equal(doctor.documents?.healthy, false);
    assert.ok(!JSON.stringify({ report, doctor, calls: llm.calls.slice(count) }).includes(canary));
    assert.deepEqual(await canonical(reopened), before, 'diagnostics and rejected writes cannot rewrite imported bytes');
  });
});

test('W03: a future vault configuration denies wiki reads/writes and returns truthful doctor diagnostics', async () => {
  const { vault, llm, source } = await fixture();
  const plan = (await vault.wikiIngest({ evidenceIds: [source.evidenceId] })).plan!;
  const path = join(vault.root, 'agent-memory.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.version = 3;
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  const before = await canonical(vault);
  const reopened = new MemoryVault(vault.root, { llm });
  const count = llm.calls.length;
  for (const operation of [
    () => reopened.wikiCatalog(), () => reopened.get(source.evidenceId), () => reopened.search('Schema'),
    () => reopened.wikiLint(), () => reopened.wikiIngest({ evidenceIds: [source.evidenceId], apply: true }), () => reopened.wikiApply(plan),
  ]) await assert.rejects(operation(), rejection('CONFIG_VERSION_UNSUPPORTED'));
  const doctor = await reopened.doctor();
  assert.equal(doctor.healthy, false);
  assert.equal(doctor.configVersion, 3);
  assert.equal(doctor.configuration?.healthy, false);
  assert.equal(llm.calls.length, count);
  assert.deepEqual(await canonical(reopened), before);
});

test('W03 S10: schema-valid imported provenance faults are quarantined from read, search, catalog and semantic input', async (t) => {
  const cases: Array<{ name: string; kind: string; mutate: (document: Imported) => void }> = [
    { name: 'missing canonical source', kind: 'unavailable-source', mutate: (document) => { document.meta.evidence = ['evidence/absent.md']; } },
    { name: 'missing related target', kind: 'unavailable-link', mutate: (document) => { document.meta.links = ['entity:absent']; } },
    { name: 'missing dependency target', kind: 'unavailable-link', mutate: (document) => { document.meta.dependencies = { 'entity:absent': 1 }; } },
    { name: 'unavailable operational rule', kind: 'unavailable-rules', mutate: (document) => { document.meta.rules = { [`wr-${'f'.repeat(24)}`]: 1 }; } },
  ];
  for (const entry of cases) await t.test(entry.name, async () => {
    const { vault, llm } = await fixture(true);
    const document = await imported(vault);
    entry.mutate(document);
    await writeFile(join(vault.root, document.path), serializeMarkdown(document.meta, document.body));
    const before = await canonical(vault);
    const reopened = new MemoryVault(vault.root, { llm });
    const count = llm.calls.length;
    const catalog = await reopened.wikiCatalog();
    assert.equal(catalog.length, 2);
    assert.ok(!catalog.some((page) => page.id === document.meta.id));
    await assert.rejects(reopened.get(String(document.meta.id)), rejection('NOT_FOUND'));
    assert.deepEqual(await reopened.search(canary), []);
    const report = await reopened.wikiLint({ semantic: true });
    assert.equal(report.semantic, 'available');
    assert.equal(report.coverage.pages, 2);
    assert.ok(report.issues.some((issue) => issue.kind === entry.kind && issue.pageKeys.includes(String(document.meta.key))));
    assert.equal((await reopened.doctor()).healthy, false);
    assert.ok(!JSON.stringify(llm.calls.slice(count)).includes(canary));
    assert.deepEqual(await canonical(reopened), before);
  });
});

test('I05: a real symlink at a planned destination refuses apply without changing its external target', { skip: process.platform === 'win32' }, async () => {
  const { vault, llm, source } = await fixture();
  const plan = (await vault.wikiIngest({ evidenceIds: [source.evidenceId] })).plan!;
  const outside = await mkdtemp(join(tmpdir(), 'wiki-schema-outside-')); roots.push(outside);
  const target = join(outside, 'external-evidence.md');
  const bytes = Buffer.from(`External target must stay byte-identical.\n${canary}\n`);
  await writeFile(target, bytes);
  const destination = join(vault.root, wikiPagePath(plan.pages[1]!.key));
  await mkdir(join(vault.root, 'wiki', 'pages'), { recursive: true });
  await symlink(target, destination);
  const before = await canonical(vault);
  await assert.rejects(vault.wikiApply(plan), rejection());
  assert.deepEqual(await readFile(target), bytes);
  assert.equal((await lstat(destination)).isSymbolicLink(), true);
  assert.equal(await readlink(destination), target);
  assert.deepEqual(await canonical(new MemoryVault(vault.root, { llm })), before);
  assert.deepEqual(await readdir(outside), ['external-evidence.md']);
});
