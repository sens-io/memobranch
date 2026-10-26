import { z } from 'zod';
import { assertManagedDocument } from './document-schema.js';
import { AgentMemoryError } from './errors.js';
import { factValidityConditions } from './effective-time.js';
import { authorize, type Principal } from './policy.js';
import { memoryKinds, scopes, sensitivities, type MarkdownDocument } from './types.js';
import { wikiPageMetaSchema } from './wiki-schema.js';
import type { WikiPageMeta } from './wiki-types.js';
import { assertSnapshotPath, type WikiSnapshot, type WikiSnapshotSupport } from './wiki-snapshot.js';

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/^[^\x00-\x1f\x7f]+$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), date = z.string().datetime({ offset: true });
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const list = <T extends z.ZodType>(schema: T, maximum = 100) => z.array(schema).max(maximum);
const prose = z.string().min(1).max(1_000_000);
const legacyMeta = z.object({ id: text(200), type: z.literal('memory'), createdAt: date, updatedAt: date, validatedAt: date,
  kind: z.enum(memoryKinds), key: prose, scope: z.enum(scopes), sensitivity: z.enum(sensitivities),
  confidence: z.number().min(0).max(1), status: z.enum(['active', 'conflicted']), evidence: list(text(1000), 200),
  conditions: list(z.string().max(1_000_000), 20_000), tags: list(z.string().max(1_000_000), 20_000), revision,
  expiresAt: date.optional(), validFrom: date.optional(), validUntil: date.optional(),
  supersedes: list(text(200), 1000).optional(), supersededBy: text(200).optional(), revokedAt: date.optional(), revocationReason: text(1_000_000).optional(),
}).strict();
// Validation must not trim/normalize committed metadata: it contributes to origin hashes.
const wikiMeta = z.custom<WikiPageMeta>(value => wikiPageMetaSchema.safeParse(value).success);
const document = z.object({ path: text(1000), meta: z.union([wikiMeta, legacyMeta]), body: z.string().min(1).max(20_000_000), currentRevision: revision }).strict();
const supportSchema = z.object({ scope: z.enum(scopes), sensitivity: z.enum(sensitivities),
  conditions: list(prose, 20_000), uncertainty: list(prose, 20_000), conflicted: z.boolean(),
  validFrom: date.optional(), expiresAt: date.optional(),
}).strict();
const envelopeSchema = z.object({ version: z.literal(1), kind: z.literal('cloud-shared-wiki-snapshot'),
  view: z.object({ version: z.literal(1), kind: z.literal('shared-wiki-view'),
    source: z.object({ id: text(200), title: text(200), vaultId: text(200), tenantId: text(200), commit }).strict(),
    snapshot: z.object({ version: z.literal(1), kind: z.literal('wiki-revision-view'), commit, authorityHead: commit, checkedAt: date,
      requestedKeys: list(text(200), 25).min(1), pages: list(document, 50).min(1),
      sources: list(z.object({ id: z.string().regex(/^ev-[a-f0-9]{12,64}$/), path: text(1000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), 200),
      rules: list(z.object({ id: text(200), revision }).strict(), 200), warnings: list(text(4000)),
    }).strict(), warnings: list(text(4000)),
  }).strict(), support: supportSchema, validForMs: z.number().int().min(1).max(30_000),
}).strict();

export interface CloudWikiExpectedSource { sourceId: string; vaultId: string; tenantId: string; commit: string; pageKeys: string[] }

/** Validate the complete received graph, not a projection that silently drops unknown metadata. */
export function cloudWikiEnvelope(value: unknown, expected: CloudWikiExpectedSource, principal: Principal,
  selection: { includeSensitive: boolean; includeSecret: boolean }) {
  try {
    const parsed = envelopeSchema.safeParse(value); if (!parsed.success) invalid();
    const envelope = parsed.data, view = envelope.view, snapshot = view.snapshot, support = envelope.support;
    if (view.source.id !== expected.sourceId || view.source.vaultId !== expected.vaultId || view.source.tenantId !== expected.tenantId
      || view.source.commit !== expected.commit || snapshot.commit !== expected.commit
      || JSON.stringify(snapshot.requestedKeys) !== JSON.stringify(expected.pageKeys)) invalid();
    const pages = new Map(snapshot.pages.map(page => [page.meta.type === 'memory' ? 'legacy:' + page.meta.id : page.meta.key, page]));
    if (pages.size !== snapshot.pages.length || new Set(snapshot.pages.map(page => page.path)).size !== pages.size
      || new Set(snapshot.pages.map(page => page.meta.id)).size !== pages.size || expected.pageKeys.some(key => !pages.has(key))) invalid();
    const sources = new Map(snapshot.sources.map(source => [source.path, source]));
    const rules = new Map(snapshot.rules.map(rule => [rule.id, rule.revision]));
    if (sources.size !== snapshot.sources.length || new Set(snapshot.sources.map(source => source.id)).size !== sources.size || rules.size !== snapshot.rules.length) invalid();
    for (const source of snapshot.sources) { assertSnapshotPath(source.path); if (!source.path.startsWith('evidence/') || !source.path.endsWith(source.id + '.md')) invalid(); }
    const checkAuthority = (meta: { scope: typeof scopes[number]; sensitivity: typeof sensitivities[number] }) => {
      authorize(principal, 'read', { ...meta, tenantId: expected.tenantId });
      if (meta.sensitivity === 'secret' && !selection.includeSecret || meta.sensitivity === 'sensitive' && !selection.includeSensitive) invalid();
    };
    checkAuthority(support);
    const conditions = new Set(support.conditions), uncertainty = new Set(support.uncertainty);
    for (const page of snapshot.pages) {
      assertSnapshotPath(page.path); if (!page.path.startsWith('wiki/')) invalid();
      assertManagedDocument(page as unknown as MarkdownDocument<Record<string, unknown>>);
      const meta = page.meta; checkAuthority(meta);
      if (!['active', 'conflicted'].includes(meta.status) || meta.evidence.some(path => !sources.has(path))
        || scopes.indexOf(support.scope) > scopes.indexOf(meta.scope) || sensitivities.indexOf(support.sensitivity) < sensitivities.indexOf(meta.sensitivity)
        || meta.conditions.some(condition => !conditions.has(condition)) || meta.status === 'conflicted' && !support.conflicted) invalid();
      const ends = [meta.expiresAt, ...(meta.type === 'memory' ? [meta.validUntil] : [])];
      if (ends.some(end => end && (!support.expiresAt || Date.parse(support.expiresAt) > Date.parse(end)))) invalid();
      if (meta.type === 'wiki-page') {
        if (meta.uncertainty.some(item => !uncertainty.has(item)) || meta.links.some(key => !pages.has(key))
          || Object.entries(meta.dependencies).some(([key, revision]) => pages.get(key)?.meta.revision !== revision)
          || Object.entries(meta.rules).some(([id, revision]) => rules.get(id) !== revision)) invalid();
      } else if (factValidityConditions({ ...(meta.validFrom === undefined ? {} : { validFrom: meta.validFrom }), ...(meta.validUntil === undefined ? {} : { validUntil: meta.validUntil }) }).some(condition => !conditions.has(condition))
        || meta.validFrom && (!support.validFrom || Date.parse(support.validFrom) < Date.parse(meta.validFrom))) invalid();
    }
    const pending = [...expected.pageKeys], visited = new Set<string>();
    while (pending.length) {
      const key = pending.pop()!; if (visited.has(key)) continue; visited.add(key);
      const page = pages.get(key); if (!page) invalid();
      if (page.meta.type === 'wiki-page') pending.push(...page.meta.links, ...Object.keys(page.meta.dependencies));
    }
    if (visited.size !== pages.size) invalid();
    return { snapshot: snapshot as unknown as WikiSnapshot, support: support as WikiSnapshotSupport, validForMs: envelope.validForMs };
  } catch (error) {
    if (error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED') throw new AgentMemoryError('AUTHORIZATION_DENIED', 'Cloud Wiki content exceeds current authority');
    return invalid();
  }
}
function invalid(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid cloud Wiki response or source identity'); }
