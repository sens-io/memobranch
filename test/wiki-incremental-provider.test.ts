import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LlmClient } from '../src/llm.js';
import { extractMarkdownLinks, parseMarkdown } from '../src/markdown.js';
import { MemoryVault, type CaptureResult } from '../src/vault.js';
import { sha256 } from '../src/utils.js';
import type { EvidenceMeta, MarkdownDocument } from '../src/types.js';
import type { WikiCatalogEntry, WikiPageDraft, WikiPageMeta, WikiPlan } from '../src/wiki-types.js';

const exec = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const model = 'incremental-wiki-protocol-fixture';
const initialCondition = 'Daily snapshots apply only to project deployments.';
const restoreLimitation = 'Restoration creates a separate instance; in-place restoration is unsupported.';
const comparisonCondition = 'The comparison applies to documented project deployments, not measured recovery speed.';
const firstFact = 'AtlasStore supports daily snapshots for project deployments, verified 2026-09-01.';
const secondFact = 'AtlasStore restores a snapshot to a separate instance; in-place restoration is unsupported, verified 2026-09-02.';
const comparisonFact = 'AtlasStore uses daily snapshots; BeaconDB additionally documents continuous log replay. Recovery point objective (RPO) is the maximum acceptable data-loss interval, not a measured recovery duration.';
const corpus = [
  { label: 'E1', content: `${firstFact}\n\nCondition: ${initialCondition}`, title: 'AtlasStore snapshot documentation', summary: 'Daily snapshots are documented for project deployments as of 2026-09-01.' },
  { label: 'E2', content: `${secondFact}\n\nLimitation: ${restoreLimitation}`, title: 'AtlasStore restoration documentation', summary: 'Restoration creates a separate instance; in-place restoration is unsupported.' },
  { label: 'E4', content: `${comparisonFact}\n\nScope: ${comparisonCondition}\nComparison verified 2026-09-04.`, title: 'AtlasStore and BeaconDB comparison', summary: 'Snapshot and continuous-replay strategies differ in their recovery-point behavior.' },
] as const;
type CorpusSource = (typeof corpus)[number];
type Page = MarkdownDocument<WikiPageMeta>;
interface ProviderInput {
  catalog: WikiCatalogEntry[];
  sources: Array<EvidenceMeta & { path: string; body: string }>;
  pages?: Array<WikiPageMeta & { body: string }>;
  evidence?: Array<EvidenceMeta & { path: string }>;
  rules: Array<{ id: string; revision: number; purpose: string; instructions: string }>;
}
interface Request {
  method: string | undefined;
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: { model: string; temperature: number; response_format: object; messages: Array<{ role: string; content: string }> };
  operation: 'navigate' | 'compile';
  input: ProviderInput;
}
interface Readback {
  catalog: WikiCatalogEntry[];
  pages: Page[];
  evidence: Array<MarkdownDocument<EvidenceMeta>>;
  head: string;
}

