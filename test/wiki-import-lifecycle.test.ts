import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { promisify } from 'node:util';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { searchVault } from '../src/search.js';
import { MemoryVault } from '../src/vault.js';
import { renderPublicWikiCatalog } from '../src/wiki.js';
import { wikiPageId, wikiPagePath } from '../src/wiki-schema.js';
import type { MarkdownDocument } from '../src/types.js';
import type { WikiPageDraft, WikiPageMeta } from '../src/wiki-types.js';

const exec = promisify(execFile);
const roots: string[] = [];
const entityKey = 'entity:atlas';
const synthesisKey = 'synthesis:atlas-backup';
const originalClaim = 'Atlas has verified daily backups.';
const condition = 'Applies to project deployments only.';
const uncertainty = 'Backup cadence needs independent verification.';
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class ImportClient extends LlmClient {
  queries: Array<Array<WikiPageMeta & { body: string }>> = [];
  constructor() { super({ apiKey: 'fixture', model: 'wiki-import-lifecycle', embeddingModel: '' }); }
  override async wiki<T = unknown>(operation: 'navigate' | 'compile' | 'query' | 'lint', value: object): Promise<T> {
    const input = value as { catalog: Array<{ key: string }>; sources: Array<{ id: string; body: string }>; pages: Array<WikiPageMeta & { body: string }> };
    if (operation === 'navigate') return { keys: input.catalog.map((entry) => entry.key) } as T;
    if (operation === 'lint') return { suggestions: [] } as T;
    if (operation === 'query') {
      this.queries.push(input.pages);
      return { answer: input.pages.map((page) => page.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0]!.trim()).join('\n'), citations: input.pages.map((page) => page.key), uncertainty: [] } as T;
    }
    const source = input.sources[0]!;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string, links: string[]): WikiPageDraft => ({
      key, pageType, title: key, summary: body.replace(/\s+/g, ' '), body, links, evidenceIds: [source.id], status: 'active', conditions: [], uncertainty: [],
    });
    return { pages: [
      draft(`source:${source.id}`, 'source', source.body, []),
      draft(entityKey, 'entity', originalClaim, [`source:${source.id}`]),
      draft(synthesisKey, 'synthesis', `Daily backups support Atlas recovery.`, [entityKey]),
    ] } as T;
  }
}

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `wiki-import-${name}-`)); roots.push(root); return root;
}

async function fixture() {
  const llm = new ImportClient();
  const vault = new MemoryVault(await temporary('vault'), { llm });
  await vault.initialize('Wiki import lifecycle');
  const evidence = await vault.capture({ content: 'Atlas backup source report.', scope: 'public', sensitivity: 'public' });
  await vault.wikiIngest({ evidenceIds: [evidence.evidenceId], apply: true });
  const sourceKey = `source:${evidence.evidenceId}`;
  const keys = [sourceKey, entityKey, synthesisKey];
  return { vault, llm, evidence, sourceKey, keys };
}

async function editPage(root: string, key: string, changes: Partial<WikiPageMeta>): Promise<void> {
  const path = join(root, wikiPagePath(key));
  const document = parseMarkdown<WikiPageMeta>(await readFile(path, 'utf8'));
  await writeFile(path, serializeMarkdown({ ...document.meta, revision: document.meta.revision + 1, ...changes }, document.body));
}

async function project(root: string, keys: string[], evidencePath: string): Promise<string> {
  const documents = await Promise.all([...keys.map(wikiPagePath), evidencePath].map(async (path): Promise<MarkdownDocument<Record<string, unknown>>> => ({ path, ...parseMarkdown<Record<string, unknown>>(await readFile(join(root, path), 'utf8')) })));
  const projection = renderPublicWikiCatalog(documents);
  await writeFile(join(root, 'WIKI.md'), projection);
  return projection;
}

async function canonical(vault: MemoryVault, keys: string[], evidencePath: string) {
  const paths = [...keys.map(wikiPagePath), evidencePath, 'WIKI.md', 'log.md'];
  return {
    head: await vault.git.run(['rev-parse', 'HEAD']),
    status: await vault.git.run(['status', '--porcelain=v1']),
    files: Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(join(vault.root, path), 'utf8')]))),
  };
}

