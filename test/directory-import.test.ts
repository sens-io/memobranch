import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyDirectoryImport, previewDirectoryImport, readDirectoryImportPlan } from '../src/directory-import.js';
import { MemoryVault } from '../src/vault.js';
import { localAdminPrincipal } from '../src/policy.js';
import { withOperation } from '../src/operation.js';

async function fixture(t: TestContext) {
  const scratch = join(process.cwd(), '.scratch');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'directory-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'documents');
  await mkdir(source);
  await writeFile(join(source, 'a.md'), '# Atlas\n\nAtlas uses seven days.\n');
  await writeFile(join(source, 'b.txt'), 'Restore only in the production region.');
  const vault = new MemoryVault(join(root, 'vault'), { masterKey: '51'.repeat(32) });
  await vault.initialize('imports');
  return { root, source, vault };
}

test('import: preview has hashes but no bodies; apply preserves files and stores evidence only; retry is idempotent', async t => {
  const { source, vault } = await fixture(t);
  await mkdir(join(source, '.private')); await writeFile(join(source, '.private/secret.md'), 'NEVER_READ');
  await mkdir(join(source, 'node_modules')); await writeFile(join(source, 'node_modules/dependency.md'), 'NEVER_READ');
  await writeFile(join(source, 'image.png'), 'unsupported');
  const plan = await previewDirectoryImport(source);
  assert.equal(plan.files.length, 2);
  assert.doesNotMatch(JSON.stringify(plan), /seven days|NEVER_READ/);
  const before = await readFile(join(source, 'a.md'));
  const progress: number[] = [];
  const result = await applyDirectoryImport(vault, plan, { onProgress: item => { progress.push(item.completed); } });
  assert.equal(result.status, 'completed'); assert.deepEqual(progress, [1, 2]);
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 2);
  assert.equal((await vault.listRecords({ collection: 'candidates' })).total, 0);
  assert.equal((await vault.wikiCatalog()).length, 0);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  const retry = await applyDirectoryImport(vault, plan);
  assert.ok(retry.entries.every(item => item.result.duplicate && item.result.commit === null));
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  assert.deepEqual(await readFile(join(source, 'a.md')), before);
});

test('import: source drift, manifest tampering, added file and symlink fail preflight without a write', async t => {
  const { source, root, vault } = await fixture(t);
  const plan = await previewDirectoryImport(source);
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(applyDirectoryImport(vault, { ...plan, revision: '0'.repeat(64) }), /preview was modified/);
  await writeFile(join(source, 'c.md'), 'Added later');
  await assert.rejects(applyDirectoryImport(vault, plan), /Directory changed/);
  await rm(join(source, 'c.md'));
  await writeFile(join(source, 'b.txt'), 'changed');
  await assert.rejects(applyDirectoryImport(vault, plan), /Directory changed/);
  await symlink(join(root, 'vault'), join(source, 'outside'));
  await assert.rejects(previewDirectoryImport(source), /symbolic links/);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
});

test('import: UTF-8, NUL, file-count and byte limits reject the whole preview', async t => {
  const { source } = await fixture(t);
  for (const content of [Buffer.from([0xff, 0xfe]), Buffer.from('binary\0text'), Buffer.alloc(1_000_001, 'x')]) {
    await writeFile(join(source, 'invalid.txt'), content);
    await assert.rejects(previewDirectoryImport(source));
  }
  await rm(join(source, 'invalid.txt'));
  for (let n = 0; n < 99; n++) await writeFile(join(source, `many-${n}.txt`), 'text');
  await assert.rejects(previewDirectoryImport(source), /100 files/);
});

test('import: cancelled batch reports completed commits and retry finishes only missing sources', async t => {
  const { source, vault } = await fixture(t);
  const plan = await previewDirectoryImport(source);
  const controller = new AbortController();
  const partial = await applyDirectoryImport(vault, plan, { signal: controller.signal, onProgress: () => controller.abort() });
  assert.equal(partial.status, 'cancelled');
  assert.equal(partial.entries.length, 1);
  assert.ok(partial.entries[0]!.result.commit);
  assert.equal((await vault.listRecords({ collection: 'evidence' })).total, 1);
  const retry = await applyDirectoryImport(vault, plan);
  assert.equal(retry.status, 'completed');
  assert.equal(retry.entries[0]!.result.duplicate, true);
  assert.equal(retry.entries[1]!.result.duplicate, false);
  const parent = new AbortController(); parent.abort();
  await assert.rejects(withOperation(parent.signal, () => applyDirectoryImport(vault, plan, { signal: new AbortController().signal })), { code: 'OPERATION_CANCELLED' });
});

test('import: current tenant/write/scope/sensitivity and encryption remain authoritative', async t => {
  const { source, vault } = await fixture(t);
  const plan = await previewDirectoryImport(source);
  const tenantId = (await vault.config()).tenantId;
  const reader = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId, permissions: ['read'], scopes: ['public'], maxSensitivity: 'public' } });
  await assert.rejects(applyDirectoryImport(reader, plan), { code: 'AUTHORIZATION_DENIED' });
  const foreign = new MemoryVault(vault.root, { principal: { ...localAdminPrincipal(), tenantId: 'other' } });
  await assert.rejects(applyDirectoryImport(foreign, plan), { code: 'AUTHORIZATION_DENIED' });
  const result = await applyDirectoryImport(vault, plan, { scope: 'user', sensitivity: 'secret' });
  assert.equal(result.status, 'completed');
  for (const item of result.entries) {
    const raw = await readFile(join(vault.root, item.result.evidencePath), 'utf8');
    assert.doesNotMatch(raw, /seven days|production region/);
    assert.equal((await vault.get(item.result.evidenceId)).meta.sensitivity, 'secret');
  }
  assert.equal((await reader.listRecords({ collection: 'evidence' })).total, 0);
});

test('import: CLI accepts its own large multibyte preview and bounds oversized plan reads', async t => {
  const { root, source, vault } = await fixture(t);
  let directory = source;
  for (let index = 0; index < 3; index++) {
    directory = join(directory, `${'文'.repeat(60)}${index}`);
    await mkdir(directory);
  }
  await rm(join(source, 'a.md')); await rm(join(source, 'b.txt'));
  for (let index = 0; index < 100; index++) await writeFile(join(directory, `${'资料'.repeat(10)}${index}.txt`), 'synthetic');
  const preview = await previewDirectoryImport(source);
  const raw = JSON.stringify(preview, null, 2);
  assert.ok(Buffer.byteLength(raw) > 200_000);
  const plan = join(root, 'plan.json');
  await writeFile(plan, raw);
  assert.deepEqual(await readDirectoryImportPlan(plan), preview);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY'));
  Object.assign(env, { AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'project', AMEM_MAX_SENSITIVITY: 'public', AMEM_TENANT_ID: (await vault.config()).tenantId });
  await assert.rejects(promisify(execFile)(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'import', 'apply', '--plan', plan, '--root', vault.root], { env }),
    (error: unknown) => /AUTHORIZATION_DENIED/.test(String((error as { stderr?: string }).stderr)));
  await writeFile(plan, Buffer.alloc(1_000_001, 'x'));
  await assert.rejects(readDirectoryImportPlan(plan), { code: 'CONTENT_TOO_LARGE' });
});
