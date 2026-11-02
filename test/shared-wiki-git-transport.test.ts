import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { integrity } from './shared-wiki-fixture.js';
import { gitFixture } from './shared-wiki-git-fixture.js';

// Keep native transport environment changes isolated from filesystem/clock mocks.
for (const mode of ['cancel', 'timeout'] as const) test(`shared Git: a real blocked SSH helper is terminated on ${mode}, with no cached fallback`, { timeout: 15000 }, async t => {
  const { reader, input, binding, saveBindings, caller } = await gitFixture(t);
  const helper = join(caller.root, '.amem/synthetic-ssh'), started = helper + '.started';
  const command = await helperCommand(helper, started);
  environment(t, { GIT_SSH_COMMAND: command, GIT_SSH_VARIANT: 'ssh', GIT_TRACE: helper + '.trace' });
  binding.remote = 'ssh://git@synthetic.invalid/wiki'; binding.allowLocalFile = false; binding.timeoutMs = mode === 'timeout' ? 3500 : 10000; await saveBindings();
  const controller = new AbortController(), before = await integrity(caller), start = performance.now();
  const result = reader.snapshot({ ...input, signal: controller.signal }).then(() => null, error => error);
  try {
    await waitFor(async () => existsSync(started)); const pid = Number(await readFile(started, 'utf8'));
    if (mode === 'cancel') controller.abort();
    const failure = await result; assert.equal(failure?.code, mode === 'cancel' ? 'OPERATION_CANCELLED' : 'REMOTE_TRANSPORT');
    assert.ok(performance.now() - start < 7000); await assertStopped(pid); assert.deepEqual(await integrity(caller), before);
  } catch (error) { t.diagnostic(await readFile(helper + '.trace', 'utf8').catch(() => 'No synthetic Git trace')); throw error; }
  finally { controller.abort(); await result; }
});

test('shared Git: actual in-flight cache growth stops a blocked transport at the configured resource limit', { timeout: 15000 }, async t => {
  const { reader, input, binding, saveBindings, caller, cache } = await gitFixture(t);
  const helper = join(caller.root, '.amem/synthetic-growing-ssh'), started = helper + '.started';
  const command = await helperCommand(helper, started, join(cache, '.amem/growing-pack-canary'));
  environment(t, { GIT_SSH_COMMAND: command, GIT_SSH_VARIANT: 'ssh', GIT_TRACE: helper + '.trace' });
  binding.remote = 'ssh://git@synthetic.invalid/wiki'; binding.allowLocalFile = false; binding.maxCacheBytes = 64_000; binding.timeoutMs = 10000; await saveBindings();
  const before = await integrity(caller);
  try { await assert.rejects(reader.snapshot(input), { code: 'CONTENT_TOO_LARGE' }); }
  catch (error) { t.diagnostic(await readFile(helper + '.trace', 'utf8').catch(() => 'No synthetic Git trace')); throw error; }
  const pid = Number(await readFile(started, 'utf8')); await assertStopped(pid); assert.deepEqual(await integrity(caller), before);
});

function environment(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); let done = false;
  const restore = () => { if (done) return; done = true; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
  Object.assign(process.env, values); t.after(restore); return restore;
}
async function helperCommand(path: string, started: string, growing?: string): Promise<string> {
  if (process.platform === 'win32') {
    const script = path + '.cjs';
    await writeFile(script, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},String(process.pid));${growing ? `fs.writeFileSync(${JSON.stringify(growing)},Buffer.alloc(80000));` : ''}setInterval(()=>{},1000);`);
    return `${quote(process.execPath)} ${quote(script)}`;
  }
  // A transport-limit test should not depend on another Node runtime starting.
  // The trusted system interpreter executes only this synthetic helper.
  const script = path + '.sh';
  await writeFile(script, `echo "$$" > ${quote(started)}\n${growing ? `/usr/bin/head -c 80000 /dev/zero > ${quote(growing)}\n` : ''}exec /bin/sleep 30\n`);
  return `${quote('/bin/sh')} ${quote(script)}`;
}
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
async function assertStopped(pid: number) {
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
  if (process.platform === 'linux') {
    try { assert.match(await readFile(`/proc/${pid}/stat`, 'utf8'), /\) Z /); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  assert.fail('Git helper must be stopped before returning');
}
async function waitFor(check: () => Promise<boolean>) { const end = performance.now() + 5000; while (performance.now() < end) { if (await check().catch(() => false)) return; await delay(10); } throw new Error('Expected live fixture condition'); }
