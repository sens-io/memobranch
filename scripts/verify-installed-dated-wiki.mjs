// Copied into an independent consumer; product imports must remain installed exports.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LlmClient, MemoryVault, startWebServer } from 'memobranch';
import * as plugin from 'memobranch/deepseek-harness';

const exec = promisify(execFile), pageKey = 'entity:installed-dated-wiki', masterKey = '86'.repeat(32);
const at = '2026-01-15T08:00:00+08:00';
async function dated(time, action) {
  const saved = [process.env.GIT_COMMITTER_DATE, process.env.GIT_AUTHOR_DATE];
  process.env.GIT_COMMITTER_DATE = time; process.env.GIT_AUTHOR_DATE = time;
  try { return await action(); }
  finally {
    for (const [i, name] of ['GIT_COMMITTER_DATE', 'GIT_AUTHOR_DATE'].entries()) {
      if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i];
    }
  }
}
async function fixture(name, sensitivity = 'internal') {
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let calls = 0;
  llm.wiki = async (operation, input) => {
    calls++; if (operation === 'navigate') return { keys: input.catalog.map(page => page.key) };
    const draft = (key, pageType, body) => ({ key, pageType, title: key, summary: 'Installed recorded-time fixture.', body,
      evidenceIds: input.sources.map(source => source.id), links: [], status: 'active', conditions: ['Synthetic dates only.'], uncertainty: ['Not historical truth.'] });
    return { pages: [...input.sources.map(source => draft(`source:${source.id}`, 'source', source.body)),
      draft(pageKey, 'entity', input.sources.map(source => source.body).join('\n'))] };
  };
  const vault = new MemoryVault(join(process.cwd(), name), { llm, masterKey });
  await dated('2026-01-01T00:00:00Z', () => vault.initialize(name)); const versions = [];
  for (const [time, content] of [['2026-01-10T00:00:00Z', 'Installed dated old text. 中文 🧠'], ['2026-01-20T00:00:00Z', 'Installed dated current text.']]) {
    versions.push(await dated(time, async () => {
      const source = await vault.capture({ content, scope: 'project', sensitivity, extract: false });
      await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
      const id = (await vault.wikiCatalog()).find(page => page.key === pageKey).id;
      return { ...source, commit: await vault.git.run(['rev-parse', 'HEAD']), body: (await vault.get(id)).body };
    }));
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'user,project', AMEM_MAX_SENSITIVITY: 'secret',
    AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_MASTER_KEY: masterKey });
  return { vault, llm, versions, env, calls: () => calls };
}
function check(value, example) {
  assert.equal(value.commit, example.versions[0].commit); assert.equal(value.selection.kind, 'git-committer-time');
  assert.equal(value.selection.at, '2026-01-15T00:00:00.000Z'); assert.equal(value.selection.committedAt, '2026-01-10T00:00:00.000Z');
  assert.equal(value.selection.traversal, 'first-parent'); assert.ok(value.selection.scannedCommits > 1);
  const page = value.pages.find(page => page.meta.key === pageKey);
  assert.equal(page.body, example.versions[0].body); assert.equal(page.currentRevision, 2);
  assert.ok(page.body.includes('中文 🧠')); assert.match(value.warnings.join(' '), /mutable Git committer/);
}
const example = await fixture('installed-dated-wiki'), { vault, env, versions } = example;
const head = await vault.git.run(['rev-parse', 'HEAD']), index = await readFile(join(vault.git.gitDir, 'index')), count = example.calls();
const originals = await Promise.all(versions.map(version => readFile(join(vault.root, version.evidencePath))));
check(await vault.wikiSnapshot({ at, pageKeys: [pageKey] }), example);
assert.equal('selection' in await vault.wikiSnapshot({ commit: versions[0].commit, pageKeys: [pageKey] }), false);
await assert.rejects(vault.wikiSnapshot({ at, commit: head, pageKeys: [pageKey] }), { code: 'VALIDATION_FAILED' });
await assert.rejects(vault.wikiSnapshot({ at: '2026-01-05T00:00:00Z', pageKeys: [pageKey] }), { code: 'NOT_FOUND' });
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(vault.wikiSnapshot({ at, pageKeys: [pageKey], signal: cancelled.signal }), { code: 'OPERATION_CANCELLED' });
const cli = join(process.cwd(), 'node_modules/memobranch/dist/cli.js');
check(JSON.parse((await exec(process.execPath, [cli, 'wiki', 'snapshot', pageKey, '--at', at, '--root', vault.root], { env })).stdout), example);
await assert.rejects(exec(process.execPath, [cli, 'wiki', 'snapshot', pageKey, '--at', at, '--commit', head, '--root', vault.root], { env }));

