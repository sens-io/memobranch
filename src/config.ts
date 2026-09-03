import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentMemoryError } from './errors.js';
import { validateRemote } from './git-store.js';
import type { LegacyVaultConfig, VaultConfig } from './types.js';
import { sensitivities } from './types.js';
import { nowIso, writeText } from './utils.js';

export const CURRENT_VAULT_VERSION = 2 as const;

export function defaultVaultConfig(name: string, vaultId: string, createdAt = nowIso()): VaultConfig {
  return {
    version: CURRENT_VAULT_VERSION,
    vaultId,
    tenantId: vaultId,
    name,
    createdAt,
    residentBudget: 24,
    minimumConfidence: 0.75,
    minimumProcedureEvidence: 2,
    policy: {
      residentSensitivities: ['public', 'internal'],
      requireEncryptionFor: ['sensitive', 'secret'],
    },
    index: {
      maxDocuments: 100_000,
      lexicalWeight: 0.7,
      semanticWeight: 0.3,
      embeddingModel: null,
    },
    remote: null,
    maintenance: {
      intervalMs: 300_000,
      debounceMs: 750,
      autoSync: false,
    },
    limits: {
      maxContentCharacters: 1_000_000,
      maxQueryCharacters: 2_000,
      maxResults: 50,
      maxContextCharacters: 50_000,
    },
  };
}

export async function readVaultConfig(root: string): Promise<VaultConfig> {
  const raw = await readRawConfig(root);
  if (raw.version === 1) return migrateValue(raw as unknown as LegacyVaultConfig);
  if (raw.version !== CURRENT_VAULT_VERSION) {
    throw new AgentMemoryError('CONFIG_VERSION_UNSUPPORTED', `Vault schema version ${String(raw.version)} is newer than supported version ${CURRENT_VAULT_VERSION}`, {
      found: raw.version,
      supported: CURRENT_VAULT_VERSION,
    });
  }
  return validateV2(raw);
}

export async function migrateVaultConfig(
  root: string,
  writer: (rootPath: string, content: string) => Promise<void> = (rootPath, content) => writeText(join(root, rootPath), content),
): Promise<{ config: VaultConfig; migrated: boolean }> {
  const raw = await readRawConfig(root);
  if (raw.version === CURRENT_VAULT_VERSION) return { config: validateV2(raw), migrated: false };
  if (raw.version !== 1) {
    throw new AgentMemoryError('CONFIG_VERSION_UNSUPPORTED', `Unsupported vault schema version: ${String(raw.version)}`);
  }
  const backup = join(root, 'agent-memory.json.v1.bak');
  if (!existsSync(backup)) await writer('agent-memory.json.v1.bak', `${JSON.stringify(raw, null, 2)}\n`);
  const config = migrateValue(raw as unknown as LegacyVaultConfig);
  await writer('agent-memory.json', `${JSON.stringify(config, null, 2)}\n`);
  return { config, migrated: true };
}

