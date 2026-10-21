// All product code comes from the consumer's installed package, never src/ or tsx.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MemoryVault, LlmClient, previewPdfImport, applyPdfImport, readPdfOriginal, serializePdfImportPlan } from 'memobranch';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from 'memobranch/deepseek-harness';

const key = '64'.repeat(32);
const vault = new MemoryVault(join(process.cwd(), 'pdf-vault'), { masterKey: key, llm: new LlmClient({ apiKey: '', embeddingModel: '' }) });
await vault.initialize('installed PDF source');
const source = join(process.cwd(), 'pdf-source.pdf');
const bytes = Buffer.from((await readFile('pdf-fixture.base64', 'utf8')).trim(), 'base64');
await writeFile(source, bytes);
const plan = await previewPdfImport(source);
assert.equal(plan.pages.length, 3); assert.equal(plan.pages[1].empty, true);
assert.doesNotMatch(JSON.stringify(plan), /Synthetic source|JVBER/);
const imported = await applyPdfImport(vault, plan);
assert.deepEqual(await readPdfOriginal(vault, imported.evidenceId), bytes);
const document = await vault.get(imported.evidenceId);
assert.equal(document.meta.digestVersion, 3); assert.match(document.body, /## Page 3/);
assert.equal((await applyPdfImport(vault, plan)).duplicate, true);
await assert.rejects(applyPdfImport(vault, { ...plan, revision: '0'.repeat(64) }), { code: 'VALIDATION_FAILED' });
await assert.rejects(previewPdfImport(source, { timeoutMs: 1 }), { code: 'DEPENDENCY_UNAVAILABLE' });
const privateSource = await applyPdfImport(vault, plan, { scope: 'user', sensitivity: 'secret' });
assert.doesNotMatch(await readFile(join(vault.root, privateSource.evidencePath), 'utf8'), /JVBER|Synthetic source|pdfOriginal/);
assert.deepEqual(await readPdfOriginal(vault, privateSource.evidenceId), bytes);
const pending = new AbortController(); pending.abort();
await assert.rejects(applyPdfImport(vault, plan, { signal: pending.signal }), { code: 'OPERATION_CANCELLED' });
vault.llm.wiki = async (_operation, input) => {
  assert.equal(JSON.stringify(input).includes(document.meta.pdfOriginal.data), false);
  assert.doesNotMatch(JSON.stringify(input), /pdfOriginal/);
  return { pages: [{ key: `source:${imported.evidenceId}`, pageType: 'source', title: 'Installed PDF', summary: 'Synthetic source.', body: 'Synthetic source summary.',
    evidenceIds: [imported.evidenceId], links: [], status: 'active', conditions: [], uncertainty: ['No OCR.'] }] };
};
const prepared = await vault.wikiIngest({ evidenceIds: [imported.evidenceId] });
assert.equal((await vault.wikiCatalog()).length, 0);
await vault.wikiApply(prepared.plan); assert.equal((await vault.wikiCatalog()).length, 1);
assert.deepEqual(await readPdfOriginal(vault, imported.evidenceId), bytes);
const exec = promisify(execFile), cli = join(process.cwd(), 'node_modules/memobranch/dist/cli.js');
const modelEnv = { ...process.env, AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: 'internal' };
const client = new Client({ name: 'installed-pdf-model-read', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'node_modules/memobranch/dist/mcp.js'), vault.root], env: modelEnv, stderr: 'pipe' }));
try {
  const result = await client.callTool({ name: 'memory_get', arguments: { id: imported.evidenceId } });
  assert.notEqual(result.isError, true); assert.equal(JSON.stringify(result).includes(bytes.toString('base64')), false);
  assert.doesNotMatch(JSON.stringify(result), /pdfOriginal/); assert.match(JSON.stringify(result), /## Page 1/);
} finally { await client.close(); }
const values = Object.entries(modelEnv).filter(([name]) => name.startsWith('AMEM_'));
const previous = new Map(values.map(([name]) => [name, process.env[name]]));
for (const [name, value] of values) process.env[name] = value;
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); await ctx.plugin(plugin, { vaultRoot: vault.root });
  const result = await ctx.tools.execute({ name: 'memory_get', callId: 'installed-pdf-get', arguments: { id: imported.evidenceId }, signal: new AbortController().signal });
  assert.equal(result.isError, false); assert.equal(JSON.stringify(result).includes(bytes.toString('base64')), false);
  assert.doesNotMatch(JSON.stringify(result), /pdfOriginal/); assert.match(JSON.stringify(result), /## Page 1/);
} finally {
  await ctx.fiber.dispose();
  for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
const preview = await exec(process.execPath, [cli, 'import', 'pdf-preview', source]);
assert.equal(preview.stdout, serializePdfImportPlan(plan));
await writeFile('pdf-plan.json', preview.stdout);
const applied = await exec(process.execPath, [cli, 'import', 'pdf-apply', '--plan', 'pdf-plan.json', '--root', vault.root], {
  env: { ...process.env, AMEM_MASTER_KEY: key },
});
assert.equal(JSON.parse(applied.stdout).duplicate, true);
console.log('Installed package: bounded PDF worker, exact original bytes, page provenance, preview refusal, encryption, cancellation, Wiki/MCP/Harness model omission, explicit Wiki apply and real CLI passed (no OCR/layout-quality claim).');