for (const boundary of ['conflict without uncertainty', 'conflict via dependency-only edges', 'new condition', 'new uncertainty'] as const) {
  test(`S05 S10: manually imported ${boundary} cannot leave active dependent claims in any public read`, async () => {
    const { vault, sourceKey, keys, evidence } = await fixture();
    if (boundary === 'conflict via dependency-only edges') {
      for (const key of [entityKey, synthesisKey]) {
        const path = join(vault.root, wikiPagePath(key));
        const document = parseMarkdown<WikiPageMeta>(await readFile(path, 'utf8'));
        assert.ok(Object.keys(document.meta.dependencies).length > 0);
        await writeFile(path, serializeMarkdown({ ...document.meta, links: [] }, document.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0]!.trim()));
      }
      await project(vault.root, keys, evidence.evidencePath);
      await vault.git.commit('fixture: dependency-only provenance', vault.principal, [wikiPagePath(entityKey), wikiPagePath(synthesisKey), 'WIKI.md']);
    }
    // Warm both public retrieval paths before the source changes on disk.
    assert.ok((await vault.search('Atlas')).some((hit) => hit.id === wikiPageId(entityKey)));
    assert.ok((await searchVault(vault.root, 'Atlas')).some((hit) => hit.id === wikiPageId(synthesisKey)));
    const original = await canonical(vault, keys, evidence.evidencePath);
    const restriction: Partial<WikiPageMeta> = boundary.startsWith('conflict') ? { status: 'conflicted', uncertainty: [] }
      : boundary === 'new condition' ? { conditions: [condition] } : { uncertainty: [uncertainty] };
    await editPage(vault.root, sourceKey, restriction);
    const projection = await project(vault.root, keys, evidence.evidencePath);
    await vault.git.commit('fixture: import changed support and rebuilt catalog', vault.principal, [wikiPagePath(sourceKey), 'WIKI.md']);
    const imported = await canonical(vault, keys, evidence.evidencePath);
    const llm = new ImportClient();
    const fresh = new MemoryVault(vault.root, { llm });
    assert.deepEqual((await fresh.wikiCatalog()).map((entry) => entry.key), [sourceKey]);
    for (const key of [entityKey, synthesisKey]) {
      await assert.rejects(fresh.get(wikiPageId(key)), (error) => error instanceof AgentMemoryError && error.code === 'NOT_FOUND');
      assert.ok(!(await fresh.search('Atlas')).some((hit) => hit.id === wikiPageId(key)));
      assert.ok(!(await searchVault(vault.root, 'Atlas')).some((hit) => hit.id === wikiPageId(key)));
      assert.ok(!projection.includes(`./${wikiPagePath(key)}`));
      assert.equal(imported.files[wikiPagePath(key)], original.files[wikiPagePath(key)], 'stale dependent bytes remain available for explicit review');
    }
    const answer = await fresh.wikiQuery('What is known about Atlas backups?');
    assert.deepEqual(answer.citations.map((citation) => citation.key), [sourceKey]);
    assert.deepEqual(llm.queries[0]!.map((page) => page.key), [sourceKey]);
    assert.ok(!answer.answer.includes(originalClaim));
    if (boundary.startsWith('conflict')) {
      assert.match(answer.uncertainty.join('\n'), /unresolved competing claims/);
      assert.match(projection, /conflicted/);
      assert.match(projection, /unresolved competing claims/);
    } else if (boundary === 'new condition') {
      assert.deepEqual(answer.citations[0]!.conditions, [condition]);
      assert.ok(projection.includes(condition));
    } else {
      assert.ok(answer.uncertainty.includes(uncertainty));
      assert.ok(projection.includes(uncertainty));
    }
    const lint = await fresh.wikiLint();
    for (const key of [entityKey, synthesisKey]) assert.ok(lint.issues.some((issue) => issue.kind === 'invalid-restrictions' && issue.pageKeys.includes(key)));
    assert.ok(!lint.issues.some((issue) => issue.kind === 'catalog-mismatch'), 'a freshly rebuilt catalog cannot mask the invalid dependency');
    const doctor = await fresh.doctor();
    assert.equal(doctor.healthy, false);
    assert.equal(imported.files[evidence.evidencePath], original.files[evidence.evidencePath]);
    assert.deepEqual(await canonical(fresh, keys, evidence.evidencePath), imported, 'catalog, search, query, lint and doctor never repair canonical bytes implicitly');
  });
}

