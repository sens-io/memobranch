// G05: this file is copied into an independent npm consumer before execution.
// Keep all application imports on the installed package's public exports.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LlmClient, MemoryVault, principalFromEnv } from 'memobranch';
import * as plugin from 'memobranch/deepseek-harness';

const exec = promisify(execFile);
const consumer = process.cwd();
const packageRoot = join(consumer, 'node_modules', 'memobranch');
assert.equal(dirname(dirname(fileURLToPath(import.meta.resolve('memobranch')))), packageRoot);
const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const cli = join(packageRoot, metadata.bin.memobranch);
const mcp = join(packageRoot, metadata.bin['memobranch-mcp']);
const baseEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
let invocation = 0;

for (const adapter of ['API', 'CLI', 'MCP', 'Harness']) {
  const vault = new MemoryVault(join(consumer, `wiki-${adapter.toLowerCase()}`));
  await vault.initialize(`Installed ${adapter} Wiki`);
  const captured = await vault.capture({
    content: 'AtlasStore supports daily snapshots for project deployments.', scope: 'user', sensitivity: 'internal',
  });
  const evidence = await vault.get(captured.evidenceId);
  const rawEvidence = await readFile(join(vault.root, evidence.path), 'utf8');
  const purpose = `Installed ${adapter} atlas knowledge`;
  await withProvider(captured.evidenceId, async (providerEnv, requests) => {
    const env = { ...baseEnv, ...providerEnv, AMEM_PERMISSIONS: 'read,write,review,maintain',
      AMEM_ACTOR_ID: 'installed-wiki-consumer', AMEM_ALLOWED_SCOPES: 'user,project',
      AMEM_MAX_SENSITIVITY: 'internal', AMEM_TENANT_ID: (await vault.config()).tenantId };
    await withAdapter(adapter, vault.root, env, async (invoke) => {
      await invoke('migrate', {});
      const rules = await invoke('rules', {});
      assert.match(JSON.stringify(rules), /Preserve immutable raw evidence/,
        `${adapter}: migration must load the installed default rules`);
      await invoke('set_rules', { purpose, instructions: 'Keep source citations and deployment conditions explicit.', scope: 'user', sensitivity: 'internal' });
      const baseline = await canonicalSnapshot(vault);
      const prepared = await invoke('ingest', { evidenceIds: [captured.evidenceId] });
      assert.equal(prepared.duplicate, false);
      assert.equal(prepared.commit, null);
      assert.equal(prepared.plan.pages.length, 2);
      assert.deepEqual(await canonicalSnapshot(vault), baseline, `${adapter}: planning changed canonical knowledge`);

      // Forward the complete runtime-issued plan, including any opaque validation proof.
      const applied = await invoke('apply', { plan: prepared.plan });
      assert.equal(applied.pageIds.length, 2);
      assert.equal(applied.commit, await vault.git.run(['rev-parse', 'HEAD']));
      const catalog = await invoke('catalog', {});
      assert.equal(catalog.length, 2);
      assert.deepEqual(new Set(catalog.map(page => page.pageType)), new Set(['source', 'entity']));
      for (const entry of catalog) {
        const persisted = await new MemoryVault(vault.root).get(entry.id);
        assert.equal(persisted.meta.type, 'wiki-page');
        assert.equal(persisted.meta.revision, entry.revision);
        assert.equal(persisted.meta.scope, 'user');
        assert.equal(persisted.meta.sensitivity, 'internal');
        assert.ok(persisted.meta.evidence.includes(evidence.path));
        assert.ok(persisted.meta.conditions.includes('Project deployments'));
        assert.ok(entry.summary.length > 0);
        assert.match(persisted.body, /daily snapshots.*project deployments/);
        assert.ok(entry.links.length > 0);
        for (const link of entry.links) assert.ok(catalog.some(page => page.key === link));
        assert.match(await readFile(join(vault.root, entry.path), 'utf8'), /daily snapshots/);
      }

      const compiled = await canonicalSnapshot(vault);
      const answer = await invoke('query', { question: 'What does AtlasStore support?' });
      assert.match(answer.answer, /daily snapshots for project deployments/);
      assert.equal(answer.citations[0].key, 'entity:atlasstore');
      assert.equal(answer.citations[0].revision, catalog.find(page => page.key === 'entity:atlasstore').revision);
      assert.ok(answer.uncertainty.includes('Restoration performance has not been verified.'));
      assert.deepEqual(await canonicalSnapshot(vault), compiled, `${adapter}: query filed itself`);

      const requestsBeforeDenial = requests.length;
      await withAdapter(adapter, vault.root, { ...env, AMEM_PERMISSIONS: 'write' }, async (restricted) => {
        await assert.rejects(restricted('ingest', { evidenceIds: [captured.evidenceId], apply: true }), isDenied);
        await assert.rejects(restricted('file', { result: answer, title: 'Denied filing', key: 'query:denied', pageType: 'query', apply: true }), isDenied);
        // Harness hides review-only tools; the other public adapters reject their invocation.
        if (adapter !== 'Harness') await assert.rejects(restricted('apply', { plan: prepared.plan }), isDenied);
      });
      assert.equal(requests.length, requestsBeforeDenial, `${adapter}: denial dispatched a provider request`);
      assert.deepEqual(await canonicalSnapshot(vault), compiled, `${adapter}: denied write changed canonical knowledge`);
      assert.equal((await invoke('catalog', {})).length, 2, `${adapter}: permitted calls must still work after denial`);

      const filed = await invoke('file', {
        result: answer, title: 'AtlasStore comparison', key: 'comparison:atlasstore', pageType: 'comparison',
      });
      assert.equal(filed.commit, null);
      assert.equal(filed.plan.kind, 'file');
      assert.deepEqual(await canonicalSnapshot(vault), compiled, `${adapter}: filing applied without an explicit request`);
      const filedCommit = await invoke('apply', { plan: filed.plan });
      assert.equal(filedCommit.commit, await vault.git.run(['rev-parse', 'HEAD']));
      const filedEntry = (await invoke('catalog', {})).find(page => page.key === 'comparison:atlasstore');
      assert.ok(filedEntry);
      assert.equal(filedEntry.pageType, 'comparison');
      const saved = await new MemoryVault(vault.root).get(filedEntry.id);
      assert.match(saved.body, /Generated analysis/);
      assert.match(saved.body, /What does AtlasStore support/);
      assert.match(saved.body, /Restoration performance has not been verified/);
      assert.ok(saved.meta.links.includes('entity:atlasstore'));
      assert.ok(saved.meta.evidence.includes(evidence.path));

      const beforeLint = await canonicalSnapshot(vault);
      const structural = await invoke('lint', {});
      assert.equal(structural.semantic, 'not-requested');
      assert.deepEqual(structural.plans, []);
      const lint = await invoke('lint', { semantic: true });
      assert.equal(lint.semantic, 'available', JSON.stringify(lint));
      assert.ok(lint.issues.some(issue => issue.kind === 'gap' && issue.pageKeys.includes('entity:atlasstore')));
      assert.equal(lint.plans.length, 1);
      assert.equal(lint.plans[0].kind, 'repair');
      assert.deepEqual(await canonicalSnapshot(vault), beforeLint, `${adapter}: lint applied an unapproved repair`);
      const repairCommit = await invoke('apply', { plan: lint.plans[0] });
      assert.equal(repairCommit.commit, await vault.git.run(['rev-parse', 'HEAD']));
      const restarted = new MemoryVault(vault.root);
      const finalCatalog = await restarted.wikiCatalog();
      assert.equal(finalCatalog.length, 4);
      const repair = finalCatalog.find(page => page.key === 'concept:restore-verification');
      assert.ok(repair, `${adapter}: the explicitly accepted repair must survive a fresh instance`);
      const repaired = await restarted.get(repair.id);
      assert.match(repaired.body, /remains unverified/);
      assert.equal(repaired.meta.pageType, 'concept');
      assert.ok(repaired.meta.evidence.includes(evidence.path));
      assert.ok(repaired.meta.links.includes('entity:atlasstore'));
      assert.equal(await readFile(join(vault.root, evidence.path), 'utf8'), rawEvidence);
      assert.deepEqual((await readdir(join(vault.root, 'evidence'), { recursive: true })).filter(path => path.endsWith('.md')).map(path => path.replaceAll('\\', '/')), [evidence.path.slice('evidence/'.length)],
        `${adapter}: generated analysis must not become raw evidence`);
      const log = await readFile(join(vault.root, 'log.md'), 'utf8');
      for (const operation of ['wiki-compile', 'wiki-file', 'wiki-repair']) assert.match(log, new RegExp(operation));
    });
    for (const operation of ['compile', 'navigate', 'query', 'lint']) {
      assert.ok(requests.some(request => request.operation === operation), `${adapter}: missing real ${operation} provider request`);
    }
    for (const operation of ['compile', 'query', 'lint']) {
      assert.ok(requests.filter(request => request.operation === operation)
        .every(request => JSON.stringify(request.input.rules).includes(purpose)), `${adapter}: ${operation} omitted installed operational rules`);
    }
    assert.ok(requests.some(request => request.operation === 'navigate'
      && request.input.catalog.some(page => page.key === 'entity:atlasstore')));
    assert.ok(requests.some(request => request.operation === 'query'
      && request.input.pages.some(page => page.key === 'entity:atlasstore' && page.body.includes('daily snapshots'))));
  });
  console.log(`Installed ${adapter}: provider-backed Wiki plan/apply, persistent pages, query, explicit filing/repair and least-privilege refusal passed.`);
}

