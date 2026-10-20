import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { throwIfCancelled } from './operation.js';
import type { EvidenceMeta, MarkdownDocument, MemoryMeta } from './types.js';
import type { WikiPageMeta } from './wiki-types.js';

export interface SourceTimelineOptions {
  from?: string | undefined;
  to?: string | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
  includeSensitive?: boolean;
  includeSecret?: boolean;
}

/** Inputs must already have passed the vault's current read policy. */
export function sourceTimeline(sourceUri: string, evidence: MarkdownDocument<EvidenceMeta>[],
  pages: MarkdownDocument<MemoryMeta | WikiPageMeta>[], options: SourceTimelineOptions = {}) {
  const { offset = 0, limit = 30 } = options;
  const date = (value: string | undefined, fallback: number) => {
    if (value === undefined) return fallback;
    if (!z.iso.datetime({ offset: true }).safeParse(value).success || /\.\d{4,}/.test(value)) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Timeline dates require ISO timestamps with a timezone and at most millisecond precision');
    }
    return Date.parse(value);
  };
  const from = date(options.from, -Infinity);
  const to = date(options.to, Infinity);
  if (typeof sourceUri !== 'string' || !sourceUri.trim() || sourceUri.length > 4096 || sourceUri.includes('\0') ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || from > to) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid source timeline options');
  }
  const all = evidence.filter(document => document.meta.sourceUri === sourceUri)
    .sort((a, b) => Date.parse(b.meta.createdAt) - Date.parse(a.meta.createdAt) || b.path.localeCompare(a.path));
  // A secret or private version cannot mark a differently classified public
  // version as outdated, even for a reader allowed to see both.
  const latest = new Map<string, MarkdownDocument<EvidenceMeta>>();
  for (const document of all) {
    const group = `${document.meta.scope}:${document.meta.sensitivity}`;
    if (!latest.has(group)) latest.set(group, document);
  }
  const filtered = all.filter(document => Date.parse(document.meta.createdAt) >= from && Date.parse(document.meta.createdAt) <= to);
  const items = filtered.slice(offset, offset + limit).map(document => {
    throwIfCancelled();
    const current = latest.get(`${document.meta.scope}:${document.meta.sensitivity}`)!;
    const references = pages.filter(page => ['active', 'conflicted'].includes(page.meta.status) && page.meta.evidence.includes(document.path));
    return { id: document.meta.id, path: document.path, recordedAt: document.meta.createdAt, sha256: document.meta.sha256,
      scope: document.meta.scope, sensitivity: document.meta.sensitivity, latestEvidenceId: current.meta.id,
      isLatest: document.meta.id === current.meta.id,
      references: references.map(page => ({ id: page.meta.id, key: page.meta.key, path: page.path, revision: page.meta.revision,
        status: page.meta.status, reviewReason: current.meta.id === document.meta.id ? null : 'older-source-reference' as const })) };
  });
  return { sourceUri, timeBasis: 'recorded-time-only' as const, offset, limit, total: filtered.length, items,
    notes: ['Recorded time is not fact-effective time or a historical reconstruction.',
      'An older source reference is a review suggestion, not proof that the page is wrong. Only currently authorized versions and references are shown.'] };
}
