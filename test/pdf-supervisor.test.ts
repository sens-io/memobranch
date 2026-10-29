import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { runPdfSupervisor } from '../src/pdf-supervisor.js';
import { withOperation } from '../src/operation.js';

// These run real local processes and test the Node coordination/receipt protocol.
// They do not emulate or claim to verify Windows Job Object or ACL behavior.
async function fixture(t: TestContext, mode = 'normal') {
  const root = await mkdtemp(join(process.cwd(), '.scratch/pdf-supervisor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root,'supervisor.mjs'), marker = join(root,'started'), token = randomBytes(16).toString('hex');
  await writeFile(script, `import fs from 'node:fs';import readline from 'node:readline';
const mode=${JSON.stringify(mode)},started=${JSON.stringify(marker)};
const input=readline.createInterface({input:process.stdin});
input.once('line',line=>{const request=JSON.parse(line);fs.writeFileSync(started,String(process.pid));
const receipt='\\nMEMOBRANCH_PDF_SETTLED:'+request.token+'\\n';
const finish=code=>{process.stderr.write(receipt,()=>process.exit(code));};
if(mode==='normal'){process.stdout.write(Buffer.from([0,255,128,10,0]),()=>{process.stderr.write('native diagnostics\\n',()=>finish(0));});}
else if(mode==='missing'){process.stdout.write('not a completed result',()=>process.exit(0));}
else if(mode==='wrong'){process.stderr.write(receipt+'extra',()=>process.exit(0));}
else if(mode==='overflow'){process.stdout.write(Buffer.alloc(10001));setInterval(()=>{},1000);input.once('close',()=>finish(125));}
else if(mode==='diagnostics'){process.stderr.write(Buffer.alloc(65537,65),()=>finish(0));}
else if(mode==='nonzero'){finish(7);}
else {setInterval(()=>{},1000);if(mode==='cooperate')input.once('close',()=>finish(125));}
});`);
  let cleaned = false;
  const run = (options: { end?: number; maximum?: number; cleanup?: () => Promise<void>; token?: string; extra?: object } = {}) => runPdfSupervisor(
    { file: process.execPath, args: [script] }, { token: options.token ?? token, ...options.extra }, {
      cwd: root, env: {}, end: options.end ?? performance.now()+10_000, maximum: options.maximum ?? 10_000,
      cleanup: options.cleanup ?? (async () => { await delay(30); cleaned = true; }),
    });
  return { root, marker, run, cleaned: () => cleaned };
}
async function started(path: string) { const end=performance.now()+5000;while(!existsSync(path)){assert.ok(performance.now()<end,'Expected the actual supervisor process to read its request');await delay(10);} }

test('PDF supervisor: binary output is exact and only the complete final cleanup receipt is removed', async t => {
  const f=await fixture(t), result=await f.run();
  assert.deepEqual(result.out,Buffer.from([0,255,128,10,0])); assert.equal(result.err.toString(),'native diagnostics\n');assert.equal(f.cleaned(),false);
});
for(const mode of ['missing','wrong']) test(`PDF supervisor: ${mode} completion receipt requires awaited cleanup and refuses output`, async t => {
  const f=await fixture(t,mode);await assert.rejects(f.run(),{code:'DEPENDENCY_UNAVAILABLE'});assert.equal(f.cleaned(),true);
});
test('PDF supervisor: a settled nonzero processor exit is refused without guessing from partial output', async t => {
  const f=await fixture(t,'nonzero');await assert.rejects(f.run(),{code:'DEPENDENCY_UNAVAILABLE'});assert.equal(f.cleaned(),false);
});
test('PDF supervisor: pre-cancelled and invalid bounded requests start no process', async t => {
  const f=await fixture(t), controller=new AbortController();controller.abort();
  await assert.rejects(withOperation(controller.signal,()=>f.run()),{code:'OPERATION_CANCELLED'});
  await assert.rejects(f.run({token:'invalid'}),{code:'VALIDATION_FAILED'});
  await assert.rejects(f.run({extra:{oversized:'x'.repeat(32768)}}),{code:'VALIDATION_FAILED'});
  assert.equal(existsSync(f.marker),false);
});
test('PDF supervisor: real cancellation uses EOF, waits for settlement, and leaves another process alive', async t => {
  const f=await fixture(t,'cooperate'), controller=new AbortController();
  const other=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const otherExit=new Promise<void>(resolve=>other.once('close',()=>resolve()));t.after(async()=>{other.kill('SIGTERM');await otherExit;});
  const pending=withOperation(controller.signal,()=>f.run()).then(value=>({value}),error=>({error}));
  try{await started(f.marker);controller.abort();const result=await pending;assert.ok('error'in result);assert.equal(result.error.code,'OPERATION_CANCELLED');
    assert.equal(f.cleaned(),false);assert.doesNotThrow(()=>process.kill(other.pid!,0));
    const pid=Number(await readFile(f.marker,'utf8'));assert.throws(()=>process.kill(pid,0),(e:any)=>e.code==='ESRCH');
  }finally{controller.abort();await pending;}
});
test('PDF supervisor: a real EOF-ignoring process is force-stopped and fallback cleanup is awaited', async t => {
  const f=await fixture(t,'ignore'), controller=new AbortController();
  const pending=withOperation(controller.signal,()=>f.run()).then(value=>({value}),error=>({error}));
  try{await started(f.marker);controller.abort();const result=await pending;assert.ok('error'in result);assert.equal(result.error.code,'OPERATION_CANCELLED');assert.equal(f.cleaned(),true);
    const pid=Number(await readFile(f.marker,'utf8'));assert.throws(()=>process.kill(pid,0),(e:any)=>e.code==='ESRCH');
  }finally{controller.abort();await pending;}
});
test('PDF supervisor: uncertain cleanup is reported explicitly instead of claiming cancellation completed', async t => {
  const f=await fixture(t,'missing');
  await assert.rejects(f.run({cleanup:async()=>{throw new Error('synthetic cleanup refused');}}),(e:any)=>e.code==='DEPENDENCY_UNAVAILABLE'&&e.safeDetails?.pdfCleanupUncertain===true);
});
for(const mode of ['overflow','diagnostics']) test(`PDF supervisor: ${mode} overflow refuses the complete result`, async t => {
  const f=await fixture(t,mode);await assert.rejects(f.run(),{code:'CONTENT_TOO_LARGE'});
});
test('PDF supervisor: one execution deadline stops an actual cooperative supervisor', async t => {
  const f=await fixture(t,'cooperate'), begin=performance.now();
  await assert.rejects(f.run({end:begin+2000}),{code:'DEPENDENCY_UNAVAILABLE'});
  assert.ok(performance.now()-begin>=1500);assert.equal(f.cleaned(),false);
});