async function withAdapter(adapter, root, env, action) {
  if (adapter === 'API') {
    const vault = new MemoryVault(root, { principal: principalFromEnv(env), llm: new LlmClient({
      baseUrl: env.AMEM_LLM_BASE_URL, apiKey: env.AMEM_LLM_API_KEY, model: env.AMEM_LLM_MODEL, maxRetries: 0,
    }) });
    const methods = {
      migrate: () => vault.wikiMigrate(), rules: () => vault.wikiRules(), set_rules: args => vault.wikiSetRules(args),
      ingest: args => vault.wikiIngest(args), apply: args => vault.wikiApply(args.plan), catalog: () => vault.wikiCatalog(),
      query: args => vault.wikiQuery(args.question), lint: args => vault.wikiLint(args),
      file: ({ result, ...options }) => vault.wikiFile(result, options),
    };
    await action((operation, args) => methods[operation](args));
    return;
  }
  if (adapter === 'MCP') {
    const client = new Client({ name: 'installed-wiki-consumer', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [mcp, root], env, stderr: 'pipe', cwd: consumer }));
      await action(async (operation, args) => {
        const result = await client.callTool({ name: `memory_wiki_${operation}`, arguments: args });
        assert.equal(result.content[0]?.type, 'text');
        const value = JSON.parse(result.content[0].text);
        if (result.isError) throw Object.assign(new Error(JSON.stringify(value)), { code: value.error?.code });
        return value;
      });
    } finally { await client.close(); }
    return;
  }
  if (adapter === 'Harness') {
    const saved = { ...process.env };
    let ctx;
    try {
      for (const key of Object.keys(process.env)) if (key.startsWith('AMEM_') || key === 'OPENAI_API_KEY') delete process.env[key];
      Object.assign(process.env, env);
      ctx = new Context();
      await ctx.plugin(SystemPrompt, {});
      await ctx.plugin(ToolRuntime, {});
      await ctx.plugin(plugin, { vaultRoot: root, defaultScope: 'user', defaultSensitivity: 'internal' });
      const names = ctx.tools.schemas().map(tool => tool.name);
      assert.ok(names.includes('memory_wiki_ingest'));
      assert.equal(names.includes('memory_wiki_apply'), env.AMEM_PERMISSIONS.includes('review'));
      await action(async (operation, args) => {
        const result = await ctx.tools.execute({ callId: `installed-wiki-${invocation++}`, name: `memory_wiki_${operation}`,
          arguments: args, signal: new AbortController().signal });
        if (result.isError) {
          const failure = JSON.parse(result.error.message);
          throw Object.assign(new Error(result.error.message), { code: failure.error?.code });
        }
        return result.value;
      });
    } finally {
      await ctx?.fiber.dispose();
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
    return;
  }
  assert.equal(adapter, 'CLI');
  await action(async (operation, input) => {
    const args = [operation.replaceAll('_', '-')];
    let stdin;
    if (operation === 'set_rules') args.push(input.instructions, '--purpose', input.purpose, '--scope', input.scope, '--sensitivity', input.sensitivity);
    if (operation === 'ingest') args.push(...input.evidenceIds);
    if (operation === 'query') args.push(input.question);
    if (operation === 'apply') { args.push('--file', '-'); stdin = JSON.stringify({ plan: input.plan }); }
    if (operation === 'file') {
      args.push('--file', '-', '--title', input.title, '--key', input.key, '--page-type', input.pageType);
      stdin = JSON.stringify(input.result);
    }
    if (input.apply === true) args.push('--apply');
    if (input.semantic === true) args.push('--semantic');
    const pending = exec(process.execPath, [cli, 'wiki', ...args, '--root', root], { cwd: consumer, env, timeout: 45_000 });
    pending.child.stdin?.end(stdin);
    try { return JSON.parse((await pending).stdout); }
    catch (error) {
      const failure = JSON.parse(error.stderr || '{}');
      throw Object.assign(new Error(error.stderr || error.message), { code: failure.error?.code });
    }
  });
}

