import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { LlmClient } from '../src/llm.js';
import { cancellationError, operationSignal } from '../src/operation.js';
import { localAdminPrincipal, type Principal } from '../src/policy.js';
import { MemoryVault } from '../src/vault.js';
import { WikiJobStore } from '../src/wiki-job-store.js';
import { withFileLock } from '../src/utils.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

const key = '93'.repeat(32);
const exec = promisify(execFile);
function compiled(input: object) {
  const dto = input as { sources: Array<{ id: string; body: string }> };
  return { pages: dto.sources.map(source => ({ key: `source:${source.id}`, pageType: 'source', title: 'Source', summary: 'Source summary',
    body: `# Source\n\n${source.body}`, evidenceIds: [source.id], links: [], status: 'active', conditions: [], uncertainty: [] } satisfies WikiPageDraft)) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class Compiler extends LlmClient {
  calls: Array<{ operation: string; input: object }> = [];
  gate: (() => Promise<void>) | null = null;
  entered = deferred<void>();
  constructor() { super({ apiKey: 'fixture', model: 'wiki-job-fixture', embeddingModel: '' }); }
  override async wiki<T>(operation: 'navigate' | 'compile' | 'query' | 'lint', input: object): Promise<T> {
    this.calls.push({ operation, input });
    if (operation === 'navigate') return { keys: [] } as T;
    this.entered.resolve();
    if (this.gate) {
      const signal = operationSignal();
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(cancellationError());
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        this.gate!().then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
      });
    }
    return compiled(input) as T;
  }
}
async function fixture(t: TestContext) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/wiki-jobs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const llm = new Compiler();
  const vault = new MemoryVault(root, { masterKey: key, llm });
  await vault.initialize('wiki jobs');
  const source = await vault.capture({ content: 'DURABLE_JOB_SOURCE_CANARY', scope: 'public', sensitivity: 'public', extract: false });
  const input = { evidenceIds: [source.evidenceId] };
  return { root, llm, vault, source, input, reopen: (principal?: Principal) => new MemoryVault(root, { masterKey: key, llm, ...(principal ? { principal } : {}) }) };
}

test('Wiki jobs: persist encrypted proposals across instances without canonical writes, then explicitly apply', async t => {
  const { root, vault, input, llm, reopen } = await fixture(t);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const job = await vault.wikiEnqueue(input);
  assert.equal(job.status, 'queued'); assert.equal(job.attempts, 0);
  const worker = reopen();
  assert.equal((await worker.wikiRunJob({ id: job.id }))!.status, 'ready');
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.equal((await vault.wikiCatalog()).length, 0);
  const path = join(root, '.amem/wiki-jobs', `${job.id}.json`);
  const raw = await readFile(path, 'utf8');
  assert.ok(!raw.includes('DURABLE_JOB_SOURCE_CANARY') && !raw.includes(input.evidenceIds[0]!) && !raw.includes('ceiling'));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(await vault.wikiJobs()).includes('DURABLE_JOB_SOURCE_CANARY'), false);
  assert.equal((await reopen().wikiJob(job.id)).stage, 'finished');
  const plan = await reopen().wikiJobPlan(job.id);
  assert.ok(plan.pages[0]!.body.includes('DURABLE_JOB_SOURCE_CANARY'));
  const calls = llm.calls.length;
  assert.equal(await vault.wikiRunJob({ id: job.id }), null); assert.equal(llm.calls.length, calls);
  await vault.wikiApply(plan);
  const duplicate = await vault.wikiEnqueue(input);
  assert.equal((await vault.wikiRunJob({ id: duplicate.id }))!.status, 'duplicate');
  assert.equal(llm.calls.length, calls);
  await vault.wikiRemoveJob(job.id);
  await assert.rejects(vault.wikiJob(job.id), { code: 'NOT_FOUND' });
  assert.equal(await vault.encryption.hasKey(job.id), false);
});