// P evidence: only the local service supplies controlled model output. Every input
// below is produced by the real vault, serialized by LlmClient, and read from HTTP.
async function provider(t: TestContext): Promise<{ baseUrl: string; requests: Request[] }> {
  const requests: Request[] = [];
  const failures: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Request['body'];
      const payload = JSON.parse(body.messages[1]!.content) as Pick<Request, 'operation' | 'input'>;
      assert.ok(payload.operation === 'navigate' || payload.operation === 'compile', 'this corpus needs only Wiki navigation and compilation');
      requests.push({ method: request.method, path: request.url, headers: request.headers, body, ...payload });
      const output = payload.operation === 'navigate'
        ? { keys: payload.input.catalog.map((entry) => entry.key) }
        : compilation(payload.input);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output) } }] }));
    })().catch((error: unknown) => { failures.push(error); response.destroy(); });
  });
  t.after(async () => {
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
    assert.deepEqual(failures, [], 'HTTP fixture handlers must complete successfully');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

function compilation(input: ProviderInput): { pages: WikiPageDraft[] } {
  assert.equal(input.sources.length, 1);
  const source = input.sources[0]!;
  const stage = corpus.findIndex((item) => source.body.includes(item.content));
  assert.ok(stage >= 0, 'the service must receive the captured corpus source body');
  const item = corpus[stage]!;
  const oldSourceKeys = (input.pages ?? []).filter((page) => page.pageType === 'source').map((page) => page.key);
  const sourceKeys = [...oldSourceKeys, `source:${source.id}`];
  const evidenceIds = [...new Set([source.id, ...(input.evidence ?? []).map((evidence) => evidence.id)])];
  const draft = (key: string, pageType: WikiPageDraft['pageType'], title: string, summary: string, body: string, links: string[], conditions: string[] = []): WikiPageDraft => ({
    key, pageType, title, summary, body: `# ${title}\n\n${body}`, evidenceIds, links, status: 'active', conditions, uncertainty: [],
  });
  const pages = [
    draft(`source:${source.id}`, 'source', item.title, item.summary, item.content, ['entity:atlas'], stage === 0 ? [initialCondition] : stage === 1 ? [restoreLimitation] : [comparisonCondition]),
    draft('entity:atlas', 'entity', 'AtlasStore', 'Documented snapshots and restoration, retaining deployment scope and verification dates.',
      [firstFact, initialCondition, ...(stage >= 1 ? [secondFact, restoreLimitation] : []), ...(stage === 2 ? ['Compared with BeaconDB, its documented daily-snapshot strategy has different recovery-point granularity.'] : [])].join('\n\n'),
      [...sourceKeys, ...(stage >= 1 ? ['synthesis:recovery'] : []), ...(stage === 2 ? ['comparison:atlas-beacon'] : [])]),
  ];
  if (stage >= 1) pages.push(draft('synthesis:recovery', 'synthesis', 'AtlasStore recovery workflow', 'Daily snapshots and separate-instance restoration form a conditional recovery workflow.',
    `## Combined workflow\n\n${firstFact}\n\n${secondFact}\n\nSnapshots provide a recovery point and restoration provisions another instance; operators must plan a separate cutover. ${initialCondition}\n\n${restoreLimitation}${stage === 2 ? '\n\nRecovery point objective describes acceptable data loss; recovery speed remains unmeasured.' : ''}`,
    ['entity:atlas', ...sourceKeys, ...(stage === 2 ? ['concept:rpo'] : [])]));
  if (stage === 2) pages.push(
    draft('entity:beacon', 'entity', 'BeaconDB', 'BeaconDB documents continuous log replay for the compared deployments.', 'BeaconDB documents continuous log replay in addition to snapshots. The comparison does not establish measured recovery speed.', [`source:${source.id}`, 'comparison:atlas-beacon']),
    draft('concept:rpo', 'concept', 'Recovery point objective', 'RPO describes the maximum acceptable data-loss interval.', '## Definition\n\nRecovery point objective (RPO) is the maximum acceptable data-loss interval.\n\n## Use in this comparison\n\nDaily snapshots and continuous log replay provide different recovery-point granularity. RPO does not measure the time needed to restore service.', ['entity:atlas', 'entity:beacon', 'comparison:atlas-beacon']),
    draft('comparison:atlas-beacon', 'comparison', 'AtlasStore versus BeaconDB', 'Compares daily snapshots, separate-instance restoration and continuous replay without inventing a measured RPO.', `## Documented comparison\n\n| System | Recovery-point mechanism | Restoration evidence |\n| --- | --- | --- |\n| AtlasStore | Daily snapshots for project deployments | Separate instance; in-place restoration unsupported |\n| BeaconDB | Continuous log replay is documented | Restoration duration is not measured here |\n\n${firstFact}\n\n${secondFact}\n\n${comparisonFact}\n\n${comparisonCondition}`, ['entity:atlas', 'entity:beacon', 'concept:rpo', 'synthesis:recovery', ...sourceKeys]),
  );
  return { pages };
}

function configured(baseUrl: string): LlmClient {
  return new LlmClient({ baseUrl, apiKey: 'local-incremental-key', model, embeddingModel: '', maxRetries: 0, requestTimeoutMs: 5_000 });
}

// Each action runs in a fresh process: no compiler subclass, retained vault object,
// or cache can supply the existing pages, proof key, receipts, or restart readback.
const worker = `
import { MemoryVault } from ${JSON.stringify(new URL('../src/vault.ts', import.meta.url).href)};
import { LlmClient } from ${JSON.stringify(new URL('../src/llm.ts', import.meta.url).href)};
const [root, baseUrl, model, action, encoded] = process.argv.slice(1);
const input = JSON.parse(encoded);
const vault = new MemoryVault(root, { llm: new LlmClient({ baseUrl, apiKey: 'local-incremental-key', model, embeddingModel: '', maxRetries: 0, requestTimeoutMs: 5000 }) });
let result;
if (action === 'ingest') result = await vault.wikiIngest(input);
else if (action === 'apply') result = await vault.wikiApply(input);
else if (action === 'replay') result = { apply: await vault.wikiApply(input), ingest: await vault.wikiIngest({ evidenceIds: input.sourceIds, apply: true }) };
else if (action === 'inspect') {
  const catalog = await vault.wikiCatalog();
  result = { catalog, pages: await Promise.all(catalog.map((page) => vault.get(page.id))), evidence: await Promise.all(input.map((id) => vault.get(id))), head: await vault.git.run(['rev-parse', 'HEAD']) };
} else throw new Error('Unknown fixture action');
process.stdout.write(JSON.stringify(result));
`;

async function invoke<T>(root: string, baseUrl: string, action: string, input: unknown): Promise<T> {
  const { stdout, stderr } = await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', worker, root, baseUrl, model, action, JSON.stringify(input)], { cwd: repository, timeout: 30_000, maxBuffer: 4_000_000 });
  assert.equal(stderr, '');
  return JSON.parse(stdout) as T;
}

async function files(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!relative && ['.amem', '.git'].includes(entry.name)) continue;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await files(root, path));
    else result[path] = (await readFile(join(root, path))).toString('base64');
  }
  return result;
}