async function withProvider(evidenceId, action) {
  const requests = [];
  const failures = [];
  const draft = (key, pageType, title, body, links) => ({ key, pageType, title, summary: body, body,
    evidenceIds: [evidenceId], links, conditions: ['Project deployments'], uncertainty: [], status: 'active' });
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer local-package-fixture-key');
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(envelope.model, 'installed-wiki-fixture');
      const payload = JSON.parse(envelope.messages[1].content);
      requests.push(payload);
      let result;
      if (payload.operation === 'navigate') result = { keys: payload.input.catalog.map(page => page.key) };
      else if (payload.operation === 'compile') result = { pages: [
        draft(`source:${evidenceId}`, 'source', 'AtlasStore snapshot source', 'AtlasStore supports daily snapshots for project deployments.', ['entity:atlasstore']),
        draft('entity:atlasstore', 'entity', 'AtlasStore', 'AtlasStore provides daily snapshots for project deployments.', [`source:${evidenceId}`]),
      ] };
      else if (payload.operation === 'query') result = { answer: 'AtlasStore supports daily snapshots for project deployments.',
        citations: ['entity:atlasstore'], uncertainty: ['Restoration performance has not been verified.'] };
      else if (payload.operation === 'lint') result = { suggestions: [{ kind: 'gap', message: 'Restoration behavior needs independent verification.',
        pageKeys: ['entity:atlasstore'], evidenceIds: [evidenceId], repairs: [
          draft('concept:restore-verification', 'concept', 'Restoration verification',
            'Snapshot restoration performance remains unverified; keep this as a research question.', ['entity:atlasstore']),
        ] }] };
      else throw new Error(`Unexpected provider operation: ${payload.operation}`);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    } catch (error) {
      failures.push(error.message);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"Installed Wiki HTTP fixture failed"}}');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await action({ AMEM_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AMEM_LLM_API_KEY: 'local-package-fixture-key',
      AMEM_LLM_MODEL: 'installed-wiki-fixture', AMEM_LLM_MAX_RETRIES: '0' }, requests);
    assert.deepEqual(failures, [], 'the local HTTP fixture must accept every actual provider request');
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function isDenied(error) {
  assert.equal(error.code, 'AUTHORIZATION_DENIED', error.message);
  return true;
}

async function canonicalSnapshot(vault) {
  const files = {};
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.amem' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(vault.root, path)] = await readFile(path, 'utf8');
    }
  };
  await visit(vault.root);
  return { head: await vault.git.run(['rev-parse', 'HEAD']), files };
}