test('Wiki jobs: authority loss rejects before provider, wider later authority does not broaden context, owner/tenant isolate status', async t => {
  const { vault, source, root, llm, reopen } = await fixture(t);
  const tenantId = (await vault.config()).tenantId;
  await vault.wikiSetRules({ purpose: 'PRIVATE_RULE_CANARY', instructions: 'Private project purpose.', scope: 'project', sensitivity: 'secret' });
  const writer: Principal = { id: 'writer', name: 'writer', tenantId, permissions: ['read', 'write'], scopes: ['public'], maxSensitivity: 'public' };
  const queued = await reopen(writer).wikiEnqueue({ evidenceIds: [source.evidenceId] });
  const before = llm.calls.length;
  await assert.rejects(reopen({ ...writer, permissions: ['read'] }).wikiRunJob({ id: queued.id }), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(reopen({ ...writer, maxSensitivity: 'public', scopes: ['project'] }).wikiRunJob({ id: queued.id }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal(llm.calls.length, before);
  const broader = { ...localAdminPrincipal({ id: 'writer', name: 'writer' }), tenantId };
  assert.equal((await reopen(broader).wikiRunJob({ id: queued.id }))!.status, 'ready');
  assert.ok(!JSON.stringify(llm.calls).includes('PRIVATE_RULE_CANARY'));
  assert.equal((await reopen(broader).wikiPreviewJob(queued.id)).pages.length, 1);
  await assert.rejects(reopen(writer).wikiApplyJob(queued.id), { code: 'AUTHORIZATION_DENIED' });
  const broadJob = await reopen(broader).wikiEnqueue({ evidenceIds: [source.evidenceId] });
  const narrowJob = await reopen(writer).wikiEnqueue({ evidenceIds: [source.evidenceId] });
  assert.deepEqual((await reopen(writer).wikiJobs()).map(job => job.id).sort(), [queued.id, narrowJob.id].sort());
  await assert.rejects(reopen(writer).wikiRunJob({ id: broadJob.id }), { code: 'AUTHORIZATION_DENIED' });
  assert.equal((await reopen(writer).wikiRunJob())!.id, narrowJob.id);
  assert.equal((await reopen(broader).wikiJob(broadJob.id)).status, 'queued');
  const reviewer: Principal = { ...broader, permissions: ['read', 'review'], email: 'reviewer@example.test' };
  assert.ok((await reopen(reviewer).wikiApplyJob(queued.id)).commit);
  assert.equal(await vault.git.run(['log', '-1', '--format=%ae']), 'reviewer@example.test');
  assert.deepEqual(await reopen({ ...writer, id: 'someone-else' }).wikiJobs(), []);
  await assert.rejects(reopen({ ...writer, id: 'someone-else' }).wikiJob(queued.id), { code: 'NOT_FOUND' });
  await assert.rejects(reopen({ ...writer, tenantId: 'foreign' }).wikiJobs(), { code: 'AUTHORIZATION_DENIED' });
  await assert.rejects(new MemoryVault(root, { masterKey: '' }).wikiEnqueue({ evidenceIds: [source.evidenceId] }), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
  await assert.rejects(new MemoryVault(root, { masterKey: '94'.repeat(32), principal: writer }).wikiJob(queued.id), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
});

test('Wiki jobs: pending erasure without a transaction blocks queue reads and provider execution until recovery', async t => {
  const { vault, root, input, llm, reopen } = await fixture(t);
  const secret = await vault.capture({ content: 'PENDING_ERASURE_CANARY', scope: 'project', sensitivity: 'secret', extract: false });
  await vault.wikiIngest({ evidenceIds: [secret.evidenceId], apply: true });
  const page = (await vault.wikiCatalog())[0]!;
  const job = await vault.wikiEnqueue(input), before = llm.calls.length;
  const original = vault.encryption.erase.bind(vault.encryption);
  vault.encryption.erase = async id => { if (id === page.id) throw new Error('simulated pre-key erasure failure'); return original(id); };
  await assert.rejects(vault.erase(page.id, 'test durable intent'), /simulated/);
  assert.ok((await stat(join(root, '.amem', 'erasures'))).isDirectory());
  await assert.rejects(reopen().wikiJob(job.id), { code: 'TRANSACTION_RECOVERY_FAILED' });
  await assert.rejects(reopen().wikiRunJob({ id: job.id }), { code: 'TRANSACTION_RECOVERY_FAILED' });
  assert.equal(llm.calls.length, before);
  await reopen().recover();
  assert.equal((await reopen().wikiJob(job.id)).status, 'queued');
});

test('Wiki jobs: caller cancellation and deadline during actual encrypted publication cannot leave a usable ready plan', async t => {
  const { vault, input } = await fixture(t);
  const original = WikiJobStore.prototype.write;
  const caller = new AbortController();
  let target = '';
  let mode: 'caller' | 'deadline' = 'caller';
  let fireDeadline: (() => void) | undefined;
  let publications = 0;
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => {
    if (milliseconds === 12345) fireDeadline = () => callback(...args);
    return schedule(callback, milliseconds, ...args);
  }) as typeof setTimeout);
  t.mock.method(WikiJobStore.prototype, 'write', async function(this: WikiJobStore, value: Parameters<WikiJobStore['write']>[0]) {
    await original.call(this, value);
    if (value.id === target && (value as typeof value & { status?: string }).status === 'ready') {
      publications++;
      if (mode === 'caller') caller.abort();
      else { assert.ok(fireDeadline); fireDeadline(); }
      await new Promise(resolve => schedule(resolve, 0));
    }
  });
  const job = await vault.wikiEnqueue(input); target = job.id;
  assert.equal((await vault.wikiRunJob({ id: job.id, signal: caller.signal }))!.status, 'cancelled');
  await assert.rejects(vault.wikiJobPlan(job.id), { code: 'VALIDATION_FAILED' });
  const next = await vault.wikiEnqueue(input); target = next.id; mode = 'deadline';
  const result = await vault.wikiRunJob({ id: next.id, timeoutMs: 12345 });
  assert.equal(result!.status, 'failed'); assert.equal(result!.error!.reason, 'deadline');
  await assert.rejects(vault.wikiJobPlan(next.id), { code: 'VALIDATION_FAILED' });
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  assert.equal(publications, 2, 'both stop cases must reach the real encrypted ready publication');
});

test('Wiki jobs: actual death after replacement key persistence cannot poison canonical erasure recovery', { timeout: 15000 }, async t => {
  const { vault, input, root } = await fixture(t);
  const secret = await vault.capture({ content: 'ROTATION_ERASURE_CANARY', scope: 'project', sensitivity: 'secret', extract: false });
  await vault.wikiIngest({ evidenceIds: [secret.evidenceId], apply: true });
  const page = (await vault.wikiCatalog())[0]!;
  const job = await vault.wikiEnqueue(input); await vault.wikiRunJob({ id: job.id });
  const old = JSON.parse(await readFile(join(root, '.amem/wiki-jobs', `${job.id}.json`), 'utf8')) as { meta: Parameters<typeof vault.encryption.decrypt>[0]; body: string };
  const program = `import { MemoryVault } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
    import { EncryptionManager } from ${JSON.stringify(new URL('../dist/encryption.js', import.meta.url).href)};
    const encrypt = EncryptionManager.prototype.encrypt;
    EncryptionManager.prototype.encrypt = async function(meta,...args) { const result=await encrypt.call(this,meta,...args);
      if(meta.type==='wiki-job') process.kill(process.pid,'SIGKILL'); return result; };
    await new MemoryVault(process.argv[1],{masterKey:process.env.AMEM_MASTER_KEY}).erase(process.argv[2],'test rotation boundary');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, root, page.id], { env: { ...process.env, AMEM_MASTER_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  assert.equal(await new Promise(resolve => child.once('exit', (_code, signal) => resolve(signal))), 'SIGKILL');
  await assert.rejects(stat(join(root, '.amem/wiki-jobs', `${job.id}.json`)), { code: 'ENOENT' });
  await vault.recover();
  await assert.rejects(vault.wikiJob(job.id), { code: 'NOT_FOUND' });
  await assert.rejects(vault.encryption.decrypt(old.meta, old.body), { code: 'ENCRYPTION_FAILED' });
  assert.equal(await vault.encryption.hasKey(page.id), false);
});

test('Wiki jobs: concurrent claims, persisted cancellation, explicit retries and owned deadlines', async t => {
  const { vault, input, llm, reopen } = await fixture(t);
  const first = await vault.wikiEnqueue(input), second = await vault.wikiEnqueue(input);
  const gate = deferred<void>(); llm.gate = () => gate.promise;
  const running = vault.wikiRunJob({ id: first.id }); await llm.entered.promise;
  assert.equal(await reopen().wikiRunJob({ id: second.id }), null);
  assert.equal((await vault.wikiJob(second.id)).status, 'queued');
  await assert.rejects(vault.wikiRemoveJob(first.id), { code: 'LOCK_TIMEOUT' });
  assert.equal((await vault.wikiCancelJob(first.id)).cancelRequested, true);
  assert.equal((await running)!.status, 'cancelled');
  gate.resolve(); llm.gate = null;
  await vault.wikiRetryJob(first.id);
  assert.equal((await vault.wikiRunJob({ id: first.id }))!.status, 'ready');
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(vault.wikiRunJob({ id: second.id, signal: stopped.signal }), { code: 'OPERATION_CANCELLED' });
  assert.equal(getEventListeners(stopped.signal, 'abort').length, 0);
  const pending = deferred<void>(); llm.gate = () => pending.promise;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await vault.wikiRunJob({ id: second.id, timeoutMs: 40 });
    assert.equal(result!.status, 'failed'); assert.equal(result!.error!.reason, 'deadline'); assert.equal(result!.attempts, attempt);
    if (attempt < 3) await vault.wikiRetryJob(second.id);
  }
  await assert.rejects(vault.wikiRetryJob(second.id), { code: 'VALIDATION_FAILED' });
  pending.resolve();
  assert.equal(await vault.wikiRunJob(), null);
  assert.equal((await vault.wikiCatalog()).length, 0);
});

test('Wiki jobs: current snapshots reject stale result reads and bad source state fails before provider', async t => {
  const { vault, root, input, llm, source } = await fixture(t);
  const job = await vault.wikiEnqueue(input);
  assert.equal((await vault.wikiRunJob())!.status, 'ready');
  await vault.wikiSetRules({ purpose: 'New purpose', instructions: 'Require current sources.', scope: 'public', sensitivity: 'public' });
  await assert.rejects(vault.wikiJobPlan(job.id), { code: 'VALIDATION_FAILED' });
  const next = await vault.wikiEnqueue(input);
  const path = join(root, source.evidencePath), original = await readFile(path, 'utf8');
  await writeFile(path, original.replace('DURABLE_JOB_SOURCE_CANARY', 'TAMPERED_JOB_SOURCE_CANARY'));
  const count = llm.calls.length;
  assert.equal((await vault.wikiRunJob({ id: next.id }))!.status, 'failed');
  assert.equal(llm.calls.length, count);
});

test('Wiki jobs: canonical erasure destroys retained plan keys and invalidates active claims', async t => {
  const { vault, root, input, llm } = await fixture(t);
  const confidential = await vault.capture({ content: 'ERASE_JOB_CANARY', scope: 'project', sensitivity: 'secret', extract: false });
  await vault.wikiIngest({ evidenceIds: [confidential.evidenceId], apply: true });
  const page = (await vault.wikiCatalog())[0]!;
  const ready = await vault.wikiEnqueue(input);
  assert.equal((await vault.wikiRunJob({ id: ready.id }))!.status, 'ready');
  const path = join(root, '.amem/wiki-jobs', `${ready.id}.json`);
  const old = JSON.parse(await readFile(path, 'utf8')) as { meta: Parameters<typeof vault.encryption.decrypt>[0]; body: string };
  const pending = deferred<void>(); llm.gate = () => pending.promise; llm.entered = deferred<void>();
  const active = await vault.wikiEnqueue(input);
  const running = vault.wikiRunJob({ id: active.id }); await llm.entered.promise;
  await vault.erase(page.id, 'remove retained private context');
  pending.resolve();
  assert.equal((await running)!.error!.reason, 'context-erased');
  assert.equal((await vault.wikiJob(ready.id)).error!.reason, 'context-erased');
  await assert.rejects(vault.wikiJobPlan(ready.id), { code: 'VALIDATION_FAILED' });
  await assert.rejects(vault.encryption.decrypt(old.meta, old.body), { code: 'ENCRYPTION_FAILED' });
});

test('Wiki jobs: killed process is detected but not automatically retried, and explicit retry recovers', { timeout: 15000 }, async t => {
  const { vault, input, root } = await fixture(t);
  const job = await vault.wikiEnqueue(input);
  const program = `import { MemoryVault, LlmClient } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
    class Pending extends LlmClient { async wiki() { process.send({ started: true }); return new Promise(() => {}); } }
    const vault = new MemoryVault(process.argv[1], { masterKey: process.env.AMEM_MASTER_KEY, llm: new Pending({apiKey:'fixture'}) });
    await vault.wikiRunJob({ id: process.argv[2] });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, root, job.id], { env: { ...process.env, AMEM_MASTER_KEY: key }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', () => reject(new Error('Worker exited before compiling'))); });
  assert.equal((await vault.wikiJob(job.id)).status, 'running');
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  assert.equal(await vault.wikiRunJob(), null);
  assert.equal((await vault.wikiJob(job.id)).error!.reason, 'worker-interrupted');
  assert.equal((await vault.wikiJob(job.id)).attempts, 1);
  await vault.wikiRetryJob(job.id);
  assert.equal((await vault.wikiRunJob({ id: job.id }))!.status, 'ready');
});

test('Wiki jobs: death after atomic result publication preserves a readable plan without another model call', { timeout: 15000 }, async t => {
  const { vault, input, root, llm } = await fixture(t);
  const job = await vault.wikiEnqueue(input);
  const program = `import { MemoryVault, LlmClient } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
    import { WikiJobStore } from ${JSON.stringify(new URL('../dist/wiki-job-store.js', import.meta.url).href)};
    const write = WikiJobStore.prototype.write;
    WikiJobStore.prototype.write = async function(job) { await write.call(this, job); if(job.status === 'ready') process.kill(process.pid,'SIGKILL'); };
    class Fixture extends LlmClient { async wiki(operation,input) { if(operation==='navigate') return {keys:[]};
      return {pages: input.sources.map(s=>({key:'source:'+s.id,pageType:'source',title:'Source',summary:'Source',body:s.body,
        evidenceIds:[s.id],links:[],status:'active',conditions:[],uncertainty:[]}))}; } }
    await new MemoryVault(process.argv[1], { masterKey:process.env.AMEM_MASTER_KEY,llm:new Fixture({apiKey:'fixture'}) }).wikiRunJob({id:process.argv[2]});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, root, job.id], { env: { ...process.env, AMEM_MASTER_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const signal = await new Promise(resolve => child.once('exit', (_code, signal) => resolve(signal)));
  assert.equal(signal, 'SIGKILL');
  assert.equal((await vault.wikiJob(job.id)).status, 'ready');
  assert.ok((await vault.wikiJobPlan(job.id)).pages[0]!.body.includes('DURABLE_JOB_SOURCE_CANARY'));
  assert.equal(await vault.wikiRunJob({ id: job.id }), null); assert.equal(llm.calls.length, 0);
});

test('Wiki jobs: bounded private runtime files, symlink refusal, queue capacity and interrupted key rotation recovery', async t => {
  const { vault, root, input } = await fixture(t);
  await assert.rejects(vault.wikiEnqueue({ evidenceIds: [] }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(vault.wikiEnqueue({ evidenceIds: Array.from({ length: 41 }, (_, n) => `ev-${n.toString(16).padStart(12, '0')}`) }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(vault.wikiJob('../keys'), { code: 'VALIDATION_FAILED' });
  const outside = join(root, 'outside'); await mkdir(outside);
  await symlink(outside, join(root, '.amem/wiki-jobs'));
  await assert.rejects(vault.wikiEnqueue(input), { code: 'VALIDATION_FAILED' });
  await rm(join(root, '.amem/wiki-jobs'));
  const job = await vault.wikiEnqueue(input);
  const store = new WikiJobStore(root, vault.encryption);
  const value = await store.read(job.id) as { id: string; createdAt: string };
  await assert.rejects(store.write({ ...value, huge: 'x'.repeat(5_000_000) } as typeof value), { code: 'CONTENT_TOO_LARGE' });
  const path = join(root, '.amem/wiki-jobs', `${job.id}.json`), raw = await readFile(path);
  const file = await open(path, 'r+'); await file.truncate(8_000_001); await file.close();
  await assert.rejects(vault.wikiJob(job.id), { code: 'VALIDATION_FAILED' }); await writeFile(path, raw);
  await withFileLock(join(root, '.amem/write.lock'), async () => {
    for (let n = 0; n < 99; n++) await store.write({ ...value, id: `wj-${n.toString(16).padStart(32, '0')}` });
  });
  await assert.rejects(vault.wikiEnqueue(input), { code: 'CONTENT_TOO_LARGE' });
  // Simulate the erasure boundary after destroying a cached job key.
  await vault.encryption.erase(job.id);
  assert.equal((await vault.wikiJobs()).length, 99);
  await assert.rejects(vault.wikiJob(job.id), { code: 'NOT_FOUND' });
  const { invalidateWikiJobPlans } = await import('../src/wiki-jobs.js');
  await withFileLock(join(root, '.amem/write.lock'), () => invalidateWikiJobPlans(root, vault.encryption));
  await assert.rejects(vault.wikiJob(job.id), { code: 'NOT_FOUND' });
});

test('Wiki jobs CLI: real provider HTTP, process-separated enqueue/run/preview/apply and least-privilege refusal', { timeout: 30000 }, async t => {
  const { vault, root, input } = await fixture(t);
  let calls = 0, hold = false;
  let reached = deferred<void>();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const content = JSON.parse(payload.messages.at(-1).content);
    calls++;
    if (hold) { reached.resolve(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(compiled(content.input ?? content)) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const env = { ...process.env, AMEM_MASTER_KEY: key, AMEM_LLM_API_KEY: 'fixture', AMEM_LLM_MODEL: 'wiki-job-fixture', AMEM_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  const cli = join(process.cwd(), 'dist/cli.js');
  const invoke = async (...args: string[]) => JSON.parse((await exec(process.execPath, [cli, 'wiki', 'jobs', ...args, '--root', root], { env, timeout: 20000 })).stdout);
  const queued = await invoke('enqueue', ...input.evidenceIds);
  assert.equal((await invoke('run', queued.id)).status, 'ready');
  assert.equal((await invoke('show', queued.id)).attempts, 1);
  assert.equal((await invoke('plan', queued.id)).pages.length, 1);
  assert.equal((await invoke('preview', queued.id)).pages.length, 1);
  assert.equal((await vault.wikiCatalog()).length, 0);
  const tenantId = (await vault.config()).tenantId;
  await assert.rejects(exec(process.execPath, [cli, 'wiki', 'jobs', 'apply', queued.id, '--root', root],
    { env: { ...env, AMEM_TENANT_ID: tenantId, AMEM_PERMISSIONS: 'read,write' } }), error => /AUTHORIZATION_DENIED/.test(String((error as { stderr?: string }).stderr)));
  assert.ok((await invoke('apply', queued.id)).commit);
  assert.equal(calls, 1);
  assert.equal((await invoke('work', '--once')), null);
  const next = await vault.capture({ content: 'Another source for worker stop.', extract: false });
  const queuedNext = await invoke('enqueue', next.evidenceId);
  hold = true; reached = deferred<void>();
  const worker = spawn(process.execPath, [cli, 'wiki', 'jobs', 'work', '--root', root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (worker.exitCode === null) worker.kill('SIGKILL'); });
  await reached.promise;
  const exit = new Promise(resolve => worker.once('exit', resolve)); worker.kill('SIGTERM');
  assert.equal(await exit, 130);
  assert.equal((await vault.wikiJob(queuedNext.id)).status, 'cancelled');
});
