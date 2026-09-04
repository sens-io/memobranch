import { AgentMemoryError } from './errors.js';
import type { EvidenceMeta, MarkdownDocument, Scope, Sensitivity } from './types.js';
import { scopes, sensitivities } from './types.js';
import { sha256 } from './utils.js';

const EVIDENCE_HASH_DOMAIN = 'memobranch:evidence:v2';

export function evidenceDigest(scope: Scope, sensitivity: Sensitivity, sourceUri: string, content: string): string {
  return sha256(`${EVIDENCE_HASH_DOMAIN}\0${scope}\0${sensitivity}\0${sourceUri}\0${content}`);
}

export function legacyEvidenceDigest(scope: Scope, sourceUri: string, content: string): string {
  return sha256(`${scope}\0${sourceUri}\0${content}`);
}

export function evidenceDigestVersion(
  document: MarkdownDocument<Record<string, unknown>>,
  options: { allowLegacyEvidence?: boolean } = {},
): 1 | 2 {
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
    (meta.digestVersion !== undefined && meta.digestVersion !== 2) ||
    (meta.legacySha256 !== undefined && (typeof meta.legacySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(meta.legacySha256)))
  ) {
    throw new AgentMemoryError('VALIDATION_FAILED', `Invalid evidence schema: ${path}`);
  }
  const sourceUri = typeof meta.sourceUri === 'string' ? meta.sourceUri : '';
  const content = body.slice(prefix.length);
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
