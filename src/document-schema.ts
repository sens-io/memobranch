import { AgentMemoryError } from './errors.js';
import { assertEvidenceDocument } from './evidence.js';
import { memoryKinds, scopes, sensitivities, type MarkdownDocument } from './types.js';

const candidateStatuses = ['pending', 'promoted', 'rejected'] as const;
const memoryStatuses = ['active', 'conflicted', 'superseded', 'revoked'] as const;

export function assertManagedDocument(document: MarkdownDocument<Record<string, unknown>>, options: { allowLegacyEvidence?: boolean } = {}): void {
  if (document.path.startsWith('evidence/')) {
    assertEvidenceDocument(document, options);
    return;
  }
  if (document.path.startsWith('candidates/')) {
    assertCandidateDocument(document);
    return;
  }
  if (document.path.startsWith('wiki/')) {
    if (document.meta.type === 'memory') assertMemoryDocument(document);
    else if (document.meta.type === 'memory-erased') assertErasedMemoryDocument(document);
    else fail(document.path, 'unknown Wiki document type');
  }
}

function assertCandidateDocument(document: MarkdownDocument<Record<string, unknown>>): void {
  const { meta, path } = document;
  requiredString(meta, 'id', path);
  literal(meta, 'type', 'memory-candidate', path);
  isoDate(meta, 'createdAt', path);
  isoDate(meta, 'updatedAt', path);
  oneOf(meta, 'kind', memoryKinds, path);
  requiredString(meta, 'key', path);
  oneOf(meta, 'scope', scopes, path);
  oneOf(meta, 'sensitivity', sensitivities, path);
  boundedNumber(meta, 'confidence', 0, 1, path);
  boolean(meta, 'explicit', path);
  oneOf(meta, 'status', candidateStatuses, path);
  stringArray(meta, 'evidence', path);
  stringArray(meta, 'conditions', path);
  stringArray(meta, 'tags', path);
  stringArray(meta, 'conflictsWith', path);
  optionalIsoDate(meta, 'expiresAt', path);
  optionalString(meta, 'rejectionReason', path);
  optionalString(meta, 'promotedTo', path);
  if (meta.status === 'promoted' && typeof meta.promotedTo !== 'string') fail(path, 'promoted candidate is missing promotedTo');
  if (meta.status === 'rejected' && typeof meta.rejectionReason !== 'string') fail(path, 'rejected candidate is missing rejectionReason');
  nonEmptyBody(document);
}

function assertMemoryDocument(document: MarkdownDocument<Record<string, unknown>>): void {
  const { meta, path } = document;
  requiredString(meta, 'id', path);
  literal(meta, 'type', 'memory', path);
  isoDate(meta, 'createdAt', path);
  isoDate(meta, 'updatedAt', path);
  isoDate(meta, 'validatedAt', path);
  oneOf(meta, 'kind', memoryKinds, path);
  requiredString(meta, 'key', path);
  oneOf(meta, 'scope', scopes, path);
  oneOf(meta, 'sensitivity', sensitivities, path);
  boundedNumber(meta, 'confidence', 0, 1, path);
  oneOf(meta, 'status', memoryStatuses, path);
  stringArray(meta, 'evidence', path);
  stringArray(meta, 'conditions', path);
  stringArray(meta, 'tags', path);
  positiveInteger(meta, 'revision', path);
  optionalIsoDate(meta, 'expiresAt', path);
  optionalStringArray(meta, 'supersedes', path);
  optionalString(meta, 'supersededBy', path);
  optionalIsoDate(meta, 'revokedAt', path);
  optionalString(meta, 'revocationReason', path);
  if (meta.status === 'superseded' && typeof meta.supersededBy !== 'string') fail(path, 'superseded memory is missing supersededBy');
  if (meta.status === 'revoked' && (typeof meta.revokedAt !== 'string' || typeof meta.revocationReason !== 'string')) {
    fail(path, 'revoked memory is missing revocation metadata');
  }
  nonEmptyBody(document);
}

