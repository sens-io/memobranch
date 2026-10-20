import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataset, validateDataset } from '../evaluation/cases.mjs';
import { assess, EvaluationBudgetError, FixtureClient, LiveClient, normalizeOptions, parseArgs, renderMarkdown, runEvaluation, summarize } from './evaluate-memory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
async function outputDirectory(t) {
  const parent = join(root, '.scratch/evaluation-tests'); await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, 'test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const liveOptions = (extra = {}) => ({ apiKey: 'test-key-MUST-NOT-APPEAR', baseUrl: 'https://provider.example/v1', model: 'test-model', maxCalls: 5, maxRunMs: 30_000, timeoutMs: 1000, maxOutputTokens: 100, ...extra });
const response = (value, usage = { prompt_tokens: 11, completion_tokens: 7 }) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }], ...(usage ? { usage } : {}) }), { headers: { 'Content-Type': 'application/json' } });

test('37 synthetic tasks have unique IDs, all required boundaries, positive facts and valid source identities', () => {
  assert.equal(validateDataset().cases.length, 37);
  assert.equal(new Set(dataset.cases.map((item) => item.category)).size, 8);
  assert.ok(dataset.cases.some((item) => item.expected.status === 'conflict'));
  assert.ok(dataset.cases.some((item) => item.expected.status === 'insufficient'));
  const duplicate = structuredClone(dataset); duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => validateDataset(duplicate), /unique/);
  const badSource = structuredClone(dataset); badSource.cases[0].expected.sourceIds = ['invented'];
  assert.throws(() => validateDataset(badSource), /Unknown expected source/);
  const emptyPositive = structuredClone(dataset); emptyPositive.cases[0].expected.facts = {};
  assert.throws(() => validateDataset(emptyPositive), /positive facts/);
  const ungrounded = structuredClone(dataset); ungrounded.cases[0].expected.facts['response.language'] = 'invented';
  assert.throws(() => validateDataset(ungrounded), /grounded/);
});

test('fixture infers only from supplied public records, not case truth or expected-answer substrings', async () => {
  const client = new FixtureClient();
  const question = 'Requested fact keys: ["color"]';
  assert.deepEqual(JSON.parse(await client.answer(question, '[]')), { status: 'insufficient', facts: {}, citations: [] });
  const context = [{ path: 'wiki/green.md', body: 'EVAL_RECORD_JSON={"sourceId":"green","facts":{"color":"green"},"order":0,"replacement":false}', status: 'active' }];
  assert.deepEqual(JSON.parse(await client.answer(question, JSON.stringify(context))), { status: 'answer', facts: { color: 'green' }, citations: ['wiki/green.md'] });
  assert.equal(client.calls.some((call) => call.provider), false);
});

test('mechanical correctness rejects misleading substrings, absent facts, forged bindings and silent writes', () => {
  const item = dataset.cases[0];
  const observation = { citations: [{ evidence: ['evidence/p0.md'] }], allowedCitationIds: ['wiki/p0.md'], sourcePaths: { p0: 'evidence/p0.md' }, exposedSourceIds: ['p0'], citationsValid: true, readOnly: true };
  const correct = { status: 'answer', facts: { 'response.language': 'Chinese' }, citations: ['wiki/p0.md'] };
  assert.equal(assess(item, correct, observation).status, 'pass');
  for (const answer of [
    { ...correct, facts: { 'response.language': 'not Chinese' } },
    { ...correct, facts: {} },
    { ...correct, facts: { ...correct.facts, guessed: true } },
    { ...correct, citations: ['wiki/invented.md'] },
  ]) assert.equal(assess(item, answer, observation).status, 'fail');
  assert.equal(assess(item, correct, { ...observation, citationsValid: false }).status, 'fail');
  assert.equal(assess(item, correct, { ...observation, readOnly: false }).status, 'fail');
  assert.equal(assess(item, correct, observation).semanticReview.status, 'not-reviewed');
});

test('live options require explicit paid-run budgets and reject unpriced cost caps, secrets in URL and outside output', () => {
  assert.equal(normalizeOptions().mode, 'fixture');
  assert.throws(() => normalizeOptions({ mode: 'live' }), /requires explicit/);
  assert.throws(() => normalizeOptions({ mode: 'live', ...liveOptions(), maxCalls: undefined }), /Invalid positive integer/);
  assert.throws(() => normalizeOptions({ mode: 'live', ...liveOptions(), maxCostUsd: 1 }), /requires both/);
  assert.throws(() => normalizeOptions({ mode: 'live', ...liveOptions(), baseUrl: 'https://user:secret@provider.example/v1' }), /credentials/);
  assert.throws(() => normalizeOptions({ output: '/tmp/evaluation' }), /inside this repository/);
  assert.throws(() => parseArgs(['--api-key', 'unsafe']), /Unknown option/);
  assert.deepEqual(parseArgs(['--strategies', 'none,wiki', '--max-calls', '4']), { strategies: ['none', 'wiki'], maxCalls: 4 });
});

test('live calls use provider usage, explicit prices, no retries, and stop at the request budget', async () => {
  let requests = 0;
  const client = new LiveClient(liveOptions({ maxCalls: 1, inputUsdPerMillion: 2, outputUsdPerMillion: 4, fetch: async (_url, options) => {
    requests += 1;
    const sent = JSON.parse(options.body);
    assert.equal(sent.max_tokens, 100); assert.equal(sent.temperature, 0);
    assert.ok(options.signal instanceof AbortSignal);
    return response({ status: 'insufficient', facts: {}, citations: [] });
  } }));
  await client.answer('Question', '[]');
  assert.deepEqual(client.calls[0].tokens, { input: 11, output: 7, total: 18, source: 'provider response usage' });
  assert.equal(client.calls[0].costUsd, 50 / 1_000_000);
  await assert.rejects(client.answer('Question', '[]'), EvaluationBudgetError);
  assert.equal(requests, 1);
  assert.equal(JSON.stringify(client.calls).includes('MUST-NOT-APPEAR'), false);
});

