import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { startCloudWikiServer, type CloudWikiServerOptions } from '../src/shared-wiki-cloud-server.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import { SharedWikiImporter } from '../src/shared-wiki-import.js';
import type { Principal } from '../src/policy.js';
import type { Sensitivity } from '../src/types.js';
import { sha256 } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';
import { sharedFixture } from './shared-wiki-fixture.js';

export const cloudCredential = 'synthetic_cloud_client_credential_000000000000000000';
export async function cloudClientFixture(t: TestContext, sensitivity: Sensitivity = 'internal', serviceOptions: Partial<CloudWikiServerOptions> = {}) {
  const base = await sharedFixture(t, sensitivity), accountPath = join(base.caller.root, '.amem/cloud-accounts.json');
  const account = { id: base.principal.id, tokenSha256: sha256(cloudCredential), root: base.caller.root,
    vaultId: base.callerConfig.vaultId, tenantId: base.callerConfig.tenantId,
    sharedWikiConfig: base.configPath, scopes: ['project'], maxSensitivity: 'secret' };
  const saveAccounts = (accounts: unknown[] = [account]) => writeFile(accountPath, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
  await saveAccounts();
  const localRoot = await mkdtemp(join(process.cwd(), '.scratch/cloud-client-'));
  base.cleanup.push(() => rm(localRoot, { recursive: true, force: true }));
  const localAdmin = new MemoryVault(localRoot, { masterKey: '31'.repeat(32) }); await localAdmin.initialize('Cloud client fixture');
  const config = await localAdmin.config();
  const principal: Principal = { id: 'cloud-reader', name: 'Synthetic cloud client', tenantId: config.tenantId,
    permissions: ['read', 'write', 'review'], scopes: ['project'], maxSensitivity: 'secret' };
  const caller = new MemoryVault(localRoot, { principal, masterKey: '31'.repeat(32) });
  base.env.CLOUD_TEST_CREDENTIAL = cloudCredential;
  const service = await startCloudWikiServer({ configPath: accountPath, env: base.env, ...serviceOptions });
  base.cleanup.push(() => service.stop());
  const configPath = join(localRoot, '.amem/shared-wiki.json');
  const binding = { transport: 'cloud', id: 'cloud-team', title: 'Synthetic cloud team Wiki', origin: service.url, allowLoopbackHttp: true,
    remoteSourceId: base.binding.id, commit: base.binding.commit, vaultId: base.binding.vaultId, tenantId: base.binding.tenantId,
    readers: [{ id: principal.id, tenantId: config.tenantId }], scopes: ['project'], maxSensitivity: 'secret',
    credentialEnv: 'CLOUD_TEST_CREDENTIAL', caFile: undefined as string | undefined, timeoutMs: undefined as number | undefined };
  const env = { ...base.env, CLOUD_TEST_CREDENTIAL: cloudCredential };
  const saveBindings = (sources: unknown[] = [binding]) => writeFile(configPath, JSON.stringify({ version: 2, sources }), { mode: 0o600 });
  await saveBindings();
  const reader = new SharedWikiReader(caller, { configPath, env }), importer = new SharedWikiImporter(caller, { configPath, env });
  return { ...base, broker: base.caller, brokerConfigPath: base.configPath, brokerBinding: base.binding, saveBrokerBindings: base.saveBindings,
    caller, localAdmin, principal, account, accountPath, saveAccounts, service, configPath, binding, env, saveBindings, reader, importer,
    selection: { ...base.input, sourceId: binding.id, expectedCommit: binding.commit } };
}
