import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LlmClient, MemoryVault } from 'memobranch';

await mkdir('.scratch', { recursive: true });
const temporary = await mkdtemp(resolve('.scratch/installed-availability-'));
try {
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let version = 1, calls = 0;
  llm.wiki = async (operation, input) => {
    calls++; if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const pages = input.sources.map(source => ({ key: 'source:' + source.id, pageType: 'source', title: 'Source', summary: 'Fixture',
      body: source.body, evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] }));
    return { pages: [...pages, { ...pages[0], key: 'concept:installed-availability', pageType: 'concept', title: 'Installed knowledge',
      body: 'Observed version ' + version, links: pages.map(page => page.key), evidenceIds: input.sources.map(source => source.id) }] };
  };
  const vault = new MemoryVault(join(temporary, 'vault'), { llm }); await vault.initialize('Installed observed knowledge');
  const key = 'concept:installed-availability', first = await vault.capture({ content: 'Installed original source', extract: false });
  await vault.wikiIngest({ evidenceIds: [first.evidenceId], apply: true });
  const raw = await readFile(join(vault.root, first.evidencePath), 'utf8');
  const unknown = await vault.wikiAsKnownAt({ pageKeys: [key], at: new Date().toISOString() }); assert.equal(unknown.items[0].status, 'unknown');
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key], confirm: false }));
  const observed = await vault.wikiObserveAvailability({ pageKeys: [key], confirm: true }); assert.ok(observed.commit);
  const second = await vault.capture({ content: 'Installed second source', extract: false }); version = 2;
  await vault.wikiIngest({ evidenceIds: [second.evidenceId], apply: true });
  const current = await vault.wikiSnapshot({ commit: await vault.git.run(['rev-parse', 'HEAD']), pageKeys: [key] });
  assert.match(current.pages.find(page => page.meta.key === key).body, /version 2/);
  const head = await vault.git.run(['rev-parse', 'HEAD']), count = calls;
  const read = await vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt }); assert.equal(read.items[0].status, 'observed');
  assert.equal(read.items[0].snapshot.commit, observed.observedCommit);
  assert.match(read.items[0].snapshot.pages.find(page => page.meta.key === key).body, /version 1/);
  const subset = await vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt, observationIds: [observed.evidenceId] });
  assert.equal(subset.coverage.mode, 'explicit-observation-ids'); assert.match(subset.warnings.join(' '), /outside that set/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key], confirm: true, signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt, signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  await assert.rejects(vault.wikiObserveAvailability({ pageKeys: [key], confirm: true, observedAt: '2001-01-01T00:00:00Z' }), { code: 'VALIDATION_FAILED' });
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head); assert.equal(calls, count);
  assert.equal(await readFile(join(vault.root, first.evidencePath), 'utf8'), raw);
  await vault.wikiRevoke(key, 'Withdraw installed fixture');
  await assert.rejects(vault.wikiAsKnownAt({ pageKeys: [key], at: observed.observedAt }), { code: 'NOT_FOUND' });
  console.log('Installed availability core: explicit immutable observations, real version change, exact old reconstruction, unknown legacy, subset limits, cancellation and current revocation passed; no model-quality or first-learning claim.');
} finally { await rm(temporary, { recursive: true, force: true }); }
