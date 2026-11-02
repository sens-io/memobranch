import { z } from 'zod';
import { AgentMemoryError } from './errors.js';

export interface FactValidity {
  validFrom?: string;
  validUntil?: string;
}

export interface MemoryValidityUpdate {
  validFrom: string | null;
  validUntil: string | null;
  expectedRevision: number;
}

export interface MemoriesAtOptions {
  key?: string | undefined;
  includeUnknown?: boolean | undefined;
  includeSensitive?: boolean | undefined;
  includeSecret?: boolean | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export function effectiveTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || /\.\d{4,}/.test(value)
      || !z.iso.datetime({ offset: true }).safeParse(value).success || !Number.isFinite(Date.parse(value))) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Effective times require ISO timestamps with a timezone and at most millisecond precision');
  }
  return new Date(value).toISOString();
}

export function assertFactValidity(meta: { validFrom?: unknown; validUntil?: unknown }): void {
  const from = meta.validFrom === undefined ? undefined : effectiveTimestamp(meta.validFrom);
  const until = meta.validUntil === undefined ? undefined : effectiveTimestamp(meta.validUntil);
  if (from !== undefined && until !== undefined && Date.parse(from) >= Date.parse(until)) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'validFrom must be earlier than validUntil');
  }
}

/** Undefined bounds are unknown, never inferred from creation timestamps. */
export function factEffectiveAt(meta: FactValidity, at = Date.now()): boolean {
  return (meta.validFrom === undefined || Date.parse(meta.validFrom) <= at)
    && (meta.validUntil === undefined || Date.parse(meta.validUntil) > at);
}

export function factValidityFields(meta: FactValidity): FactValidity {
  return { ...(meta.validFrom === undefined ? {} : { validFrom: meta.validFrom }),
    ...(meta.validUntil === undefined ? {} : { validUntil: meta.validUntil }) };
}

export function factValidityConditions(meta: FactValidity): string[] {
  return [ ...(meta.validFrom === undefined ? [] : [`Fact effective from ${meta.validFrom} (inclusive).`]),
    ...(meta.validUntil === undefined ? [] : [`Fact effective until ${meta.validUntil} (exclusive).`]) ];
}
