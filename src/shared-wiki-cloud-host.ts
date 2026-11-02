import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { throwIfCancelled } from './operation.js';
import { authorize, type Principal } from './policy.js';
import { cloudWikiAccountSchema, readCloudAccounts, type CloudWikiAccount } from './shared-wiki-cloud-config.js';
import { SharedWikiReader } from './shared-wiki.js';
import { sha256 } from './utils.js';
import { MemoryVault } from './vault.js';
import { stableWikiJson } from './wiki-proof.js';

const templateSchema = cloudWikiAccountSchema.omit({ vaultId: true, tenantId: true });
export type CloudWikiAccountTemplateOptions = z.input<typeof templateSchema>;

/** Native operator helpers only; never register as remote or agent tools. */
export function createCloudWikiCredential(principal: Principal) {
  authorize(principal, 'admin'); throwIfCancelled();
  const token = randomBytes(32).toString('base64url');
  return { version: 1 as const, kind: 'cloud-wiki-credential' as const, token, tokenSha256: sha256(token) };
}

export async function cloudWikiAccountTemplate(principal: Principal, input: CloudWikiAccountTemplateOptions, env: NodeJS.ProcessEnv = process.env) {
  const validate = operatorGuard(principal), parsed = templateSchema.safeParse(input);
  if (!parsed.success) invalid();
  const broker = new MemoryVault(parsed.data.root, { principal }), config = await broker.config();
  const complete = cloudWikiAccountSchema.safeParse({ ...parsed.data, vaultId: config.vaultId, tenantId: config.tenantId });
  if (!complete.success) invalid();
  const account = complete.data;
  accountAuthority(principal, account); validate();
  const catalog = await readableAccount(account, env);
  if (catalog.sources.length === 0) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'The account needs an existing readable local source binding');
  validate();
  return { version: 1 as const, accounts: [account] };
}

export async function inspectCloudWikiAccounts(principal: Principal, configPath: string, env: NodeJS.ProcessEnv = process.env) {
  const validate = operatorGuard(principal), before = await readCloudAccounts(configPath);
  const accounts: Array<{ id: string; configuredSources: number }> = [];
  for (const account of before.accounts) {
    validate(); accountAuthority(principal, account);
    const catalog = await readableAccount(account, env); validate();
    accounts.push({ id: account.id, configuredSources: catalog.sources.length });
  }
  if ((await readCloudAccounts(configPath)).hash !== before.hash) throw new AgentMemoryError('VALIDATION_FAILED', 'Cloud account configuration changed; retry the check');
  validate();
  return { version: 1 as const, kind: 'cloud-wiki-host-check' as const, accounts,
    notice: 'Broker identities and configured local reader bindings checked; page availability, decryption and remote deployment are not established.' };
}

async function readableAccount(account: CloudWikiAccount, env: NodeJS.ProcessEnv) {
  const principal: Principal = { id: account.id, name: account.id, tenantId: account.tenantId,
    permissions: ['read'], scopes: [...account.scopes], maxSensitivity: account.maxSensitivity };
  const vault = new MemoryVault(account.root, { principal }), config = await vault.config();
  if (config.vaultId !== account.vaultId || config.tenantId !== account.tenantId) invalid();
  return new SharedWikiReader(vault, { configPath: account.sharedWikiConfig, env, localOnly: true }).catalog();
}
function accountAuthority(principal: Principal, account: CloudWikiAccount) {
  for (const scope of account.scopes) authorize(principal, 'admin', { tenantId: account.tenantId, scope, sensitivity: account.maxSensitivity });
}
function operatorGuard(principal: Principal) {
  authorize(principal, 'admin'); const identity = stableWikiJson(principal);
  return () => {
    throwIfCancelled(); authorize(principal, 'admin');
    if (stableWikiJson(principal) !== identity) throw new AgentMemoryError('AUTHORIZATION_DENIED', 'Cloud host operator authority changed');
  };
}
function invalid(): never { throw new AgentMemoryError('CONFIG_INVALID', 'Cloud host configuration or broker identity is invalid'); }
