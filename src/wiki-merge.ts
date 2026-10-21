import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { sensitivities, scopes } from './types.js';
import type { Scope, Sensitivity } from './types.js';

export interface WikiMergeOptions {
  fromCommit: string;
  pageKey: string;
  expectedRevision: number;
  body: string;
  summary: string;
  title?: string | undefined;
  includeSensitive?: boolean | undefined;
  includeSecret?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface WikiMergeOrigin {
  fromCommit: string;
  key: string;
  baseRevision: number;
  baseHash: string;
  supportKeys: string[];
  selection: { includeSensitive: boolean; includeSecret: boolean };
  scope: Scope;
  sensitivity: Sensitivity;
  conditions: string[];
  uncertainty: string[];
  conflicted: boolean;
  validFrom?: string | undefined;
  expiresAt?: string | undefined;
}

const clean = (maximum: number) => z.string().trim().min(1).max(maximum).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const mergeOptionsSchema = z.object({
  fromCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), pageKey: clean(200),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), body: z.string().trim().min(1).max(100_000).refine(value => !value.includes('\0')),
  summary: clean(2000), title: clean(300).optional(), includeSensitive: z.boolean().optional(), includeSecret: z.boolean().optional(),
  signal: z.instanceof(AbortSignal).optional(),
}).strict();

export const mergeOriginSchema = z.object({
  fromCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), key: clean(200),
  baseRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  supportKeys: z.array(clean(200)).min(1).max(50).refine(keys => new Set(keys).size === keys.length),
  selection: z.object({ includeSensitive: z.boolean(), includeSecret: z.boolean() }).strict(),
  scope: z.enum(scopes), sensitivity: z.enum(sensitivities), conditions: z.array(clean(4000)).max(100),
  uncertainty: z.array(clean(4000)).max(100), conflicted: z.boolean(),
  validFrom: z.string().datetime({ offset: true }).optional(), expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export function assertMergeTime(origin: WikiMergeOrigin): void {
  const now = Date.now();
  if (origin.validFrom && Date.parse(origin.validFrom) > now || origin.expiresAt && Date.parse(origin.expiresAt) <= now) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Historical merge support is no longer currently effective; prepare again');
  }
}
