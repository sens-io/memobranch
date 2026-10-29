// Product imports resolve only to the consumer's installed archive. Native fixtures
// test transport/lifecycle/integrity, not actual OCR accuracy (verified separately).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { MemoryVault, LlmClient, previewPdfImport, applyPdfImport, readPdfOriginal, readPdfPage } from 'memobranch';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from 'memobranch/deepseek-harness';

if (process.platform === 'win32') throw new Error('This installed processing fixture requires POSIX executables; Windows acceptance remains open.');
const root = join(process.cwd(), 'processed-pdf-consumer'); await mkdir(root);
const workRoot = join(root, 'work'), languageData = join(root, 'languages'); await mkdir(workRoot, { mode: 0o700 }); await mkdir(languageData);
const source = join(root, 'source.pdf'), original = Buffer.from((await readFile('pdf-fixture.base64', 'utf8')).trim(), 'base64'); await writeFile(source, original);
const marker = join(root, 'model-calls');
for (const method of ['embed','extractMemories','answer','wiki']) LlmClient.prototype[method] = async () => { appendFileSync(marker, method + '\n'); throw new Error('Unexpected model call in installed processing'); };
const image = png(), renderer = join(root, 'renderer.mjs'), ocr = join(root, 'ocr.mjs');
await writeFile(join(languageData, 'eng.traineddata'), 'SYNTHETIC_DATA');
await writeFile(renderer, `#!${process.execPath}\nif(process.argv[2]==='-v'){console.error('pdftoppm version 26.05.0');}else{process.stdout.write(Buffer.from('${image.toString('base64')}','base64'));}`, { mode: 0o700 });
await writeFile(ocr, `#!${process.execPath}\nif(process.argv[2]==='--version'){console.log('tesseract 5.5.1');}else{process.stdout.write('SYNTHETIC installed OCR fixture');}`, { mode: 0o700 });
const processor = { version: 1, renderer, ocr, languageData, workRoot }, processing = { pages: [2], languages: ['eng'] };
const vault = new MemoryVault(join(root, 'vault'), { masterKey: '94'.repeat(32), llm: new LlmClient({ apiKey: '', embeddingModel: '' }) }); await vault.initialize('installed processed PDF');
const plan = await previewPdfImport(source, { processor, processing }); assert.equal(plan.version, 2);
assert.doesNotMatch(JSON.stringify(plan), /JVBER|iVBOR|SYNTHETIC installed OCR/);
const saved = await applyPdfImport(vault, plan, { processor }), record = await vault.get(saved.evidenceId);
assert.equal(saved.duplicate, false); assert.equal(record.meta.digestVersion, 5); assert.equal(record.meta.pdfOriginal.version, 2);
assert.deepEqual(await readPdfOriginal(vault, saved.evidenceId), original); assert.deepEqual(await readPdfPage(vault, saved.evidenceId, 2), image);
await assert.rejects(readPdfPage(vault, saved.evidenceId, 1), { code: 'NOT_FOUND' });
const head = await vault.git.run(['rev-parse','HEAD']), retry = await applyPdfImport(vault, plan, { processor });
assert.equal(retry.duplicate, true); assert.equal(retry.commit, null); assert.equal(await vault.git.run(['rev-parse','HEAD']), head);
await assert.rejects(applyPdfImport(vault, { ...plan, revision: '0'.repeat(64) }, { processor }), { code: 'VALIDATION_FAILED' });
const exec = promisify(execFile), configFile = join(root, 'host.json'), guard = join(root, 'model-guard.mjs'); await writeFile(configFile, JSON.stringify(processor));
await writeFile(guard, `import {LlmClient} from 'memobranch';import{appendFileSync}from'node:fs';for(const m of ['embed','extractMemories','answer','wiki'])LlmClient.prototype[m]=async()=>{appendFileSync(${JSON.stringify(marker)},m+'\\n');throw new Error('Unexpected child model call');};`);
const env = { ...process.env, AMEM_MASTER_KEY: '94'.repeat(32) };
for (const alias of ['memobranch','amem']) {
  const path = join(root, alias + '.pdf'), previewFile = join(root, alias + '-plan.json'); await writeFile(path, original);
  const run = args => exec(process.execPath, ['--import',guard,join(process.cwd(),'node_modules/.bin',alias),...args], { env });
  const preview = await run(['import','pdf-preview',path,'--processor-config',configFile,'--pages','2','--ocr-languages','eng']); await writeFile(previewFile, preview.stdout);
  const applied = JSON.parse((await run(['import','pdf-apply','--plan',previewFile,'--processor-config',configFile,'--sensitivity','secret','--root',vault.root])).stdout);
  assert.equal(applied.duplicate, false, alias + ' must perform its own first capture');
  const stored = await vault.get(applied.evidenceId), disk = await readFile(join(vault.root,applied.evidencePath),'utf8');
  assert.equal(stored.meta.sensitivity,'secret'); assert.equal(stored.meta.pdfOriginal.version,2);
  assert.match(disk,/encrypted:\s*aes-256-gcm/); assert.match(disk,/^ENC\[/m);
  assert.doesNotMatch(disk,/pdfOriginal|JVBER|iVBOR|SYNTHETIC installed OCR/);
  assert.equal(disk.includes(original.toString('base64')),false); assert.equal(disk.includes(image.toString('base64')),false);
  const noKey = new MemoryVault(vault.root,{masterKey:''});
  await assert.rejects(readPdfOriginal(noKey,applied.evidenceId),{code:'ENCRYPTION_KEY_UNAVAILABLE'});
  await assert.rejects(readPdfPage(noKey,applied.evidenceId,2),{code:'ENCRYPTION_KEY_UNAVAILABLE'});
  const pdf = join(root, alias + '-retained.pdf'), page = join(root, alias + '-retained.png');
  await run(['import','pdf-original',applied.evidenceId,'--output',pdf,'--root',vault.root]);
  await run(['import','pdf-page',applied.evidenceId,'--page','2','--output',page,'--root',vault.root]);
  assert.deepEqual(await readFile(pdf), original); assert.deepEqual(await readFile(page), image);
  await assert.rejects(run(['import','pdf-page',applied.evidenceId,'--page','2','--output',page,'--root',vault.root]), /EEXIST/);
  assert.deepEqual(await readFile(page), image);
}
const modelEnv = { ...env, AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: 'internal' };
const client = new Client({ name: 'installed-processed-pdf', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import',guard,join(process.cwd(),'node_modules/memobranch/dist/mcp.js'),vault.root], env: modelEnv, stderr: 'pipe' }));
try {
  const result = await client.callTool({ name: 'memory_get', arguments: { id: saved.evidenceId } });
  assert.notEqual(result.isError, true); assert.doesNotMatch(JSON.stringify(result), /pdfOriginal|JVBER|iVBOR/); assert.match(JSON.stringify(result), /SYNTHETIC installed OCR/);
  const forged = await client.callTool({ name: 'memory_get', arguments: { id: saved.evidenceId, processor, path: source } }); assert.equal(forged.isError, true);
} finally { await client.close(); }
const values = Object.entries(modelEnv).filter(([name]) => name.startsWith('AMEM_')), previous = new Map(values.map(([name]) => [name, process.env[name]]));
for (const [name, value] of values) process.env[name] = value;
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); await ctx.plugin(plugin, { vaultRoot: vault.root });
  const result = await ctx.tools.execute({ name: 'memory_get', callId: 'processed-pdf-get', arguments: { id: saved.evidenceId }, signal: new AbortController().signal });
  assert.equal(result.isError, false); assert.doesNotMatch(JSON.stringify(result), /pdfOriginal|JVBER|iVBOR/); assert.match(JSON.stringify(result), /SYNTHETIC installed OCR/);
  const forged = await ctx.tools.execute({ name: 'memory_get', callId: 'processed-pdf-forged', arguments: { id: saved.evidenceId, processor, path: source }, signal: new AbortController().signal });
  assert.equal(forged.isError, true);
} finally {
  await ctx.fiber.dispose(); for (const [name,value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
assert.equal((await vault.wikiCatalog()).length, 0); assert.equal((await vault.listRecords({ collection: 'candidates' })).total, 0);
assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 3);
assert.equal(existsSync(marker) ? await readFile(marker, 'utf8') : '', '');
assert.deepEqual((await readdir(workRoot)).filter(name => name.startsWith('pdf-owned-')), []);
console.log('Installed package: processed PDF API/types, exact media with direct ciphertext/classification/no-key assertions for both CLI captures, exclusive exports, MCP/Harness blob omission, strict server fields and zero model calls passed (synthetic processor, no OCR-quality claim).');

function png() { const h = Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(2,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc(14))),chunk('IEND',Buffer.alloc(0))]); }
function chunk(type,data) { const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let c=0xffffffff;for(const x of b.subarray(4,-4)){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}b.writeUInt32BE((c^0xffffffff)>>>0,b.length-4);return b; }