async function canonical(vault: MemoryVault) {
  return { head: await vault.git.run(['rev-parse', 'HEAD']), status: await vault.git.run(['status', '--porcelain=v1']), files: await files(vault.root) };
}

function requiredPage(readback: Readback, key: string): Page {
  const page = readback.pages.find((item) => item.meta.key === key);
  assert.ok(page, `fresh public reader must return ${key}`);
  return page;
}

function assertRequest(request: Request, operation: Request['operation']): void {
  assert.equal(request.operation, operation);
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer local-incremental-key');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.body.model, model);
  assert.equal(request.body.temperature, 0);
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.deepEqual(request.body.messages.map((message) => message.role), ['system', 'user']);
  assert.ok(request.input.rules.some((rule) => rule.purpose === 'Maintain documented backup and recovery knowledge.' && rule.instructions.includes('Preserve verification dates and deployment conditions.')));
}

test('I01 I02 I04 I07 G01: E1 → process restart → E2 → E4 uses actual provider context and preserves incremental Wiki artifacts', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-wiki-incremental-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = await provider(t);
  const vault = new MemoryVault(root, { llm: configured(service.baseUrl) });
  await vault.initialize('Incremental provider acceptance');
  await vault.wikiSetRules({ purpose: 'Maintain documented backup and recovery knowledge.', instructions: 'Preserve verification dates and deployment conditions. Link source summaries to maintained shared pages.', scope: 'public', sensitivity: 'public' });
  const sources: Array<{ captured: CaptureResult; fixture: CorpusSource; bytes: Buffer; document: ReturnType<typeof parseMarkdown<EvidenceMeta>> }> = [];
  let previous: Readback = { catalog: [], pages: [], evidence: [], head: await vault.git.run(['rev-parse', 'HEAD']) };
  const sourceBodies = new Map<string, string>();
  for (const [stage, item] of corpus.entries()) {
    const captured = await vault.capture({ content: item.content, sourceUri: `https://fixture.invalid/${item.label.toLowerCase()}`, scope: 'public', sensitivity: 'public', extract: false });
    const bytes = await readFile(join(root, captured.evidencePath));
    sources.push({ captured, fixture: item, bytes, document: parseMarkdown<EvidenceMeta>(bytes.toString('utf8')) });
    const before = await canonical(vault);
    const requestsBefore = service.requests.length;
    const proposed = await invoke<{ duplicate: boolean; plan: WikiPlan | null; commit: string | null }>(root, service.baseUrl, 'ingest', { evidenceIds: [captured.evidenceId] });
    assert.equal(proposed.duplicate, false);
    assert.equal(proposed.commit, null);
    assert.ok(proposed.plan);
    assert.deepEqual(await canonical(vault), before, `${item.label} default planning cannot mutate any canonical path or Git HEAD`);
    const requests = service.requests.slice(requestsBefore);
    assert.deepEqual(requests.map((request) => request.operation), stage === 0 ? ['compile'] : ['navigate', 'compile']);
    const compile = requests.at(-1)!;
    assertRequest(compile, 'compile');
    assert.deepEqual(compile.input.catalog, previous.catalog);
    assert.deepEqual(compile.input.pages, previous.pages.map((page) => ({ ...page.meta, body: page.body })), 'HTTP compilation includes the actual persisted bodies and revisions');
    assert.equal(compile.input.sources[0]!.id, captured.evidenceId);
    assert.equal(compile.input.sources[0]!.body, sources.at(-1)!.document.body);
    assert.equal(compile.input.sources[0]!.sha256, sources.at(-1)!.document.meta.sha256);
    if (stage > 0) {
      const navigation = requests[0]!;
      assertRequest(navigation, 'navigate');
      assert.deepEqual(navigation.input.catalog, previous.catalog);
      assert.equal(navigation.input.pages, undefined, 'navigation sees the directory before the compiler reads full pages');
      for (const page of previous.pages) {
        assert.ok(proposed.plan.contextKeys.includes(page.meta.key));
        assert.match(proposed.plan.snapshot[page.path]!, /^[a-f0-9]{64}$/);
      }
      assert.equal(compile.input.pages!.find((page) => page.key === 'entity:atlas')!.revision, stage);
    }
    assert.match(proposed.plan.snapshot[captured.evidencePath]!, /^[a-f0-9]{64}$/);
    assert.deepEqual(proposed.plan.sourceIds, [captured.evidenceId]);
    assert.equal(proposed.plan.kind, 'compile');
    assert.ok(proposed.plan.ruleIds.length > 0);
    assert.deepEqual(proposed.plan.expectedRevisions, Object.fromEntries(proposed.plan.pages.map((page) => [page.key, previous.catalog.find((entry) => entry.key === page.key)?.revision ?? 0])));
    assert.deepEqual(proposed.plan.relevantPageVersions, Object.fromEntries(previous.catalog.map((entry) => [entry.key, entry.revision])));
    assert.deepEqual(proposed.plan.ruleVersions, Object.fromEntries(compile.input.rules.map((rule) => [rule.id, rule.revision])));
    assert.deepEqual(proposed.plan.sourceHashes, Object.fromEntries(sources.map((source) => [source.captured.evidenceId, sha256(source.document.body)])));
    const applied = await invoke<{ pageIds: string[]; commit: string | null }>(root, service.baseUrl, 'apply', proposed.plan);
    assert.ok(applied.commit);
    assert.equal(service.requests.length, requestsBefore + requests.length, 'explicit apply uses the inspected plan without calling the provider again');
    const readback = await invoke<Readback>(root, service.baseUrl, 'inspect', sources.map((source) => source.captured.evidenceId));
    assert.equal(readback.head.trim(), applied.commit);
    assert.equal(readback.catalog.length, [2, 4, 8][stage]);
    const changedPaths = (await vault.git.run(['show', '--pretty=format:', '--name-only', applied.commit])).trim().split('\n');
    assert.ok(changedPaths.includes('WIKI.md'));
    assert.ok(changedPaths.includes('log.md'));
    assert.equal(changedPaths.some((path) => path.startsWith('evidence/')), false, 'Wiki commit must not rewrite raw evidence');
    const actor = await vault.git.run(['show', '-s', '--format=%an%n%ae%n%B', applied.commit]);
    assert.ok(actor.includes(vault.principal.name));
    assert.match(actor, /wiki-apply/);
    const logAfter = await readFile(join(root, 'log.md'), 'utf8');
    assert.ok(logAfter.startsWith(Buffer.from(before.files['log.md']!, 'base64').toString('utf8')), 'existing chronological log bytes are retained');
    for (const source of sources) {
      assert.deepEqual(await readFile(join(root, source.captured.evidencePath)), source.bytes, 'raw evidence body and metadata bytes remain immutable');
      const fromReader = readback.evidence.find((evidence) => evidence.meta.id === source.captured.evidenceId)!;
      assert.deepEqual({ meta: fromReader.meta, body: fromReader.body }, source.document);
      const summary = requiredPage(readback, `source:${source.captured.evidenceId}`);
      const body = summary.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0]!.trim();
      assert.ok(body.includes(source.fixture.content), 'each source retains its own readable summary, conditions and verification date');
      if (sourceBodies.has(summary.meta.key)) assert.equal(body, sourceBodies.get(summary.meta.key));
      sourceBodies.set(summary.meta.key, body);
    }
    const atlas = requiredPage(readback, 'entity:atlas');
    assert.equal(atlas.meta.revision, stage + 1);
    assert.ok(atlas.body.includes(firstFact));
    assert.ok(atlas.meta.conditions.includes(initialCondition), 'later fixture drafts cannot discard the original deployment condition');
    if (stage > 0) {
      assert.equal(atlas.meta.id, requiredPage(previous, 'entity:atlas').meta.id);
      assert.equal(atlas.meta.createdAt, requiredPage(previous, 'entity:atlas').meta.createdAt);
      assert.ok(atlas.body.includes(secondFact));
      assert.ok(atlas.meta.conditions.includes(restoreLimitation));
      const synthesis = requiredPage(readback, 'synthesis:recovery');
      assert.ok(synthesis.body.includes(firstFact) && synthesis.body.includes(secondFact));
      assert.match(synthesis.body, /separate cutover/);
    }
    if (stage === 2) {
      assert.ok(proposed.plan.pages.some((page) => page.pageType === 'concept'));
      assert.ok(proposed.plan.pages.some((page) => page.pageType === 'comparison'));
      assert.match(requiredPage(readback, 'concept:rpo').body, /maximum acceptable data-loss interval/);
      assert.match(requiredPage(readback, 'comparison:atlas-beacon').body, /\| AtlasStore \|[\s\S]*\| BeaconDB \|/);
      assert.match(requiredPage(readback, 'entity:beacon').body, /continuous log replay/);
      assert.ok(atlas.meta.links.includes('comparison:atlas-beacon'));
    }
    const catalogText = await readFile(join(root, 'WIKI.md'), 'utf8');
    for (const page of readback.pages) {
      const persisted = parseMarkdown<WikiPageMeta>(await readFile(join(root, page.path), 'utf8'));
      assert.deepEqual(persisted, { meta: page.meta, body: page.body }, 'public readback agrees with canonical Markdown');
      assert.equal(page.meta.type, 'wiki-page');
      assert.equal(page.meta.scope, 'public');
      assert.equal(page.meta.sensitivity, 'public');
      assert.equal(page.meta.status, 'active');
      assert.ok(page.meta.title.length > 0 && page.meta.summary.length > 0);
      assert.ok(Number.isFinite(Date.parse(page.meta.createdAt)) && Number.isFinite(Date.parse(page.meta.updatedAt)));
      for (const source of sources) assert.ok(page.meta.evidence.includes(source.captured.evidencePath));
      for (const key of page.meta.links) assert.ok(readback.catalog.some((entry) => entry.key === key));
      for (const [key, revision] of Object.entries(page.meta.dependencies)) assert.equal(requiredPage(readback, key).meta.revision, revision);
      for (const link of extractMarkdownLinks(page.body)) await readFile(join(root, posix.normalize(posix.join(posix.dirname(page.path), link))));
      assert.ok(catalogText.includes(`](./${page.path})`));
      assert.ok(catalogText.includes(page.meta.summary));
    }
    const after = await canonical(vault);
    const callsBeforeReplay = service.requests.length;
    assert.deepEqual(await invoke(root, service.baseUrl, 'replay', proposed.plan), { apply: { pageIds: [], commit: null }, ingest: { duplicate: true, plan: null, commit: null } });
    assert.equal(service.requests.length, callsBeforeReplay, 'restart replay must not issue navigation, compile or embedding requests');
    assert.deepEqual(await canonical(vault), after, 'restart replay preserves every page revision, catalog/log byte and commit');
    previous = readback;
  }
  assert.deepEqual(service.requests.map((request) => request.operation), ['compile', 'navigate', 'compile', 'navigate', 'compile']);
  assert.equal((await vault.wikiLint()).issues.length, 0);
  assert.ok((await vault.search('Recovery point objective')).some((hit) => hit.kind === 'concept'));
});
