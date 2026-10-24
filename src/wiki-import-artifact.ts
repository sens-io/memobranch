import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { factValidityConditions } from './effective-time.js';
import type { SharedWikiView } from './shared-wiki.js';
import { scopes, sensitivities, type EvidenceMeta, type MarkdownDocument, type Scope, type Sensitivity } from './types.js';
import { sha256, unique } from './utils.js';
import { stableWikiJson } from './wiki-proof.js';
import { pageTypes, type WikiPageMeta } from './wiki-types.js';
import type { WikiSnapshotSupport } from './wiki-snapshot.js';

const clean = (max: number) => z.string().min(1).max(max).regex(/^[^\x00-\x1f\x7f]+$/u).refine(value => !/[\uD800-\uDFFF]/u.test(value));
const digest = z.string().regex(/^[a-f0-9]{64}$/), key = clean(200), date = z.string().datetime({ offset: true });
const path = clean(1000).refine(value => /^(?:wiki|evidence)\//.test(value) && value.endsWith('.md') && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..'));
const list = <T extends z.ZodType>(schema: T, max = 100) => z.array(schema).max(max).refine(values => new Set(values.map(value => stableWikiJson(value))).size === values.length);
const page = z.object({ key, id: key, path, pageType: z.enum([...pageTypes, 'legacy']), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recordHash: digest, title: clean(1_000_000), summary: clean(2000), body: z.string().min(1).max(1_000_000), scope: z.enum(scopes), sensitivity: z.enum(sensitivities),
  status: z.enum(['active', 'conflicted']), evidence: list(path).min(1), links: list(key), conditions: list(clean(4000)), uncertainty: list(clean(4000)),
  validFrom: date.optional(), expiresAt: date.optional(),
}).strict();
const support = z.object({ scope: z.enum(scopes), sensitivity: z.enum(sensitivities), conditions: list(clean(4000)), uncertainty: list(clean(4000)),
  conflicted: z.boolean(), validFrom: date.optional(), expiresAt: date.optional() }).strict();
export const wikiImportArtifactSchema = z.object({ version: z.literal(1), kind: z.literal('compiled-wiki-source-artifact'),
  source: z.object({ id: key, title: key, vaultId: key, tenantId: key, commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/) }).strict(),
  requestedKeys: list(key, 25).min(1), pages: list(page, 50).min(1).refine(pages => new Set(pages.map(page => page.key)).size === pages.length),
  sources: list(z.object({ id: z.string().regex(/^ev-[a-f0-9]{12,64}$/), path, sha256: digest }).strict(), 1000),
  rules: list(z.object({ id: key, revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(), 100),
  support,
}).strict();
export type WikiImportArtifact = z.infer<typeof wikiImportArtifactSchema>;
export interface WikiImportRestrictions { scope: Scope; sensitivity: Sensitivity; conditions: string[]; uncertainty: string[]; conflicted: boolean; validFrom?: string; expiresAt?: string }
export const importedWikiCaution = 'Copied compiled Wiki material; original raw sources were not copied or independently verified. Offline plaintext cannot be recalled.';
const prefix = 'Compiled Wiki import artifact (v1)\n\n' + importedWikiCaution + '\n\n';
const uriPrefix = 'urn:memobranch:compiled-wiki:v1:';
export function isWikiImportUri(value: string | undefined): boolean { return typeof value === 'string' && value.startsWith(uriPrefix); }

/** Normalize only known fields. No source credentials, attachments or runtime read timestamps. */
export function wikiImportArtifact(view: SharedWikiView, currentSupport?: WikiSnapshotSupport): WikiImportArtifact {
  const pages = view.snapshot.pages.map(document => {
    const meta = document.meta, legacy = meta.type === 'memory';
    const ends = [meta.expiresAt, ...(legacy ? [meta.validUntil] : [])].filter((value): value is string => Boolean(value)).sort((a,b) => Date.parse(a)-Date.parse(b));
    return { key: legacy ? 'legacy:' + meta.id : meta.key, id: meta.id, path: document.path, pageType: legacy ? 'legacy' : meta.pageType, revision: meta.revision,
      recordHash: sha256(stableWikiJson({ path: document.path, meta, body: document.body })), title: legacy ? meta.key : meta.title, summary: legacy ? 'Imported ordinary memory support.' : meta.summary,
      body: document.body, scope: meta.scope, sensitivity: meta.sensitivity, status: meta.status, evidence: [...meta.evidence],
      links: legacy ? [] : unique([...meta.links, ...Object.keys(meta.dependencies)]), conditions: unique([...meta.conditions, ...(legacy ? factValidityConditions(meta) : [])]),
      uncertainty: legacy ? meta.status === 'conflicted' ? ['Imported ordinary memory has unresolved conflict.'] : [] : [...meta.uncertainty],
      ...(legacy && meta.validFrom ? { validFrom: meta.validFrom } : {}), ...(ends[0] ? { expiresAt: ends[0] } : {}) };
  });
  return checked({ version: 1, kind: 'compiled-wiki-source-artifact', source: { ...view.source }, requestedKeys: [...view.snapshot.requestedKeys], pages,
    sources: view.snapshot.sources.map(source => ({ ...source })), rules: view.snapshot.rules.map(rule => ({ ...rule })),
    support: currentSupport ?? { scope: scopes[Math.min(...pages.map(page => scopes.indexOf(page.scope)))]!, sensitivity: sensitivities[Math.max(...pages.map(page => sensitivities.indexOf(page.sensitivity)))]!,
      conditions: [], uncertainty: [], conflicted: false } });
}

export function wikiImportContent(artifact: WikiImportArtifact): string {
  const content = prefix + stableWikiJson(checked(artifact));
  if (Buffer.byteLength(content, 'utf8') > 1_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete Wiki import artifact exceeds 1000000 bytes');
  return content;
}
export function wikiImportUri(artifact: WikiImportArtifact): string {
  return uriPrefix + [artifact.source.vaultId, artifact.source.tenantId, artifact.source.commit].map(value => encodeURIComponent(value)).join(':') + ':' + sha256(wikiImportContent(artifact));
}
export function wikiImportRestrictions(artifact: WikiImportArtifact): WikiImportRestrictions {
  const all = [...artifact.pages, artifact.support];
  const conditions = unique(all.flatMap(page => page.conditions)), uncertainty = unique([importedWikiCaution, ...all.flatMap(page => page.uncertainty)]);
  if (conditions.length > 100 || uncertainty.length > 100) invalid();
  const start = all.flatMap(page => page.validFrom ? [page.validFrom] : []).sort((a,b) => Date.parse(b)-Date.parse(a))[0];
  const end = all.flatMap(page => page.expiresAt ? [page.expiresAt] : []).sort((a,b) => Date.parse(a)-Date.parse(b))[0];
  return { scope: scopes[Math.min(...all.map(page => scopes.indexOf(page.scope)))]!, sensitivity: sensitivities[Math.max(...all.map(page => sensitivities.indexOf(page.sensitivity)))]!,
    conditions, uncertainty, conflicted: artifact.support.conflicted || artifact.pages.some(page => page.status === 'conflicted'), ...(start ? { validFrom: start } : {}), ...(end ? { expiresAt: end } : {}) };
}
export function assertWikiImportTime(restrictions: WikiImportRestrictions): void {
  const now = Date.now();
  if (restrictions.validFrom && Date.parse(restrictions.validFrom) > now || restrictions.expiresAt && Date.parse(restrictions.expiresAt) <= now) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Imported Wiki support is not currently effective');
  }
}
export function wikiImportSupportsPage(boundary: WikiImportRestrictions, page: WikiPageMeta): boolean {
  try { assertWikiImportTime(boundary); } catch { return false; }
  return scopes.indexOf(page.scope) <= scopes.indexOf(boundary.scope) && sensitivities.indexOf(page.sensitivity) >= sensitivities.indexOf(boundary.sensitivity)
    && (!boundary.conflicted || page.status === 'conflicted') && boundary.conditions.every(value => page.conditions.includes(value))
    && boundary.uncertainty.every(value => page.uncertainty.includes(value))
    && (!boundary.expiresAt || Boolean(page.expiresAt && Date.parse(page.expiresAt) <= Date.parse(boundary.expiresAt)));
}

/** A reserved source identity cannot carry ordinary prose or weaker destination labels. */
export function readWikiImportArtifact(document: MarkdownDocument<EvidenceMeta>): WikiImportArtifact | undefined {
  if (!isWikiImportUri(document.meta.sourceUri)) return undefined;
  if (document.meta.digestVersion !== 4) invalid();
  const header = `# Evidence ${document.meta.id}\n\n` + prefix;
  if (!document.body.startsWith(header) || Buffer.byteLength(document.body, 'utf8') > 1_000_100) invalid();
  let artifact: WikiImportArtifact;
  try { artifact = checked(JSON.parse(document.body.slice(header.length))); } catch { return invalid(); }
  if (document.meta.sourceUri !== wikiImportUri(artifact) || document.body !== `# Evidence ${document.meta.id}\n\n` + wikiImportContent(artifact)) invalid();
  const boundary = wikiImportRestrictions(artifact);
  if (scopes.indexOf(document.meta.scope) > scopes.indexOf(boundary.scope) || sensitivities.indexOf(document.meta.sensitivity) < sensitivities.indexOf(boundary.sensitivity)) invalid();
  return artifact;
}
function checked(value: unknown): WikiImportArtifact {
  const parsed = wikiImportArtifactSchema.safeParse(value); if (!parsed.success) invalid();
  const artifact = parsed.data, pages = new Set(artifact.pages.map(page => page.key)), paths = new Set(artifact.sources.map(source => source.path));
  if (artifact.requestedKeys.some(key => !pages.has(key)) || artifact.pages.some(page => page.links.some(key => !pages.has(key)) || page.evidence.some(path => !paths.has(path)))) invalid();
  wikiImportRestrictions(artifact); return artifact;
}
function invalid(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid derived Wiki import artifact or classification'); }
