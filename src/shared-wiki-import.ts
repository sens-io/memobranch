import { z } from 'zod';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { cancellationError, combineSignals, operationSignal, throwIfCancelled, withOperation } from './operation.js';
import { authorize } from './policy.js';
import { SharedWikiReader, sharedWikiSnapshotSchema, type SharedWikiReaderOptions } from './shared-wiki.js';
import { scopes, sensitivities } from './types.js';
import { MemoryVault } from './vault.js';
import { WikiProof, stableWikiJson } from './wiki-proof.js';
import { assertWikiImportTime, wikiImportArtifact, wikiImportArtifactSchema, wikiImportContent, wikiImportRestrictions, wikiImportUri } from './wiki-import-artifact.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/), identity = z.string().min(1).max(200);
const selectionSchema = sharedWikiSnapshotSchema.required({ expectedCommit: true });
export const sharedWikiImportPrepareSchema = selectionSchema.extend({ scope: z.enum(scopes).optional(), sensitivity: z.enum(sensitivities).optional() }).strict();
const planBody = z.object({ version: z.literal(1), kind: z.literal('shared-wiki-import-plan'), vaultId: identity, tenantId: identity, configHash: hash,
  selection: selectionSchema, artifact: wikiImportArtifactSchema, scope: z.enum(scopes), sensitivity: z.enum(sensitivities) }).strict();
export const sharedWikiImportPlanSchema = planBody.extend({ proof: hash }).strict();
export const sharedWikiImportApplySchema = z.object({ plan: sharedWikiImportPlanSchema, confirm: z.literal(true) }).strict();
export type SharedWikiImportPlan = z.infer<typeof sharedWikiImportPlanSchema>;
export type SharedWikiImportPrepareOptions = z.input<typeof sharedWikiImportPrepareSchema> & { signal?: AbortSignal | undefined };

/** Explicit copy workflow. A read-only SharedWikiReader never silently becomes a writer. */
export class SharedWikiImporter {
  private readonly reader: SharedWikiReader;
  private readonly proof: WikiProof;
  constructor(private readonly caller: MemoryVault, options: SharedWikiReaderOptions) {
    this.reader = new SharedWikiReader(caller, options); this.proof = new WikiProof(caller.root);
  }

  async prepare(options: SharedWikiImportPrepareOptions): Promise<{ plan: SharedWikiImportPlan }> {
    const parsed = sharedWikiImportPrepareSchema.extend({ signal: z.instanceof(AbortSignal).optional() }).strict().safeParse(options);
    if (!parsed.success) invalid(); const { signal, ...input } = parsed.data;
    return scoped(signal, async () => {
      authorize(this.caller.principal, 'read'); authorize(this.caller.principal, 'write');
      const { scope: requestedScope, sensitivity: requestedSensitivity, ...selection } = input;
      const retained = await this.reader.snapshotWithValidation(selection), artifact = wikiImportArtifact(retained.view, retained.support), boundary = wikiImportRestrictions(artifact);
      const scope = requestedScope ?? boundary.scope, sensitivity = requestedSensitivity ?? boundary.sensitivity;
      const payload = { version: 1 as const, kind: 'shared-wiki-import-plan' as const,
        vaultId: retained.destination.vaultId, tenantId: retained.destination.tenantId, configHash: retained.destination.configHash, selection, artifact, scope, sensitivity };
      this.authorize(payload, false); this.classify(payload); assertWikiImportTime(boundary);
      const content = wikiImportContent(artifact);
      if (content.length > retained.destination.maxContentCharacters) tooLarge();
      bounded({ ...payload, proof: '0'.repeat(64) });
      const proof = await this.proof.sign(attestation(payload, retained.attestationContext));
      await retained.validateConfiguration(); retained.validate(); this.authorize(payload, false); assertWikiImportTime(boundary);
      return { plan: { ...payload, proof } };
    });
  }

  async apply(value: unknown, options: { confirm: true; signal?: AbortSignal | undefined }) {
    const parsed = z.object({ confirm: z.literal(true), signal: z.instanceof(AbortSignal).optional() }).strict().safeParse(options);
    if (!parsed.success) invalid(); const input = parsed.data;
    const plan = parse(sharedWikiImportPlanSchema, value);
    return scoped(input.signal, async () => {
      this.authorize(plan, true); this.classify(plan);
      const retained = await this.reader.snapshotWithValidation(plan.selection), artifact = wikiImportArtifact(retained.view, retained.support);
      const { proof, ...payload } = plan;
      await this.proof.verify(attestation(payload, retained.attestationContext), proof);
      if (plan.vaultId !== retained.destination.vaultId || plan.tenantId !== retained.destination.tenantId || plan.configHash !== retained.destination.configHash
        || stableWikiJson(artifact) !== stableWikiJson(plan.artifact)) invalid();
      const content = wikiImportContent(artifact), boundary = wikiImportRestrictions(artifact);
      const validate = () => { retained.validate(); this.authorize(plan, true); assertWikiImportTime(boundary); };
      validate();
      const result = await this.caller.captureWikiImport({ content, sourceUri: wikiImportUri(artifact), scope: plan.scope, sensitivity: plan.sensitivity }, {
        revalidate: async () => { await retained.validateConfiguration(); validate(); }, validate,
      });
      try { validate(); }
      catch (cause) {
        const error = toAgentMemoryError(cause);
        throw new AgentMemoryError(error.code, error.message, { ...error.safeDetails,
          completedImport: { evidenceId: result.evidenceId, commit: result.commit, duplicate: result.duplicate } }, error.exitCode);
      }
      return result;
    });
  }

  private authorize(plan: z.infer<typeof planBody>, review: boolean) {
    for (const permission of review ? ['read', 'write', 'review'] as const : ['read', 'write'] as const) {
      authorize(this.caller.principal, permission, { tenantId: plan.tenantId, scope: plan.scope, sensitivity: plan.sensitivity });
    }
  }
  private classify(plan: z.infer<typeof planBody>) {
    const boundary = wikiImportRestrictions(plan.artifact);
    if (scopes.indexOf(plan.scope) > scopes.indexOf(boundary.scope) || sensitivities.indexOf(plan.sensitivity) < sensitivities.indexOf(boundary.sensitivity)) invalid();
  }
}
function attestation(payload: object, context: string) { return { domain: 'memobranch:shared-wiki-import:v1', context, payload }; }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  bounded(value); const result = schema.safeParse(JSON.parse(stableWikiJson(value))); if (!result.success) invalid(); return result.data;
}
function bounded(value: unknown) { if (Buffer.byteLength(stableWikiJson(value), 'utf8') > 1_000_000) tooLarge(); }
function invalid(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Wiki import plan, source or destination changed; prepare again'); }
function tooLarge(): never { throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete Wiki import plan or artifact exceeds its byte/content limit'); }
async function scoped<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  if (signal !== undefined && !(signal instanceof AbortSignal)) invalid();
  throwIfCancelled(); if (signal?.aborted) throw cancellationError(); if (!signal) return action();
  const parent = operationSignal(), combined = combineSignals(parent ? [parent, signal] : [signal]);
  try { return await withOperation(combined.signal, action); } finally { combined.dispose(); }
}