for (const adapter of ['MCP', 'Harness']) {
  await agent(adapter, example, async invoke => {
    check(await invoke({ at, pageKeys: [pageKey] }), example);
    assert.equal('selection' in await invoke({ commit: versions[0].commit, pageKeys: [pageKey] }), false);
    await assert.rejects(invoke({ at, commit: head, pageKeys: [pageKey] }));
    await assert.rejects(invoke({ at: '2026-01-15', pageKeys: [pageKey] }));
    check(await invoke({ at, pageKeys: [pageKey] }), example);
  });
}
const web = await startWebServer(vault.root, { llm: example.llm, masterKey });
try {
  const response = await fetch(web.url + '/api/wiki-snapshot', { method: 'POST', headers: {
    Origin: web.url, Authorization: 'Bearer ' + web.token, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ at, pageKeys: [pageKey] }) });
  assert.equal(response.status, 200); check((await response.json()).result, example);
} finally { await web.stop(); }
assert.equal(example.calls(), count); assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
assert.deepEqual(await readFile(join(vault.git.gitDir, 'index')), index);
for (const [i, version] of versions.entries()) assert.deepEqual(await readFile(join(vault.root, version.evidencePath)), originals[i]);
await vault.wikiRevoke(pageKey, 'Installed current withdrawal');
await assert.rejects(vault.wikiSnapshot({ at, pageKeys: [pageKey] }), { code: 'NOT_FOUND' });
const privateCase = await fixture('installed-private-dated-wiki', 'secret');
for (const adapter of ['MCP', 'Harness']) await agent(adapter, privateCase, async invoke => {
  await assert.rejects(invoke({ at, pageKeys: [pageKey] }));
  check(await invoke({ at, pageKeys: [pageKey], includeSecret: true }), privateCase);
});
await privateCase.vault.encryption.erase(privateCase.versions[0].evidenceId);
await assert.rejects(privateCase.vault.wikiSnapshot({ at, pageKeys: [pageKey], includeSecret: true }));
console.log('Installed package: recorded-time Wiki API/CLI/MCP/Harness/HTTP, unchanged hash reads, complete old text, private selection/key loss, current withdrawal, cancellation, unchanged sources/index/refs and public types passed (Git committer-time view, not as-known-at truth or historical model answering).');

async function agent(adapter, example, action) {
  if (adapter === 'MCP') {
    const client = new Client({ name: 'installed-dated-wiki', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [join(process.cwd(), 'node_modules/memobranch/dist/mcp.js'), example.vault.root], env: example.env, stderr: 'pipe' }));
      await action(async input => {
        const result = await client.callTool({ name: 'memory_wiki_snapshot', arguments: input });
        const content = result.content[0]; assert.equal(content.type, 'text');
        if (result.isError) throw new Error(content.text);
        return JSON.parse(content.text);
      });
    } finally { await client.close(); }
    return;
  }
  const saved = { ...process.env }, ctx = new Context(); let callId = 0;
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
    Object.assign(process.env, example.env); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(plugin, { vaultRoot: example.vault.root });
    await action(async input => {
      const result = await ctx.tools.execute({ name: 'memory_wiki_snapshot', arguments: input,
        callId: `installed-dated-${callId++}`, signal: new AbortController().signal });
      if (result.isError) throw new Error(JSON.stringify(result.error));
      return result.value;
    });
  } finally {
    await ctx.fiber.dispose();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
