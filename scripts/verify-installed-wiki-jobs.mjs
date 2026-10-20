// Installed consumer only. Model responses are fixtures over real loopback HTTP.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MemoryVault, LlmClient } from 'memobranch';

let calls = 0, hold = false, reached;
const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const { operation, input } = JSON.parse(JSON.parse(Buffer.concat(chunks).toString()).messages.at(-1).content);
  calls++;
  if (hold) { reached(); return; }
  const result = operation === 'navigate' ? { keys: [] } : { pages: input.sources.map(source => ({
    key: `source:${source.id}`, pageType: 'source', title: 'Source', summary: 'Source summary', body: source.body,
    evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [],
  })) };
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const masterKey = '91'.repeat(32);
const llm = new LlmClient({ baseUrl, apiKey: 'fixture', model: 'wiki-job-fixture' });
const vault = new MemoryVault(join(process.cwd(), 'wiki-job-vault'), { masterKey, llm });
const exec = promisify(execFile), cli = join(process.cwd(), 'node_modules/memobranch/dist/cli.js');
const env = { ...process.env, AMEM_MASTER_KEY: masterKey, AMEM_LLM_BASE_URL: baseUrl, AMEM_LLM_API_KEY: 'fixture', AMEM_LLM_MODEL: llm.model };
const invoke = async (...args) => JSON.parse((await exec(process.execPath, [cli, 'wiki', 'jobs', ...args, '--root', vault.root], { env, timeout: 20000 })).stdout);
try {
  await vault.initialize('installed Wiki jobs');
  const source = await vault.capture({ content: 'INSTALLED_JOB_SOURCE_CANARY', extract: false, scope: 'public', sensitivity: 'public' });
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const job = await invoke('enqueue', source.evidenceId);
  assert.equal((await invoke('run', job.id)).status, 'ready');
  assert.equal((await invoke('show', job.id)).attempts, 1);
  assert.equal((await invoke('list')).length, 1);
  assert.equal((await invoke('preview', job.id)).pages.length, 1);
  const plan = await vault.wikiJobPlan(job.id);
  assert.ok(plan.pages[0].body.includes('INSTALLED_JOB_SOURCE_CANARY'));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal((await vault.wikiCatalog()).length, 0);
  const raw = await readFile(join(vault.root, '.amem/wiki-jobs', `${job.id}.json`), 'utf8');
  assert.ok(!raw.includes('INSTALLED_JOB_SOURCE_CANARY') && !raw.includes(source.evidenceId));
  const tenantId = (await vault.config()).tenantId;
  await assert.rejects(exec(process.execPath, [cli, 'wiki', 'jobs', 'apply', job.id, '--root', vault.root], {
    env: { ...env, AMEM_TENANT_ID: tenantId, AMEM_PERMISSIONS: 'read,write' }, timeout: 20000,
  }), error => /AUTHORIZATION_DENIED/.test(error.stderr));
  assert.ok((await invoke('apply', job.id)).commit);
  const duplicate = await vault.wikiEnqueue({ evidenceIds: [source.evidenceId] });
  const before = calls;
  assert.equal((await vault.wikiRunJob({ id: duplicate.id })).status, 'duplicate'); assert.equal(calls, before);
  const next = await vault.capture({ content: 'Second installed job source.', extract: false, scope: 'public', sensitivity: 'public' });
  const cancelled = await vault.wikiEnqueue({ evidenceIds: [next.evidenceId] });
  hold = true; const started = new Promise(resolve => { reached = resolve; });
  const stop = new AbortController(), pending = vault.wikiRunJob({ id: cancelled.id, signal: stop.signal });
  await started; stop.abort();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  hold = false;
  await invoke('retry', cancelled.id);
  assert.equal((await invoke('work', '--once')).status, 'ready');
  await invoke('remove', cancelled.id);
  assert.equal(await vault.encryption.hasKey(cancelled.id), false);
  const confidential = await vault.capture({ content: 'Installed secret page.', extract: false, scope: 'project', sensitivity: 'secret' });
  await vault.wikiIngest({ evidenceIds: [confidential.evidenceId], apply: true });
  const secretPage = (await vault.wikiCatalog()).find(page => page.sensitivity === 'secret');
  assert.ok(secretPage);
  await vault.erase(secretPage.id, 'installed job cache invalidation');
  assert.equal((await vault.wikiJob(job.id)).error.reason, 'context-erased');
  await assert.rejects(vault.wikiJobPlan(job.id), { code: 'VALIDATION_FAILED' });
  assert.ok(calls >= 5, 'must reach the actual HTTP fixture');
  console.log('Installed package: durable encrypted Wiki jobs, public types/API/CLI, explicit approval, owned cancellation/retry, duplicate avoidance and erasure invalidation passed (fixture model, no external provider quality claim).');
} finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