async function readRawConfig(root: string): Promise<Record<string, unknown>> {
  const path = join(root, 'agent-memory.json');
  if (!existsSync(path)) throw new AgentMemoryError('VAULT_NOT_INITIALIZED', `Not a MemoBranch vault: ${root}`);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Configuration must be an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AgentMemoryError) throw error;
    throw new AgentMemoryError('CONFIG_INVALID', `Invalid agent-memory.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function migrateValue(legacy: LegacyVaultConfig): VaultConfig {
  const base = defaultVaultConfig(legacy.name, legacy.vaultId, legacy.createdAt);
  return {
    ...base,
    residentBudget: boundedNumber(legacy.residentBudget, 1, 500, base.residentBudget),
    minimumConfidence: boundedNumber(legacy.minimumConfidence, 0, 1, base.minimumConfidence),
    minimumProcedureEvidence: boundedNumber(legacy.minimumProcedureEvidence, 1, 100, base.minimumProcedureEvidence),
  };
}

function validateV2(raw: Record<string, unknown>): VaultConfig {
  const requiredStrings = ['vaultId', 'tenantId', 'name', 'createdAt'] as const;
  for (const key of requiredStrings) {
    if (typeof raw[key] !== 'string' || !raw[key]) throw new AgentMemoryError('CONFIG_INVALID', `Configuration field ${key} is required`);
  }
  if (Number.isNaN(Date.parse(String(raw.createdAt)))) throw new AgentMemoryError('CONFIG_INVALID', 'Configuration field createdAt must be an ISO date');
  for (const key of ['policy', 'index', 'maintenance', 'limits'] as const) {
    if (raw[key] !== undefined && !isRecord(raw[key])) throw new AgentMemoryError('CONFIG_INVALID', `Configuration field ${key} must be an object`);
  }
  if (raw.remote !== undefined && raw.remote !== null && !isRecord(raw.remote)) throw new AgentMemoryError('CONFIG_INVALID', 'Configuration field remote must be an object or null');
  const config = raw as unknown as VaultConfig;
  const defaults = defaultVaultConfig(config.name, config.vaultId, config.createdAt);
  const merged: VaultConfig = {
    ...defaults,
    ...config,
    policy: { ...defaults.policy, ...config.policy },
    index: { ...defaults.index, ...config.index },
    maintenance: { ...defaults.maintenance, ...config.maintenance },
    limits: { ...defaults.limits, ...config.limits },
    remote: config.remote ?? null,
  };
  if (!Array.isArray(merged.policy.residentSensitivities) || merged.policy.residentSensitivities.some((value) => !sensitivities.includes(value))) {
    throw new AgentMemoryError('CONFIG_INVALID', 'policy.residentSensitivities is invalid');
  }
  if (!Array.isArray(merged.policy.requireEncryptionFor) || merged.policy.requireEncryptionFor.some((value) => !sensitivities.includes(value))) {
    throw new AgentMemoryError('CONFIG_INVALID', 'policy.requireEncryptionFor is invalid');
  }
  if (!merged.policy.requireEncryptionFor.includes('sensitive') || !merged.policy.requireEncryptionFor.includes('secret')) {
    throw new AgentMemoryError('CONFIG_INVALID', 'Sensitive and secret records must require encryption');
  }
  merged.residentBudget = boundedRequired(merged.residentBudget, 1, 500, 'residentBudget');
  merged.minimumConfidence = boundedRequired(merged.minimumConfidence, 0, 1, 'minimumConfidence');
  merged.minimumProcedureEvidence = boundedRequired(merged.minimumProcedureEvidence, 1, 100, 'minimumProcedureEvidence');
  merged.index.maxDocuments = boundedRequired(merged.index.maxDocuments, 1, 1_000_000, 'index.maxDocuments');
  merged.index.lexicalWeight = boundedRequired(merged.index.lexicalWeight, 0, 1, 'index.lexicalWeight');
  merged.index.semanticWeight = boundedRequired(merged.index.semanticWeight, 0, 1, 'index.semanticWeight');
  if (merged.index.lexicalWeight + merged.index.semanticWeight <= 0) throw new AgentMemoryError('CONFIG_INVALID', 'At least one index weight must be positive');
  if (merged.index.embeddingModel !== null && (typeof merged.index.embeddingModel !== 'string' || !merged.index.embeddingModel.trim())) {
    throw new AgentMemoryError('CONFIG_INVALID', 'index.embeddingModel must be a non-empty string or null');
  }
  merged.maintenance.intervalMs = boundedRequired(merged.maintenance.intervalMs, 1_000, 86_400_000, 'maintenance.intervalMs');
  merged.maintenance.debounceMs = boundedRequired(merged.maintenance.debounceMs, 50, 60_000, 'maintenance.debounceMs');
  if (typeof merged.maintenance.autoSync !== 'boolean') throw new AgentMemoryError('CONFIG_INVALID', 'maintenance.autoSync must be boolean');
  merged.limits.maxContentCharacters = boundedRequired(merged.limits.maxContentCharacters, 1_000, 20_000_000, 'limits.maxContentCharacters');
  merged.limits.maxQueryCharacters = boundedRequired(merged.limits.maxQueryCharacters, 1, 100_000, 'limits.maxQueryCharacters');
  merged.limits.maxResults = boundedRequired(merged.limits.maxResults, 1, 1_000, 'limits.maxResults');
  merged.limits.maxContextCharacters = boundedRequired(merged.limits.maxContextCharacters, 500, 5_000_000, 'limits.maxContextCharacters');
  if (merged.remote) {
    if (!merged.remote.name || !merged.remote.url || !merged.remote.branch || typeof merged.remote.push !== 'boolean') {
      throw new AgentMemoryError('CONFIG_INVALID', 'remote configuration is invalid');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(merged.remote.name) || merged.remote.branch.startsWith('-') || /[\s~^:?*\\\[\]]/.test(merged.remote.branch) || merged.remote.branch.includes('..')) {
      throw new AgentMemoryError('CONFIG_INVALID', 'remote name or branch is invalid');
    }
    validateRemote(merged.remote.name, merged.remote.url);
  }
  return merged;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function boundedRequired(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AgentMemoryError('CONFIG_INVALID', `Configuration field ${field} must be between ${min} and ${max}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
