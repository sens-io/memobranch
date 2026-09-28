import { z } from 'zod';
import type { VaultConfig } from './types.js';
import { sha256 } from './utils.js';

/** Deliberately excludes secrets, remote transport, identity and encryption policy. */
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  residentBudget: z.number().int().min(1).max(500),
  minimumConfidence: z.number().min(0).max(1),
  minimumProcedureEvidence: z.number().int().min(1).max(100),
  index: z.object({
    maxDocuments: z.number().int().min(1).max(1_000_000),
    lexicalWeight: z.number().min(0).max(1),
    semanticWeight: z.number().min(0).max(1),
    embeddingModel: z.string().trim().min(1).max(200).nullable(),
  }).strict().refine(value => value.lexicalWeight + value.semanticWeight > 0),
  maintenance: z.object({
    intervalMs: z.number().int().min(1000).max(86_400_000),
    debounceMs: z.number().int().min(50).max(60_000),
    autoSync: z.boolean(),
  }).strict(),
  limits: z.object({
    maxContentCharacters: z.number().int().min(1000).max(20_000_000),
    maxQueryCharacters: z.number().int().min(1).max(100_000),
    maxResults: z.number().int().min(1).max(1000),
    maxContextCharacters: z.number().int().min(500).max(5_000_000),
  }).strict(),
}).strict();

export function publicSettings(config: VaultConfig) {
  const { name, residentBudget, minimumConfidence, minimumProcedureEvidence, index, maintenance, limits } = config;
  // Project every nested field explicitly too: configuration migration deliberately
  // tolerates extension fields, which are not part of the browser's public contract.
  return { name, residentBudget, minimumConfidence, minimumProcedureEvidence,
    index: { maxDocuments: index.maxDocuments, lexicalWeight: index.lexicalWeight, semanticWeight: index.semanticWeight, embeddingModel: index.embeddingModel },
    maintenance: { intervalMs: maintenance.intervalMs, debounceMs: maintenance.debounceMs, autoSync: maintenance.autoSync },
    limits: { maxContentCharacters: limits.maxContentCharacters, maxQueryCharacters: limits.maxQueryCharacters, maxResults: limits.maxResults, maxContextCharacters: limits.maxContextCharacters },
  };
}

export function settingsRevision(config: VaultConfig): string {
  return sha256(JSON.stringify(config));
}