test('unknown usage remains null and stops further cost-budget requests; failed HTTP bodies are not retained', async () => {
  const missing = new LiveClient(liveOptions({ maxCostUsd: 1, inputUsdPerMillion: 1, outputUsdPerMillion: 1, fetch: async () => response({ keys: [] }, null) }));
  await missing.wiki('navigate', { catalog: [] });
  assert.equal(missing.calls[0].tokens, null); assert.equal(missing.calls[0].costUsd, null);
  await assert.rejects(missing.wiki('navigate', { catalog: [] }), EvaluationBudgetError);
  const failed = new LiveClient(liveOptions({ fetch: async () => new Response('test-key-MUST-NOT-APPEAR private provider body', { status: 500 }) }));
  await assert.rejects(failed.answer('Question', '[]'));
  assert.equal(failed.calls.length, 1); assert.equal(failed.calls[0].status, 'error');
  assert.equal(JSON.stringify(failed.calls).includes('MUST-NOT-APPEAR'), false);
});

test('provider timeout is recorded as an error and never as a successful refusal', async () => {
  const client = new LiveClient(liveOptions({ fetch: async () => { throw new DOMException('synthetic deadline', 'TimeoutError'); } }));
  await assert.rejects(client.answer('Question', '[]'));
  assert.equal(client.calls[0].error.code, 'PROVIDER_TIMEOUT');
  assert.equal(client.calls[0].tokens, null);
  const rows = summarize([{ strategy: 'none', status: 'error', expectedStatus: 'insufficient', queryLatencyMs: 1 }, { strategy: 'none', status: 'budget-skipped', expectedStatus: 'insufficient', queryLatencyMs: null }], ['none']);
  assert.equal(rows[0].total, 2); assert.equal(rows[0].refusalPassed, 0); assert.equal(rows[0].error, 1); assert.equal(rows[0]['budget-skipped'], 1);
});

test('real resettable vaults persist preference/update and enforce withdrawal/public-reader filtering; reports remain honest', { timeout: 60_000 }, async (t) => {
  const output = await outputDirectory(t);
  const temporaryParent = join(root, '.scratch/evaluation-vaults'); await mkdir(temporaryParent, { recursive: true });
  const before = (await readdir(temporaryParent)).sort();
  const { report, output: runOutput } = await runEvaluation({ output, caseIds: ['preference-language', 'update-command', 'revoked-venue', 'authorization-sensitivity'], strategies: ['none', 'wiki'] });
  assert.equal(report.results.length, 8);
  assert.equal(report.results.filter((row) => row.strategy === 'wiki' && row.status === 'pass').length, 4);
  assert.equal(report.results.some((row) => row.status === 'error'), false);
  assert.equal(report.usage.requests, 0); assert.equal(report.usage.tokens, null); assert.equal(report.usage.costUsd, null);
  assert.match(report.qualityClaim, /NOT real LLM quality/);
  assert.equal(report.code.evaluatorSha256.length, 64);
  const json = JSON.parse(await readFile(join(runOutput, 'report.json'), 'utf8'));
  assert.equal(json.runId, report.runId);
  const markdown = await readFile(join(runOutput, 'report.md'), 'utf8');
  assert.match(markdown, /NOT REAL LLM QUALITY/); assert.match(markdown, /not reviewed/);
  assert.equal(report.results.every((row) => row.assessment?.semanticReview.status === 'not-reviewed'), true);
  assert.deepEqual((await readdir(temporaryParent)).sort(), before, 'all temporary vault directories must be removed');
});

test('live mocked HTTP run keeps pass/error/budget-skipped distinct and never reports fixture as provider quality', { timeout: 30_000 }, async (t) => {
  const output = await outputDirectory(t);
  const { report } = await runEvaluation({ mode: 'live', ...liveOptions({ maxCalls: 1, fetch: async () => response({ status: 'insufficient', facts: {}, citations: [] }) }), caseIds: ['missing-budget'], output });
  assert.equal(report.usage.requests, 1);
  assert.equal(report.results[0].status, 'pass');
  assert.deepEqual(report.results.slice(1).map((row) => row.status), ['budget-skipped', 'budget-skipped']);
  assert.equal(report.usage.costUsd, null); assert.equal(report.usage.tokens.total, 18);
  assert.match(renderMarkdown(report), /LIVE PROVIDER QUERY EVALUATION/);
  assert.match(renderMarkdown(report), /live ingestion quality was not measured/);
  assert.equal(JSON.stringify(report).includes('MUST-NOT-APPEAR'), false);
  assert.equal(report.results[0].assessment.semanticReview.status, 'not-reviewed');
});

test('external baseline reports are compatible only with the same dataset, selected cases, strategy and provider/config identity', { timeout: 30_000 }, async (t) => {
  const output = await outputDirectory(t);
  const options = { output, caseIds: ['missing-budget'], strategies: ['wiki'] };
  const first = await runEvaluation(options);
  const second = await runEvaluation({ ...options, baselineReport: join(first.output, 'report.json') });
  assert.equal(second.report.baseline.compatible, true);
  const changed = await runEvaluation({ ...options, strategies: ['none'], baselineReport: join(first.output, 'report.json') });
  assert.equal(changed.report.baseline.compatible, false);
  assert.match(changed.report.baseline.note, /must not be ranked/);
});
