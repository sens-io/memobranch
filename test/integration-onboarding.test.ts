import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { runIntegrationSetup } from '../src/integration-cli.js';
import { applyClientSetup, previewClientSetup, removeClientSetup, verifyClientSetup } from '../src/onboarding.js';
import { principalFromEnv } from '../src/policy.js';
import { sha256 } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';

async function fixture(run: (options: { client: 'claude-code'; configPath: string; vaultRoot: string }, scratch: string) => Promise<void>) {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const scratch = await mkdtemp(join(process.cwd(), '.scratch', 'onboarding-test-'));
  try {
    const vaultRoot = join(scratch, 'vault');
    await new MemoryVault(vaultRoot).initialize('setup-test');
    await run({ client: 'claude-code', configPath: join(scratch, 'client', '.mcp.json'), vaultRoot }, scratch);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

test('preview is side-effect-free and a fresh launch uses a tenant-bound read-only principal', async () => fixture(async (options) => {
  const plan = await previewClientSetup(options);
  assert.equal(plan.expectedRevision, 'missing');
  assert.equal(plan.change, 'add');
  assert.equal(existsSync(join(options.configPath, '..')), false);
  assert.equal(plan.entry.env.AMEM_PERMISSIONS, 'read');
  assert.doesNotMatch(JSON.stringify(plan.entry), /AMEM_MASTER_KEY|AMEM_LLM_API_KEY|OPENAI_API_KEY|review|admin/);
  const principal = principalFromEnv(plan.entry.env);
  assert.deepEqual(principal.permissions, ['read']);
  assert.equal((await new MemoryVault(options.vaultRoot, { principal }).config()).tenantId, plan.entry.env.AMEM_TENANT_ID);
  await assert.rejects(runIntegrationSetup('apply', options), /preview first/);
  const applied = await applyClientSetup(plan);
  assert.equal(applied.applied, true);
  assert.equal(applied.backupPath, null);
  assert.equal((await stat(options.configPath)).mode & 0o777, 0o600);
  const verification = await verifyClientSetup(options);
  assert.equal(verification.connected, true);
  assert.equal(verification.automaticMemory, false);
  assert.equal((await applyClientSetup(await previewClientSetup(options))).applied, false);
}));

test('apply preserves unrelated settings, backs up exact bytes, and remove preserves later unrelated edits', async () => fixture(async (options) => {
  await mkdir(join(options.configPath, '..'), { recursive: true });
  const original = '{ "custom": {"value":42}, "mcpServers":{"other":{"command":"existing"}} }\n';
  await writeFile(options.configPath, original);
  const plan = await previewClientSetup({ ...options, permissions: 'read,write' });
  const applied = await applyClientSetup(plan);
  assert.ok(applied.backupPath);
  assert.equal(await readFile(applied.backupPath, 'utf8'), original);
  assert.equal((await stat(applied.backupPath)).mode & 0o777, 0o600);
  const current = JSON.parse(await readFile(options.configPath, 'utf8'));
  assert.deepEqual(current.mcpServers.other, { command: 'existing' });
  assert.deepEqual(current.custom, { value: 42 });
  assert.equal(current.mcpServers.memobranch.env.AMEM_PERMISSIONS, 'read,write');
  current.custom.later = true;
  await writeFile(options.configPath, JSON.stringify(current));
  await assert.rejects(removeClientSetup(options), /expected-revision/);
  await assert.rejects(removeClientSetup({ ...options, expectedRevision: plan.expectedRevision }), /changed/);
  assert.equal((await removeClientSetup({ ...options, expectedRevision: sha256(await readFile(options.configPath, 'utf8')) })).removed, true);
  const removed = JSON.parse(await readFile(options.configPath, 'utf8'));
  assert.deepEqual(removed.mcpServers, { other: { command: 'existing' } });
  assert.deepEqual(removed.custom, { value: 42, later: true });
  assert.equal((await removeClientSetup(options)).removed, false);
  assert.equal(existsSync(applied.backupPath), true, 'uninstall retains recoverable original bytes');
}));

test('revision changes and concurrent apply cannot overwrite another change', async () => fixture(async (options) => {
  const stale = await previewClientSetup(options);
  await mkdir(join(options.configPath, '..'), { recursive: true });
  await writeFile(options.configPath, '{"new":true}');
  await assert.rejects(applyClientSetup(stale), /changed/);
  const plan = await previewClientSetup(options);
  const results = await Promise.allSettled([applyClientSetup(plan), applyClientSetup(plan)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(JSON.parse(await readFile(options.configPath, 'utf8')).new, true);
  const files = await readdir(join(options.configPath, '..'));
  assert.equal(files.filter((file) => file.startsWith('.mcp.json.memobranch-backup-')).length, 1);
}));

test('setup never overwrites a conflicting server, adopts an existing entry, or removes a changed owned entry', async () => fixture(async (options) => {
  await mkdir(join(options.configPath, '..'), { recursive: true });
  await writeFile(options.configPath, '{"mcpServers":{"memobranch":{"command":"someone-else"}}}');
  await assert.rejects(previewClientSetup(options), /will not be overwritten/);
  const unchanged = await readFile(options.configPath, 'utf8');
  assert.equal((await removeClientSetup(options)).removed, false);
  assert.equal(await readFile(options.configPath, 'utf8'), unchanged);
  await rm(options.configPath);
  const plan = await previewClientSetup(options);
  await writeFile(options.configPath, JSON.stringify({ mcpServers: { memobranch: plan.entry } }));
  assert.equal((await applyClientSetup(await previewClientSetup(options))).applied, false);
  assert.equal((await removeClientSetup(options)).removed, false, 'matching pre-existing entry has no ownership record');
  await rm(options.configPath);
  await applyClientSetup(await previewClientSetup(options));
  const changed = JSON.parse(await readFile(options.configPath, 'utf8'));
  changed.mcpServers.memobranch.env.AMEM_ALLOWED_SCOPES = 'user';
  await writeFile(options.configPath, JSON.stringify(changed));
  await assert.rejects(removeClientSetup({ ...options, expectedRevision: sha256(await readFile(options.configPath, 'utf8')) }), /was changed/);
  assert.deepEqual(JSON.parse(await readFile(options.configPath, 'utf8')), changed);
}));

test('invalid JSON, non-object structure, symlinks, excessive config, and forged elevated plans fail closed', async () => fixture(async (options, scratch) => {
  await mkdir(join(options.configPath, '..'), { recursive: true });
  for (const content of ['{', '[]', '{"mcpServers":false}', 'x'.repeat(1_048_577)]) {
    await writeFile(options.configPath, content);
    await assert.rejects(previewClientSetup(options));
    assert.equal(await readFile(options.configPath, 'utf8'), content);
  }
  await rm(options.configPath);
  const target = join(scratch, 'other.json');
  await writeFile(target, '{}');
  await symlink(target, options.configPath);
  await assert.rejects(previewClientSetup(options), /symbolic links/);
  assert.equal(await readFile(target, 'utf8'), '{}');
  await rm(options.configPath);
  const plan = await previewClientSetup(options);
  plan.entry.env.AMEM_PERMISSIONS = 'admin';
  await assert.rejects(applyClientSetup(plan), /permissions/);
  assert.equal(existsSync(options.configPath), false);
}));