function assertErasedMemoryDocument(document: MarkdownDocument<Record<string, unknown>>): void {
  const { meta, path } = document;
  requiredString(meta, 'id', path);
  literal(meta, 'type', 'memory-erased', path);
  oneOf(meta, 'scope', scopes, path);
  literal(meta, 'sensitivity', 'internal', path);
  literal(meta, 'status', 'revoked', path);
  isoDate(meta, 'createdAt', path);
  isoDate(meta, 'updatedAt', path);
  isoDate(meta, 'erasedAt', path);
  boolean(meta, 'reasonRecorded', path);
  optionalDigest(meta, 'reasonSha256', path);
  if (meta.reasonRecorded === true && typeof meta.reasonSha256 !== 'string') fail(path, 'erasure tombstone is missing reasonSha256');
  if (meta.reasonRecorded === false && meta.reasonSha256 !== undefined) fail(path, 'erasure tombstone has an unexpected reasonSha256');
  nonEmptyBody(document);
}

function requiredString(meta: Record<string, unknown>, key: string, path: string): void {
  if (typeof meta[key] !== 'string' || !(meta[key] as string).trim()) fail(path, `${key} must be a non-empty string`);
}

function optionalString(meta: Record<string, unknown>, key: string, path: string): void {
  if (meta[key] !== undefined && (typeof meta[key] !== 'string' || !(meta[key] as string).trim())) fail(path, `${key} must be a non-empty string`);
}

function literal(meta: Record<string, unknown>, key: string, expected: string, path: string): void {
  if (meta[key] !== expected) fail(path, `${key} must be ${expected}`);
}

function oneOf(meta: Record<string, unknown>, key: string, expected: readonly string[], path: string): void {
  if (typeof meta[key] !== 'string' || !expected.includes(meta[key] as never)) fail(path, `${key} is invalid`);
}

function isoDate(meta: Record<string, unknown>, key: string, path: string): void {
  if (typeof meta[key] !== 'string' || Number.isNaN(Date.parse(meta[key] as string))) fail(path, `${key} must be an ISO date`);
}

function optionalIsoDate(meta: Record<string, unknown>, key: string, path: string): void {
  if (meta[key] !== undefined) isoDate(meta, key, path);
}

function boundedNumber(meta: Record<string, unknown>, key: string, minimum: number, maximum: number, path: string): void {
  const value = meta[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(path, `${key} must be between ${minimum} and ${maximum}`);
}

function positiveInteger(meta: Record<string, unknown>, key: string, path: string): void {
  const value = meta[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) fail(path, `${key} must be a positive integer`);
}

function boolean(meta: Record<string, unknown>, key: string, path: string): void {
  if (typeof meta[key] !== 'boolean') fail(path, `${key} must be boolean`);
}

function stringArray(meta: Record<string, unknown>, key: string, path: string): void {
  if (!Array.isArray(meta[key]) || (meta[key] as unknown[]).some((value) => typeof value !== 'string')) fail(path, `${key} must be a string array`);
}

function optionalStringArray(meta: Record<string, unknown>, key: string, path: string): void {
  if (meta[key] !== undefined) stringArray(meta, key, path);
}

function optionalDigest(meta: Record<string, unknown>, key: string, path: string): void {
  if (meta[key] !== undefined && (typeof meta[key] !== 'string' || !/^[a-f0-9]{64}$/.test(meta[key] as string))) fail(path, `${key} must be a SHA-256 digest`);
}

function nonEmptyBody(document: MarkdownDocument<Record<string, unknown>>): void {
  if (!document.body.trim()) fail(document.path, 'body must not be empty');
}

function fail(path: string, reason: string): never {
  throw new AgentMemoryError('VALIDATION_FAILED', `Invalid managed document schema: ${path}`, { reason });
}
