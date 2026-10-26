import { z } from 'zod';
import { scopes, sensitivities } from './types.js';

const clean = (maximum: number) => z.string().trim().min(1).max(maximum)
  .regex(/^[^\u0000-\u001f\u007f]+$/u).refine(value => !/[\uD800-\uDFFF]/u.test(value));
const evidenceId = z.string().regex(/^ev-[a-f0-9]{12,64}$/);
const key = clean(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value)
  && !value.startsWith('source:') && !value.startsWith('legacy:'));
export const wikiIntegrationOptionsSchema = z.object({
  evidenceId, pageKey: key, expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  title: clean(300), summary: clean(2000),
  body: z.string().trim().min(1).max(100_000).refine(value => !/[\0\uD800-\uDFFF]/u.test(value)),
  pageType: z.enum(['entity', 'concept', 'synthesis', 'comparison', 'query']).optional(),
  scope: z.enum(scopes).optional(), sensitivity: z.enum(sensitivities).optional(), status: z.enum(['active', 'conflicted']).optional(),
  conditions: z.array(clean(4000)).max(100).refine(values => new Set(values).size === values.length).optional(),
  uncertainty: z.array(clean(4000)).max(100).refine(values => new Set(values).size === values.length).optional(),
  includeSensitive: z.boolean().optional(), includeSecret: z.boolean().optional(), signal: z.instanceof(AbortSignal).optional(),
}).strict();
export type WikiIntegrationOptions = z.input<typeof wikiIntegrationOptionsSchema>;
export const wikiIntegrationOriginSchema = z.object({ evidenceId, key,
  scope: z.enum(scopes), sensitivity: z.enum(sensitivities),
  selection: z.object({ includeSensitive: z.boolean(), includeSecret: z.boolean() }).strict(),
}).strict();
export type WikiIntegrationOrigin = z.infer<typeof wikiIntegrationOriginSchema>;