test('S05 retention: an older dependency revision remains usable when its restrictions and lifecycle still hold', async () => {
  const { vault, sourceKey, keys, evidence } = await fixture();
  await editPage(vault.root, sourceKey, {});
  await project(vault.root, keys, evidence.evidencePath);
  await vault.git.commit('fixture: benign support revision', vault.principal, [wikiPagePath(sourceKey), 'WIKI.md']);
  const before = await canonical(vault, keys, evidence.evidencePath);
  const fresh = new MemoryVault(vault.root, { llm: new ImportClient() });
  assert.equal((await fresh.wikiCatalog()).length, 3);
  assert.ok((await fresh.search('Atlas')).some((hit) => hit.id === wikiPageId(entityKey)));
  assert.ok((await fresh.wikiQuery('Atlas backups?')).citations.some((citation) => citation.key === entityKey && citation.revision === 1));
  assert.ok((await fresh.wikiLint()).issues.some((issue) => issue.kind === 'stale' && issue.pageKeys.includes(entityKey)));
  assert.equal((await fresh.doctor()).healthy, true);
  assert.deepEqual(await canonical(fresh, keys, evidence.evidencePath), before);
});

for (const reference of ['dependency', 'stored rule', 'built-in rule'] as const) {
  test(`W03 I05 S10: imported future ${reference} revisions cannot become active knowledge`, async () => {
    const { vault, sourceKey, keys, evidence } = await fixture();
    let ruleId = 'builtin-wiki-rules-v1';
    if (reference === 'stored rule') ruleId = (await vault.wikiSetRules({ purpose: 'Versioned rules', instructions: 'Retain real revisions.', scope: 'public', sensitivity: 'public' })).id;
    const changes: Partial<WikiPageMeta> = reference === 'dependency' ? { dependencies: { [sourceKey]: 999 } } : { rules: { [ruleId]: 999 } };
    await editPage(vault.root, entityKey, changes);
    // Include the stored rule when independently rebuilding the global projection.
    const documents = await Promise.all([...keys.map(wikiPagePath), evidence.evidencePath, ...(reference === 'stored rule' ? [`wiki/.meta/${ruleId}.md`] : [])].map(async (path): Promise<MarkdownDocument<Record<string, unknown>>> => ({ path, ...parseMarkdown<Record<string, unknown>>(await readFile(join(vault.root, path), 'utf8')) })));
    const projection = renderPublicWikiCatalog(documents);
    await writeFile(join(vault.root, 'WIKI.md'), projection);
    const before = await canonical(vault, keys, evidence.evidencePath);
    const fresh = new MemoryVault(vault.root, { llm: new ImportClient() });
    for (const key of [entityKey, synthesisKey]) {
      assert.ok(!(await fresh.wikiCatalog()).some((entry) => entry.key === key));
      await assert.rejects(fresh.get(wikiPageId(key)), (error) => error instanceof AgentMemoryError && error.code === 'NOT_FOUND');
      assert.ok(!(await fresh.search('Atlas')).some((entry) => entry.id === wikiPageId(key)));
      assert.ok(!projection.includes(`./${wikiPagePath(key)}`));
    }
    assert.deepEqual((await fresh.wikiQuery('Atlas?')).citations.map((citation) => citation.key), [sourceKey]);
    assert.equal((await fresh.doctor()).healthy, false);
    assert.ok((await fresh.wikiLint()).issues.some((issue) => ['invalid-revision', 'unavailable-rules'].includes(issue.kind) && issue.pageKeys.includes(entityKey)));
    assert.deepEqual(await canonical(fresh, keys, evidence.evidencePath), before);
  });
}

for (const relationship of ['links only', 'dependency versions only'] as const) {
  test(`S05: imported conflict propagates transitively through ${relationship}`, async () => {
    const { vault, sourceKey, keys, evidence } = await fixture();
    for (const key of [entityKey, synthesisKey]) await editPage(vault.root, key, relationship === 'links only' ? { dependencies: {} } : { links: [] });
    await project(vault.root, keys, evidence.evidencePath);
    assert.equal((await vault.wikiCatalog()).length, 3, 'either documented relationship independently supplies valid provenance');
    await editPage(vault.root, sourceKey, { status: 'conflicted' });
    const projection = await project(vault.root, keys, evidence.evidencePath);
    await vault.git.commit('fixture: import conflict through one relationship kind', vault.principal, [...keys.map(wikiPagePath), 'WIKI.md']);
    const before = await canonical(vault, keys, evidence.evidencePath);
    const fresh = new MemoryVault(vault.root, { llm: new ImportClient() });
    assert.deepEqual((await fresh.wikiCatalog()).map((entry) => entry.key), [sourceKey]);
    assert.deepEqual((await fresh.wikiQuery('Atlas backups?')).citations.map((citation) => citation.key), [sourceKey]);
    for (const key of [entityKey, synthesisKey]) assert.ok(!projection.includes(`./${wikiPagePath(key)}`));
    assert.equal((await fresh.doctor()).healthy, false);
    assert.deepEqual(await canonical(fresh, keys, evidence.evidencePath), before);
  });
}

