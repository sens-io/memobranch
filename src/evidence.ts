import { AgentMemoryError } from './errors.js';
import type { EvidenceMeta, MarkdownDocument, Scope, Sensitivity } from './types.js';
import { scopes, sensitivities } from './types.js';
import { sha256 } from './utils.js';
import { assertPdfEvidence } from './pdf-evidence.js';
import { readWikiImportArtifact } from './wiki-import-artifact.js';

const EVIDENCE_HASH_DOMAIN = 'memobranch:evidence:v2';

export function evidenceDigest(scope: Scope, sensitivity: Sensitivity, sourceUri: string, content: string): string {
  assertSourceUri(sourceUri);
  return sha256(`${EVIDENCE_HASH_DOMAIN}\0${scope}\0${sensitivity}\0${sourceUri}\0${content}`);
}

export function legacyEvidenceDigest(scope: Scope, sourceUri: string, content: string): string {
  assertSourceUri(sourceUri);
  return sha256(`${scope}\0${sourceUri}\0${content}`);
}

export function pdfEvidenceDigest(scope: Scope, sensitivity: Sensitivity, sourceUri: string, content: string): string {
  return sha256(`memobranch:evidence:pdf:v1\0${evidenceDigest(scope, sensitivity, sourceUri, content)}`);
}
export function processedPdfEvidenceDigest(scope: Scope, sensitivity: Sensitivity, sourceUri: string, content: string): string {
  return sha256(`memobranch:evidence:processed-pdf:v1\0${evidenceDigest(scope, sensitivity, sourceUri, content)}`);
}
export function wikiImportEvidenceDigest(scope: Scope, sensitivity: Sensitivity, sourceUri: string, content: string): string {
  return sha256(`memobranch:evidence:compiled-wiki:v1\0${evidenceDigest(scope, sensitivity, sourceUri, content)}`);
}

function assertSourceUri(sourceUri: string): void {
  // Scope and sensitivity are enums. The remaining identity prefix must not
  // contain its delimiter; content itself may still contain arbitrary NULs.
  if (typeof sourceUri !== 'string' || sourceUri.includes('\0')) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Evidence source URI must be a string without NUL characters');
  }
}

export function evidenceDigestVersion(
  document: MarkdownDocument<Record<string, unknown>>,
  options: { allowLegacyEvidence?: boolean } = {},
): 1 | 2 | 3 | 4 | 5 {
  const { meta, body, path } = document;
  const id = typeof meta.id === 'string' ? meta.id : '';
  const scope = typeof meta.scope === 'string' && scopes.includes(meta.scope as Scope) ? meta.scope as Scope : null;
  const sensitivity = typeof meta.sensitivity === 'string' && sensitivities.includes(meta.sensitivity as Sensitivity)
    ? meta.sensitivity as Sensitivity
    : null;
  const prefix = `# Evidence ${id}\n\n`;
  if (
    meta.type !== 'evidence' || meta.immutable !== true || !id || !scope || !sensitivity || !body.startsWith(prefix) ||
    typeof meta.createdAt !== 'string' || Number.isNaN(Date.parse(meta.createdAt)) ||
    typeof meta.actor !== 'string' || !meta.actor.trim() ||
    (meta.sourceUri !== undefined && typeof meta.sourceUri !== 'string') ||
    typeof meta.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(meta.sha256) ||
    (meta.digestVersion !== undefined && meta.digestVersion !== 2 && meta.digestVersion !== 3 && meta.digestVersion !== 4 && meta.digestVersion !== 5) ||
    (meta.legacySha256 !== undefined && (typeof meta.legacySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(meta.legacySha256)))
  ) {
    throw new AgentMemoryError('VALIDATION_FAILED', `Invalid evidence schema: ${path}`);
  }
  const sourceUri = typeof meta.sourceUri === 'string' ? meta.sourceUri : '';
  const content = body.slice(prefix.length);
  const imported = readWikiImportArtifact(document as unknown as MarkdownDocument<EvidenceMeta>);
  if (meta.digestVersion === 4) {
    const digest = wikiImportEvidenceDigest(scope, sensitivity, sourceUri, content);
    if (!imported || meta.pdfOriginal !== undefined || meta.legacySha256 !== undefined || meta.sha256 !== digest || id !== `ev-${digest.slice(0,12)}`) {
      throw new AgentMemoryError('VALIDATION_FAILED', `Imported Wiki evidence identity validation failed: ${path}`);
    }
    return 4;
  }
  if (meta.digestVersion === 3 || meta.digestVersion === 5) {
    assertPdfEvidence(meta.pdfOriginal, content);
    const processed = meta.pdfOriginal.version === 2;
    const digest = (processed ? processedPdfEvidenceDigest : pdfEvidenceDigest)(scope, sensitivity, sourceUri, content);
    if (meta.digestVersion !== (processed ? 5 : 3) || meta.sha256 !== digest || id !== `ev-${digest.slice(0, 12)}` || meta.legacySha256 !== undefined) {
      throw new AgentMemoryError('VALIDATION_FAILED', `PDF evidence identity validation failed: ${path}`);
    }
    return processed ? 5 : 3;
  }
  if (meta.pdfOriginal !== undefined) throw new AgentMemoryError('VALIDATION_FAILED', `PDF original requires evidence digest version 3 or 5: ${path}`);
  const currentDigest = evidenceDigest(scope, sensitivity, sourceUri, content);
  if (meta.sha256 === currentDigest) {
    if (id === `ev-${currentDigest.slice(0, 12)}`) return 2;
    const legacyDigest = legacyEvidenceDigest(scope, sourceUri, content);
    if (meta.digestVersion === 2 && meta.legacySha256 === legacyDigest && id === `ev-${legacyDigest.slice(0, 12)}`) return 2;
    throw new AgentMemoryError('VALIDATION_FAILED', `Evidence identity validation failed: ${path}`);
  }
  const legacyDigest = legacyEvidenceDigest(scope, sourceUri, content);
  if (meta.sha256 === legacyDigest && id === `ev-${legacyDigest.slice(0, 12)}`) {
    if (options.allowLegacyEvidence) return 1;
    throw new AgentMemoryError('VALIDATION_FAILED', `Legacy evidence requires explicit migration: ${path}`);
  }
  throw new AgentMemoryError('VALIDATION_FAILED', `Evidence integrity validation failed: ${path}`);
}

export function assertEvidenceDocument(
  document: MarkdownDocument<Record<string, unknown>>,
  options: { allowLegacyEvidence?: boolean } = {},
): void {
  evidenceDigestVersion(document, options);
}

export function asEvidenceDocument(
  document: MarkdownDocument<Record<string, unknown>>,
  options: { allowLegacyEvidence?: boolean } = {},
): MarkdownDocument<EvidenceMeta> {
  assertEvidenceDocument(document, options);
  return document as unknown as MarkdownDocument<EvidenceMeta>;
}

/** Model-facing record reads keep extracted text, never the encoded source file. */
export function modelDocument<T extends object>(document: MarkdownDocument<T>): MarkdownDocument<Omit<T, 'pdfOriginal'>> {
  const { pdfOriginal: _original, ...meta } = document.meta as T & { pdfOriginal?: unknown };
  return { ...document, meta };
}
