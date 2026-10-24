import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceDigest } from '../src/evidence.js';
import { assertWikiImportTime, importedWikiCaution, readWikiImportArtifact, wikiImportArtifact, wikiImportContent, wikiImportRestrictions, wikiImportUri } from '../src/wiki-import-artifact.js';
import type { EvidenceMeta, MarkdownDocument, Scope, Sensitivity } from '../src/types.js';
import { sharedFixture } from './shared-wiki-fixture.js';

function evidence(artifact: ReturnType<typeof wikiImportArtifact>, scope: Scope = 'project', sensitivity: Sensitivity = 'internal'): MarkdownDocument<EvidenceMeta> {
  const content = wikiImportContent(artifact), sourceUri = wikiImportUri(artifact), digest = evidenceDigest(scope, sensitivity, sourceUri, content), id = 'ev-' + digest.slice(0,12);
  return { path: `evidence/2026/10/24/${id}.md`, meta: { id, type: 'evidence', immutable: true, createdAt: '2026-10-24T00:00:00Z',
    actor: 'synthetic-importer', scope, sensitivity, sha256: digest, digestVersion: 2, sourceUri }, body: `# Evidence ${id}\n\n` + content };
}

test('Wiki import artifact: real pinned snapshot preserves complete compiled content, versions and origin without runtime/key fields', async t => {
  const { reader, input, binding } = await sharedFixture(t), view = await reader.snapshot(input), artifact = wikiImportArtifact(view), content = wikiImportContent(artifact);
  assert.equal(artifact.source.commit, binding.commit); assert.equal(artifact.pages[0]!.revision, 1);
  assert.match(content, /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(content, /DATED_WIKI_CURRENT_CANARY|masterKey|root|authorityHead|checkedAt|currentRevision|pdfOriginal/);
  assert.ok(content.includes(importedWikiCaution)); assert.ok(evidence(artifact).body.includes(importedWikiCaution));
  assert.deepEqual(artifact.sources, view.snapshot.sources); assert.deepEqual(artifact.rules, view.snapshot.rules);
  assert.equal(artifact.pages.find(page => page.key === input.pageKeys[0])!.body, view.snapshot.pages.find(page => page.meta.key === input.pageKeys[0])!.body);
  const later = structuredClone(view); later.snapshot.checkedAt = '2099-01-01T00:00:00Z'; later.snapshot.authorityHead = 'f'.repeat(40);
  for (const page of later.snapshot.pages) page.currentRevision += 1;
  assert.equal(wikiImportContent(wikiImportArtifact(later)), content); assert.deepEqual(readWikiImportArtifact(evidence(artifact)), artifact);
});

test('Wiki import artifact: complete graph and strict known fields are required; attachment and foreign key injection fail', async t => {
  const { reader, input } = await sharedFixture(t), artifact = wikiImportArtifact(await reader.snapshot(input));
  for (const changed of [ { ...artifact, pdfOriginal: { data: 'fake' } }, { ...artifact, source: { ...artifact.source, root: '/secret' } },
    { ...artifact, pages: artifact.pages.slice(0,1) }, { ...artifact, requestedKeys: ['concept:missing'] },
    { ...artifact, pages: [...artifact.pages, artifact.pages[0]] }, { ...artifact, pages: artifact.pages.map(page => ({ ...page, signal: {} })) } ]) {
    assert.throws(() => wikiImportContent(changed as typeof artifact), { code: 'VALIDATION_FAILED' });
  }
});

test('Wiki import artifact: an actual long ordinary-memory dependency fits the whole-artifact limit without truncation', async t => {
  const { source, reader, binding, saveBindings } = await sharedFixture(t);
  const captured = await source.capture({ content: 'Actual long legacy support', scope: 'project', extract: false });
  const candidate = await source.propose({ kind: 'fact', key: 'K'.repeat(400), statement: 'L'.repeat(120_000), scope: 'project', sensitivity: 'internal',
    confidence: 1, explicit: true, conditions: ['Synthetic long ordinary memory'], tags: [] }, [captured.evidencePath]);
  const approved = await source.approve(candidate.id); binding.commit = await source.git.run(['rev-parse', 'HEAD']); await saveBindings();
  const view = await reader.snapshot({ sourceId: binding.id, pageKeys: ['legacy:' + approved.memoryId] }), artifact = wikiImportArtifact(view);
  assert.ok(artifact.pages[0]!.body.length > 100_000); assert.equal(artifact.pages[0]!.body, view.snapshot.pages[0]!.body);
  assert.ok(Buffer.byteLength(wikiImportContent(artifact), 'utf8') < 1_000_000); assert.equal(artifact.pages[0]!.pageType, 'legacy');
  assert.equal(artifact.pages[0]!.title.length, 400);
});

test('Wiki import artifact: derived warning, restrictions and exact canonical URI/body cannot be lowered or edited', async t => {
  const { reader, input } = await sharedFixture(t, 'sensitive'), artifact = wikiImportArtifact(await reader.snapshot(input)), restriction = wikiImportRestrictions(artifact);
  assert.equal(restriction.scope, 'project'); assert.equal(restriction.sensitivity, 'sensitive'); assert.ok(restriction.uncertainty.includes(importedWikiCaution));
  assert.ok(restriction.conditions.includes('Synthetic dates, not verified facts.'));
  assert.ok(readWikiImportArtifact(evidence(artifact, 'user', 'secret')));
  for (const record of [evidence(artifact, 'public', 'sensitive'), evidence(artifact, 'project', 'internal'),
    { ...evidence(artifact, 'project', 'sensitive'), body: evidence(artifact, 'project', 'sensitive').body + '\n' },
    { ...evidence(artifact, 'project', 'sensitive'), meta: { ...evidence(artifact, 'project', 'sensitive').meta, sourceUri: wikiImportUri(artifact) + 'edited' } }]) {
    assert.throws(() => readWikiImportArtifact(record), { code: 'VALIDATION_FAILED' });
  }
  const ordinary = evidence(artifact, 'project', 'sensitive'); delete ordinary.meta.sourceUri;
  assert.equal(readWikiImportArtifact(ordinary), undefined); // A body alone does not claim the reserved import identity.
});

test('Wiki import artifact: source conflict, latest effective start and earliest end remain restrictions, not original-source truth', async t => {
  const { reader, input } = await sharedFixture(t), artifact = wikiImportArtifact(await reader.snapshot(input));
  artifact.pages[0]!.status = 'conflicted'; artifact.pages[0]!.validFrom = '2026-01-01T00:00:00Z'; artifact.pages[0]!.expiresAt = '2030-01-01T00:00:00Z';
  artifact.pages[1]!.validFrom = '2026-02-01T00:00:00Z'; artifact.pages[1]!.expiresAt = '2029-01-01T00:00:00Z';
  const boundary = wikiImportRestrictions(artifact); assert.equal(boundary.conflicted, true); assert.equal(boundary.validFrom, '2026-02-01T00:00:00Z'); assert.equal(boundary.expiresAt, '2029-01-01T00:00:00Z');
  assertWikiImportTime(boundary);
  assert.throws(() => assertWikiImportTime({ ...boundary, expiresAt: '2020-01-01T00:00:00Z' }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => assertWikiImportTime({ ...boundary, validFrom: '2099-01-01T00:00:00Z' }), { code: 'VALIDATION_FAILED' });
  artifact.pages[0]!.expiresAt = '2020-01-01T00:00:00Z';
  assert.ok(readWikiImportArtifact(evidence(artifact))); // Retained evidence remains inspectable after its support expires.
});

test('Wiki import artifact: UTF-8 and inherited condition bounds refuse the whole artifact without truncation', async t => {
  const { reader, input } = await sharedFixture(t), artifact = wikiImportArtifact(await reader.snapshot(input));
  const full = structuredClone(artifact); full.pages = Array.from({length: 12}, (_, index) => ({ ...full.pages[0]!, key: 'concept:large-' + index, body: '界'.repeat(90_000), links: [] }));
  full.requestedKeys = [full.pages[0]!.key]; assert.throws(() => wikiImportContent(full), { code: 'CONTENT_TOO_LARGE' });
  const crowded = structuredClone(artifact); for (const [index,page] of crowded.pages.entries()) page.conditions = Array.from({length:100},(_,n) => `${index}:${n}`);
  assert.throws(() => wikiImportContent(crowded), { code: 'VALIDATION_FAILED' });
});