test('S05 Q04 retention: imported conflict stays queryable with caveats when every dependent preserves it', async () => {
  const { vault, keys, evidence } = await fixture();
  for (const key of keys) await editPage(vault.root, key, { status: 'conflicted', conditions: [condition], uncertainty: [] });
  const projection = await project(vault.root, keys, evidence.evidencePath);
  await vault.git.commit('fixture: consistently conflicted imported graph', vault.principal, [...keys.map(wikiPagePath), 'WIKI.md']);
  const fresh = new MemoryVault(vault.root, { llm: new ImportClient() });
  assert.equal((await fresh.wikiCatalog()).length, 3);
  assert.ok((await fresh.wikiCatalog()).every((page) => page.status === 'conflicted'));
  assert.deepEqual(await fresh.search('Atlas'), []);
  const before = await canonical(fresh, keys, evidence.evidencePath);
  const answer = await fresh.wikiQuery('What needs verification about Atlas?');
  assert.equal(answer.citations.length, 3);
  for (const citation of answer.citations) assert.match(citation.uncertainty.join('\n'), /unresolved competing claims/);
  assert.ok(projection.includes(condition));
  assert.match(projection, /unresolved competing claims/);
  assert.equal((await fresh.doctor()).healthy, true);
  assert.deepEqual(await canonical(fresh, keys, evidence.evidencePath), before);
  const filed = await fresh.wikiFile(answer, { title: 'Atlas conflict review', apply: true });
  const saved = await fresh.get(wikiPageId(filed.plan.query!.key));
  assert.equal(saved.meta.status, 'conflicted');
  assert.match((saved.meta.uncertainty as string[]).join('\n'), /unresolved competing claims/);
  assert.deepEqual(saved.meta.conditions, [condition]);
  assert.equal(await readFile(join(vault.root, evidence.evidencePath), 'utf8'), before.files[evidence.evidencePath]);
});

for (const fault of ['conflicted support', 'future dependency revision', 'future rule revision'] as const) {
test(`S10: real Git sync rejects imported ${fault} and restores canonical state`, { timeout: 30_000 }, async () => {
  const { vault, sourceKey, keys, evidence } = await fixture();
  const rule = await vault.wikiSetRules({ purpose: 'Remote provenance', instructions: 'Use actual versions.', scope: 'public', sensitivity: 'public' });
  const remote = await temporary('remote.git');
  await exec('git', ['init', '--bare', '--initial-branch=main', remote]);
  await vault.configureRemote({ name: 'origin', url: remote, branch: 'main', push: false });
  await vault.sync({ push: true });
  const clone = join(await temporary('clone'), 'checkout');
  await exec('git', ['clone', '--branch', 'main', remote, clone]);
  await exec('git', ['config', 'user.name', 'Wiki import fixture'], { cwd: clone });
  await exec('git', ['config', 'user.email', 'wiki-import@example.invalid'], { cwd: clone });
  if (fault === 'conflicted support') await editPage(clone, sourceKey, { status: 'conflicted', uncertainty: [] });
  else await editPage(clone, entityKey, fault === 'future dependency revision' ? { dependencies: { [sourceKey]: 999 } } : { rules: { [rule.id]: 999 } });
  await project(clone, keys, evidence.evidencePath);
  await exec('git', ['add', '--', wikiPagePath(sourceKey), wikiPagePath(entityKey), 'WIKI.md'], { cwd: clone });
  await exec('git', ['commit', '-m', 'fixture: import inconsistent Wiki lifecycle'], { cwd: clone });
  await exec('git', ['push', 'origin', 'main'], { cwd: clone });
  const before = await canonical(vault, keys, evidence.evidencePath);
  const syncBefore = await readFile(join(vault.root, '.amem', 'sync-state.json'), 'utf8');
  await assert.rejects(vault.sync({ push: false }), (error) => error instanceof AgentMemoryError && error.code === 'REMOTE_CONFLICT');
  const fresh = new MemoryVault(vault.root, { llm: new ImportClient() });
  assert.deepEqual(await canonical(fresh, keys, evidence.evidencePath), before);
  assert.equal(await readFile(join(vault.root, '.amem', 'sync-state.json'), 'utf8'), syncBefore);
  assert.equal((await fresh.doctor()).healthy, true);
  assert.ok((await fresh.search('Atlas')).some((hit) => hit.id === wikiPageId(entityKey)));
});
}
