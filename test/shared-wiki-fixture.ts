import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { SharedWikiReader } from '../src/shared-wiki.js';
import { MemoryVault } from '../src/vault.js';
import type { Principal } from '../src/policy.js';
import type { Scope, Sensitivity } from '../src/types.js';
import { fixture as sourceFixture, masterKey, pageKey } from './dated-wiki-fixture.js';

export { masterKey, pageKey };
export async function sharedFixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  const fixture = await sourceFixture(t, sensitivity), source = fixture.vault;
  const parent = await mkdtemp(join(process.cwd(), '.scratch/shared-wiki-caller-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const callerAdmin = new MemoryVault(join(parent, 'caller'), { masterKey: '31'.repeat(32) }); await callerAdmin.initialize('Shared reader fixture');
  const callerConfig = await callerAdmin.config(), sourceConfig = await source.config();
  const principal: Principal = { id: 'shared-reader', name: 'Synthetic reader', tenantId: callerConfig.tenantId,
    permissions: ['read'], scopes: ['project'], maxSensitivity: 'secret' };
  const caller = new MemoryVault(callerAdmin.root, { principal, masterKey: '31'.repeat(32) });
  const configPath = join(caller.root, '.amem/shared-wiki.json'); await mkdir(join(caller.root, '.amem'), { recursive: true });
  const binding = { id: 'team-wiki', title: 'Synthetic team Wiki', root: source.root, commit: fixture.versions[0]!.commit,
    vaultId: sourceConfig.vaultId, tenantId: sourceConfig.tenantId, readers: [{ id: principal.id, tenantId: callerConfig.tenantId }],
    scopes: ['project'] as Scope[], maxSensitivity: 'secret' as Sensitivity, masterKeyEnv: 'SHARED_TEST_MASTER_KEY' as string | undefined };
  const env: NodeJS.ProcessEnv = { SHARED_TEST_MASTER_KEY: masterKey };
  const saveBindings = (sources: unknown[] = [binding]) => writeFile(configPath, JSON.stringify({ version: 1, sources }), { mode: 0o600 });
  await saveBindings();
  const reader = new SharedWikiReader(caller, { configPath, env });
  const input = { sourceId: binding.id, pageKeys: [pageKey], includeSecret: sensitivity === 'secret', includeSensitive: sensitivity === 'sensitive' };
  return { ...fixture, source, caller, callerAdmin, principal, callerConfig, sourceConfig, binding, configPath, env, saveBindings, reader, input };
}

export async function integrity(vault: MemoryVault) {
  return { head: await vault.git.run(['rev-parse', 'HEAD']), refs: await vault.git.run(['show-ref'], { allowFailure: true }),
    index: await readFile(join(vault.git.gitDir, 'index')), status: await vault.git.run(['status', '--porcelain']) };
}
