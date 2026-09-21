import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { sha256 } from './utils.js';
import { scopes, sensitivities, type MarkdownDocument } from './types.js';
import { pageTypes } from './wiki-types.js';

const clean = (maximum: number) => z.string().trim().min(1).max(maximum).regex(/^[^\u0000-\u001f\u007f]+$/u);
const key = clean(200).refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceId = z.string().regex(/^ev-[a-f0-9]{12,64}$/);
const pageId = z.string().regex(/^wp-[a-f0-9]{24}$/);
const rulesId = z.string().regex(/^wr-[a-f0-9]{24}$/);
export const builtinWikiRuleId = 'builtin-wiki-rules-v1';
const effectiveRuleId = z.union([rulesId, z.literal(builtinWikiRuleId)]);
const receiptId = z.string().regex(/^wi-[a-f0-9]{24}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const date = z.string().datetime({ offset: true });
const body = z.string().trim().min(1).max(100_000);
const generation = z.object({ vaultId: clean(200), model: clean(300), at: date }).strict();
const canonicalPath = z.string().min(1).max(1000).regex(/^(?:evidence|wiki)\/(?!\/)(?:[^\u0000-\u0020\\/]+\/)*[^\u0000-\u0020\\/]+\.md$/).refine((value) => value.split('/').every((part) => part !== '.' && part !== '..'));
const evidencePath = canonicalPath.refine((value) => value.startsWith('evidence/'));
const uniqueArray = <T extends z.ZodTypeAny>(schema: T, maximum = 100) => z.array(schema).max(maximum).refine((values) => new Set(values).size === values.length);
const record = <K extends z.ZodType<string>, V extends z.ZodTypeAny>(keys: K, values: V, maximum: number) => z.record(keys, values).refine((value) => Object.keys(value).length <= maximum);
const snapshot = record(canonicalPath, digest, 2000);
const common = {
  scope: z.enum(scopes), sensitivity: z.enum(sensitivities), createdAt: date, updatedAt: date,
};

export const wikiPageDraftSchema = z.object({
  key, pageType: z.enum(pageTypes), title: clean(300), summary: clean(2000), body,
  evidenceIds: uniqueArray(evidenceId).min(1), links: uniqueArray(key), status: z.enum(['active', 'conflicted']),
  conditions: uniqueArray(clean(4000)), uncertainty: uniqueArray(clean(4000)), expiresAt: date.optional(),
}).strict();

export const wikiPageMetaSchema = z.object({
  ...common, id: pageId, type: z.literal('wiki-page'), key, pageType: z.enum(pageTypes), title: clean(300), summary: clean(2000), revision,
  status: z.enum(['active', 'conflicted', 'revoked']), evidence: uniqueArray(evidencePath).min(1), links: uniqueArray(key),
  dependencies: record(key, revision, 100), rules: record(effectiveRuleId, revision, 100), conditions: uniqueArray(clean(4000)), uncertainty: uniqueArray(clean(4000)), expiresAt: date.optional(), originHash: digest.optional(),
}).strict();

export const wikiRulesMetaSchema = z.object({ ...common, id: rulesId, type: z.literal('wiki-rules'), revision, purpose: z.string().trim().min(1).max(4000) }).strict();
export const wikiReceiptMetaSchema = z.object({ ...common, id: receiptId, type: z.literal('wiki-receipt'), signature: digest, proof: digest, planHash: digest, sourceIds: uniqueArray(evidenceId).min(1), pageKeys: uniqueArray(key).min(1) }).strict();

export const wikiPlanSchema = z.object({
  version: z.literal(1), vaultId: clean(200), kind: z.enum(['compile', 'file', 'repair']), sourceIds: uniqueArray(evidenceId),
  snapshot, configHash: digest, contextKeys: uniqueArray(key), ruleIds: uniqueArray(effectiveRuleId), pages: z.array(wikiPageDraftSchema).min(1).max(40), receiptId: receiptId.optional(), proof: digest,
  expectedRevisions: record(key, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), 40),
  relevantPageVersions: record(key, revision, 100), ruleVersions: record(effectiveRuleId, revision, 100), sourceHashes: record(evidenceId, digest, 100),
  query: z.object({ key, hash: digest, generation }).strict().optional(),
}).strict();

export const wikiQueryResultSchema = z.object({
  answer: body, question: z.string().trim().min(1).max(100_000), uncertainty: uniqueArray(clean(4000)), snapshot, configHash: digest, ruleIds: uniqueArray(effectiveRuleId), ruleVersions: record(effectiveRuleId, revision, 100), generation, proof: digest,
  citations: z.array(z.object({
    key, id: clean(100), path: canonicalPath.refine((path) => path.startsWith('wiki/')), revision,
    evidence: uniqueArray(evidencePath).min(1), conditions: uniqueArray(clean(4000)), uncertainty: uniqueArray(clean(4000)),
  }).strict()).max(100).refine((citations) => new Set(citations.map((item) => item.key)).size === citations.length),
}).strict();

export function wikiPageId(key: string): string { return `wp-${sha256(key).slice(0, 24)}`; }
export function wikiPagePath(key: string): string { return `wiki/pages/${wikiPageId(key)}.md`; }
export function wikiRulesId(scope: string, sensitivity: string): string { return `wr-${sha256(`${scope}\0${sensitivity}`).slice(0, 24)}`; }
export function wikiReceiptId(sourceIds: string[]): string { return `wi-${sha256(JSON.stringify([...sourceIds].sort())).slice(0, 24)}`; }

export function assertWikiDocument(document: MarkdownDocument<Record<string, unknown>>): void {
  const schema = document.meta.type === 'wiki-page' ? wikiPageMetaSchema : document.meta.type === 'wiki-rules' ? wikiRulesMetaSchema : document.meta.type === 'wiki-receipt' ? wikiReceiptMetaSchema : null;
  if (!schema || !schema.safeParse(document.meta).success || !body.safeParse(document.body).success) fail();
  const meta = document.meta;
  if (meta.type === 'wiki-page') {
    if (meta.id !== wikiPageId(meta.key as string) || document.path !== wikiPagePath(meta.key as string)) fail();
    if (meta.pageType === 'source' && (!(meta.key as string).startsWith('source:') || !evidenceId.safeParse((meta.key as string).slice(7)).success)) fail();
  } else {
    if (document.path !== `wiki/.meta/${meta.id}.md`) fail();
    if (meta.type === 'wiki-rules' && meta.id !== wikiRulesId(meta.scope as string, meta.sensitivity as string)) fail();
    if (meta.type === 'wiki-receipt' && meta.id !== wikiReceiptId(meta.sourceIds as string[])) fail();
  }
}

function fail(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid Wiki document schema or canonical identity'); }
