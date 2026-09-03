import { AgentMemoryError } from './errors.js';
import type { EvidenceMeta, MarkdownDocument, Scope, Sensitivity } from './types.js';
import { scopes, sensitivities } from './types.js';
import { sha256 } from './utils.js';

const EVIDENCE_HASH_DOMAIN = 'memobranch:evidence:v2';

export function evidenceDigest(scope: Scope, sensitivity: Sensitivity, sourceUri: string, content: string): string {
  return sha256(`${EVIDENCE_HASH_DOMAIN}\0${scope}\0${sensitivity}\0${sourceUri}\0${content}`);
}

export function assertEvidenceDocument(document: MarkdownDocument<Record<string, unknown>>): void {
  const { meta, body, path } = document;
  const id = typeof meta.id === 'string' ? meta.id : '';
  const scope = typeof meta.scope === 'string' && scopes.includes(meta.scope as Scope) ? meta.scope as Scope : null;
  const sensitivity = typeof meta.sensitivity === 'string' && sensitivities.includes(meta.sensitivity as Sensitivity)
    ? meta.sensitivity as Sensitivity
    : null;
  const prefix = `# Evidence ${id}\n\n`;
  if (meta.type !== 'evidence' || meta.immutable !== true || !id || !scope || !sensitivity || !body.startsWith(prefix)) {
    throw new AgentMemoryError('VALIDATION_FAILED', `Invalid evidence schema: ${path}`);
  }
  const sourceUri = typeof meta.sourceUri === 'string' ? meta.sourceUri : '';
  const digest = evidenceDigest(scope, sensitivity, sourceUri, body.slice(prefix.length));
  if (meta.sha256 !== digest || id !== `ev-${digest.slice(0, 12)}`) {
    throw new AgentMemoryError('VALIDATION_FAILED', `Evidence integrity validation failed: ${path}`);
  }
}

export function asEvidenceDocument(document: MarkdownDocument<Record<string, unknown>>): MarkdownDocument<EvidenceMeta> {
  assertEvidenceDocument(document);
  return document as unknown as MarkdownDocument<EvidenceMeta>;
}
