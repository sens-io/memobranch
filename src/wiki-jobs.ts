import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { EncryptionManager } from './encryption.js';
import { AgentMemoryError, toAgentMemoryError, errorCodes } from './errors.js';
import { authorize, type Principal } from './policy.js';
import { scopes, sensitivities, type VaultConfig } from './types.js';
import { cancellationError, combineSignals, operationSignal, throwIfCancelled, withoutCancellation, withOperation } from './operation.js';
import { WikiJobStore, wikiJobIdSchema } from './wiki-job-store.js';
import { wikiPlanSchema } from './wiki-schema.js';
import type { WikiPlan, WikiPreview } from './wiki-types.js';
import { nowIso } from './utils.js';

const evidenceIds = z.array(z.string().regex(/^ev-[a-f0-9]{12,64}$/)).min(1).max(40).refine(ids => new Set(ids).size === ids.length);
const ceilingSchema = z.object({ scopes: z.array(z.enum(scopes)).min(1).max(4), maxSensitivity: z.enum(sensitivities) }).strict();
export type WikiJobCeiling = z.infer<typeof ceilingSchema>;
const status = z.enum(['queued', 'running', 'ready', 'duplicate', 'failed', 'cancelled']);
const stage = z.enum(['queued', 'compiling', 'validating', 'finished']);
const date = z.string().datetime({ offset: true });
const jobSchema = z.object({ version: z.literal(1), id: wikiJobIdSchema, vaultId: z.string().min(1).max(200), tenantId: z.string().min(1).max(200),
  ownerId: z.string().min(1).max(200), ceiling: ceilingSchema, evidenceIds, maxPages: z.number().int().min(1).max(40),
  status, stage, attempts: z.number().int().min(0).max(3), createdAt: date, updatedAt: date, startedAt: date.nullable(),
  finishedAt: date.nullable(), cancelRequested: z.boolean(), claim: z.object({ token: z.string().uuid(), pid: z.number().int().positive() }).strict().nullable(),
  error: z.object({ code: z.enum(errorCodes), reason: z.enum(['compilation-failed', 'worker-interrupted', 'context-erased', 'deadline', 'cancelled']) }).strict().nullable(),
  plan: wikiPlanSchema.nullable(),
}).strict();
type Job = z.infer<typeof jobSchema>;
export interface WikiJobStatus {
  id: string; status: Job['status']; stage: Job['stage']; attempts: number; createdAt: string; updatedAt: string;
  startedAt: string | null; finishedAt: string | null; cancelRequested: boolean; error: Job['error'];
}
export interface WikiJobInput { evidenceIds: string[]; maxPages?: number }
export interface WikiJobRunOptions { id?: string; signal?: AbortSignal; timeoutMs?: number }
interface Port {
  root: string; principal: Principal; encryption: EncryptionManager;
  config(): Promise<VaultConfig>;
  locked<T>(action: () => Promise<T>): Promise<T>;
  evidence(ids: string[], ceiling: WikiJobCeiling): Promise<void>;
  compile(input: WikiJobInput, ceiling: WikiJobCeiling): Promise<{ duplicate: boolean; plan: WikiPlan | null }>;
  preview(plan: WikiPlan, ceiling: WikiJobCeiling): Promise<WikiPreview>;
  apply(plan: WikiPlan, ceiling: WikiJobCeiling): Promise<{ pageIds: string[]; commit: string | null }>;
}

/** Explicit local worker; never applies a proposal or starts a background service. */
export class WikiJobs {
  private readonly store: WikiJobStore;
  constructor(private readonly port: Port) { this.store = new WikiJobStore(port.root, port.encryption); }

  private async authorize(write: boolean): Promise<VaultConfig> {
    const config = await this.port.config();
    authorize(this.port.principal, 'read', { tenantId: config.tenantId });
    if (write) authorize(this.port.principal, 'write', { tenantId: config.tenantId });
    if (!this.port.encryption.available) throw new AgentMemoryError('ENCRYPTION_KEY_UNAVAILABLE', 'Wiki jobs require AMEM_MASTER_KEY, including public-input jobs');
    return config;
  }

  private async owned(id: string, cover = true): Promise<Job> {
    const config = await this.authorize(false);
    if (!wikiJobIdSchema.safeParse(id).success) throw invalid();
    // Interrupted removal/key rotation cannot expose plaintext or poison other jobs.
    if (!await this.port.encryption.hasKey(id)) throw missing();
    const job = checkedJob(await this.store.read(id));
    if (job.id !== id || job.vaultId !== config.vaultId || job.tenantId !== config.tenantId || job.ownerId !== this.port.principal.id) throw missing();
    if (cover) this.cover(job.ceiling);
    return job;
  }

  private cover(ceiling: WikiJobCeiling): void {
    for (const scope of ceiling.scopes) authorize(this.port.principal, 'read', { scope, sensitivity: ceiling.maxSensitivity });
  }

  async enqueue(input: WikiJobInput): Promise<WikiJobStatus> {
    await this.authorize(true);
    const validation = z.object({ evidenceIds, maxPages: z.number().int().min(1).max(40).optional() }).strict().safeParse(input);
    if (!validation.success) throw invalid();
    const parsed = validation.data;
    return this.port.locked(async () => {
      const config = await this.authorize(true);
      if ((await this.store.ids()).length >= 100) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Remove completed Wiki jobs before enqueueing more');
      const ceiling = ceilingSchema.parse({ scopes: [...new Set(this.port.principal.scopes)], maxSensitivity: this.port.principal.maxSensitivity });
      await this.port.evidence(parsed.evidenceIds, ceiling);
      const timestamp = nowIso();
      const job: Job = { version: 1, id: `wj-${randomUUID().replaceAll('-', '')}`, vaultId: config.vaultId, tenantId: config.tenantId,
        ownerId: this.port.principal.id, ceiling, evidenceIds: [...parsed.evidenceIds].sort(), maxPages: parsed.maxPages ?? 20,
        status: 'queued', stage: 'queued', attempts: 0, createdAt: timestamp, updatedAt: timestamp, startedAt: null, finishedAt: null,
        cancelRequested: false, claim: null, error: null, plan: null };
      await this.store.write(job); return view(job);
    });
  }

  async list(): Promise<WikiJobStatus[]> {
    await this.authorize(false);
    return this.port.locked(async () => {
      const jobs: WikiJobStatus[] = [];
      for (const id of await this.store.ids()) {
        try { jobs.push(view(await this.owned(id))); }
        catch (error) { if (!(error instanceof AgentMemoryError) || !['NOT_FOUND', 'AUTHORIZATION_DENIED'].includes(error.code)) throw error; }
      }
      return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
  }

  async get(id: string): Promise<WikiJobStatus> {
    await this.authorize(false);
    return this.port.locked(async () => view(await this.owned(id)));
  }

  async plan(id: string): Promise<WikiPlan> {
    await this.authorize(false);
    return this.port.locked(async () => {
      const job = await this.owned(id);
      if (job.status !== 'ready' || !job.plan) throw invalid();
      await this.port.preview(job.plan, job.ceiling);
      return job.plan;
    });
  }

  async preview(id: string): Promise<WikiPreview> {
    await this.authorize(false);
    return this.port.locked(async () => {
      const job = await this.owned(id);
      if (job.status !== 'ready' || !job.plan) throw invalid();
      return this.port.preview(job.plan, job.ceiling);
    });
  }

  async apply(id: string): Promise<{ pageIds: string[]; commit: string | null }> {
    await this.authorize(false);
    authorize(this.port.principal, 'review');
    const selected = await this.port.locked(async () => {
      const job = await this.owned(id);
      if (job.status !== 'ready' || !job.plan) throw invalid();
      await this.port.preview(job.plan, job.ceiling);
      return { plan: job.plan, ceiling: job.ceiling };
    });
    // Do not nest a canonical mutation inside the runtime writer lock. Existing
    // wikiApply revalidates permissions and the snapshot under its own lock.
    return this.port.apply(selected.plan, selected.ceiling);
  }

  async cancel(id: string): Promise<WikiJobStatus> {
    await this.authorize(true);
    return this.port.locked(() => withoutCancellation(async () => {
      await this.authorize(true);
      const job = await this.owned(id, false);
      if (job.status === 'cancelled') return view(job);
      job.cancelRequested = true;
      if (job.status !== 'running' || !live(job.claim?.pid)) {
        // Remove old ciphertext before creating a replacement key. Otherwise a
        // crash after key creation could leave old ciphertext with a new key.
        if (job.plan) await this.store.remove(job.id);
        finish(job, 'cancelled', { code: 'OPERATION_CANCELLED', reason: 'cancelled' });
      }
      job.updatedAt = nowIso(); await this.store.write(job); return view(job);
    }));
  }

  async retry(id: string): Promise<WikiJobStatus> {
    await this.authorize(true);
    return this.port.locked(async () => {
      await this.authorize(true);
      const job = await this.owned(id);
      if (!['failed', 'cancelled'].includes(job.status) || job.attempts >= 3) throw invalid();
      await this.port.evidence(job.evidenceIds, job.ceiling);
      job.status = 'queued'; job.stage = 'queued'; job.updatedAt = nowIso(); job.finishedAt = null; job.claim = null;
      job.cancelRequested = false; job.error = null; job.plan = null;
      await this.store.write(job); return view(job);
    });
  }

  async remove(id: string): Promise<{ removed: true }> {
    await this.authorize(true);
    return this.port.locked(() => withoutCancellation(async () => {
      await this.authorize(true);
      if (!wikiJobIdSchema.safeParse(id).success) throw invalid();
      if (!await this.port.encryption.hasKey(id)) {
        // No owner identity remains decryptable; only an administrator may clean this orphan.
        authorize(this.port.principal, 'admin');
        await this.store.remove(id); return { removed: true };
      }
      const job = await this.owned(id, false);
      if (job.status === 'running' && live(job.claim?.pid)) throw new AgentMemoryError('LOCK_TIMEOUT', 'Cancel the active Wiki job and wait for its worker before removing it');
      await this.store.remove(id); return { removed: true };
    }));
  }

  async run(options: WikiJobRunOptions = {}): Promise<WikiJobStatus | null> {
    await this.authorize(true);
    const timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 || options.id !== undefined && !wikiJobIdSchema.safeParse(options.id).success) throw invalid();
    const parents = [operationSignal(), options.signal].filter((signal): signal is AbortSignal => Boolean(signal));
    const controller = new AbortController();
    const combined = combineSignals([...parents, controller.signal]);
    let job: Job | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let monitoring: Promise<void> | null = null; let monitorError: unknown; let timedOut = false;
    try {
      return await withOperation(combined.signal, async () => {
        job = await this.claim(options.id);
        if (!job) return null;
        if (job.status !== 'running') return view(job);
        const active = job;
        const token = active.claim!.token;
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        const poll = async () => {
          if (controller.signal.aborted) return;
          try {
            await this.port.locked(async () => {
              const current = await this.owned(active.id);
              if (current.claim?.token !== token || current.cancelRequested) controller.abort();
            });
          } catch (error) { monitorError = error; controller.abort(); }
        };
        const interval = setInterval(() => { if (!monitoring) monitoring = poll().finally(() => { monitoring = null; }); }, 100);
        let result: Awaited<ReturnType<Port['compile']>> | null = null;
        let failure: unknown;
        try {
          result = await this.port.compile({ evidenceIds: active.evidenceIds, maxPages: active.maxPages }, active.ceiling);
          throwIfCancelled();
          await this.port.locked(async () => {
            const current = await this.owned(active.id);
            if (current.claim?.token !== token || current.cancelRequested) throw cancellationError();
            current.stage = 'validating'; current.updatedAt = nowIso(); await this.store.write(current);
          });
        } catch (error) { failure = error; }
        finally { clearInterval(interval); await monitoring; }
        return await withoutCancellation(() => this.port.locked(async () => {
          const current = await this.owned(active.id, false);
          if (current.claim?.token !== token) return view(current);
          // Cancellation remains authoritative even if it arrived after model completion.
          if (current.cancelRequested || parents.some(signal => signal.aborted)) {
            finish(current, 'cancelled', { code: 'OPERATION_CANCELLED', reason: 'cancelled' });
          } else if (timedOut || failure || monitorError) {
            const code = timedOut ? 'DEPENDENCY_UNAVAILABLE' : toAgentMemoryError(monitorError ?? failure).code;
            finish(current, 'failed', { code, reason: timedOut ? 'deadline' : 'compilation-failed' });
          } else {
            try {
              await this.authorize(true);
              this.cover(current.ceiling);
              if (result?.plan) await this.port.preview(result.plan, current.ceiling);
              if (parents.some(signal => signal.aborted)) finish(current, 'cancelled', { code: 'OPERATION_CANCELLED', reason: 'cancelled' });
              else if (timedOut) finish(current, 'failed', { code: 'DEPENDENCY_UNAVAILABLE', reason: 'deadline' });
              else {
                finish(current, result?.duplicate ? 'duplicate' : 'ready', null);
                current.plan = result?.plan ?? null;
                if (current.status === 'ready' && !current.plan) throw invalid();
              }
            } catch (error) { finish(current, 'failed', { code: toAgentMemoryError(error).code, reason: 'compilation-failed' }); }
          }
          try { await this.store.write(current); }
          catch (error) {
            finish(current, 'failed', { code: toAgentMemoryError(error).code, reason: 'compilation-failed' });
            await this.store.write(current);
          }
          if (['ready', 'duplicate'].includes(current.status) && (parents.some(signal => signal.aborted) || timedOut)) {
            // A stop can arrive while encryption/fsync/rename is awaiting I/O.
            // Readers cannot enter until this same writer lock settles it.
            if (current.plan) await this.store.remove(current.id);
            finish(current, timedOut && !parents.some(signal => signal.aborted) ? 'failed' : 'cancelled',
              timedOut && !parents.some(signal => signal.aborted) ? { code: 'DEPENDENCY_UNAVAILABLE', reason: 'deadline' }
                : { code: 'OPERATION_CANCELLED', reason: 'cancelled' });
            await this.store.write(current);
          }
          return view(current);
        }));
      });
    } finally { if (timer) clearTimeout(timer); combined.dispose(); }
  }

  private async claim(id?: string): Promise<Job | null> {
    return this.port.locked(async () => {
      await this.authorize(true);
      const jobs: Job[] = [];
      for (const candidate of await this.store.ids()) {
        let job;
        try { job = await this.owned(candidate, false); } catch (error) { if (error instanceof AgentMemoryError && error.code === 'NOT_FOUND') continue; throw error; }
        if (job.status === 'running' && !live(job.claim?.pid)) {
          finish(job, job.cancelRequested ? 'cancelled' : 'failed', { code: job.cancelRequested ? 'OPERATION_CANCELLED' : 'DEPENDENCY_UNAVAILABLE', reason: 'worker-interrupted' });
          await this.store.write(job);
        }
        // Claim selection needs metadata, not every retained multi-megabyte plan.
        jobs.push({ ...job, plan: null });
      }
      const eligible = jobs.filter(job => {
        if (job.status !== 'queued') return false;
        try { this.cover(job.ceiling); return true; }
        catch (error) { if (error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED') return false; throw error; }
      });
      const target = id ? jobs.find(job => job.id === id) : eligible.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
      if (id && !target) throw missing();
      if (!target || target.status !== 'queued') return null;
      if (jobs.some(job => job.status === 'running')) return null;
      this.cover(target.ceiling);
      try {
        await this.port.evidence(target.evidenceIds, target.ceiling);
      } catch (error) {
        finish(target, 'failed', { code: toAgentMemoryError(error).code, reason: 'compilation-failed' });
        await this.store.write(target); return target;
      }
      target.status = 'running'; target.stage = 'compiling'; target.attempts++; target.startedAt = nowIso(); target.updatedAt = target.startedAt;
      target.claim = { token: randomUUID(), pid: process.pid }; target.finishedAt = null; target.error = null; target.plan = null;
      await this.store.write(target); return target;
    });
  }
}

/** Called only under the vault writer lock as part of recoverable canonical erasure. */
export async function invalidateWikiJobPlans(root: string, encryption: EncryptionManager): Promise<void> {
  const store = new WikiJobStore(root, encryption);
  for (const id of await store.ids()) {
    // A prior erasure may have destroyed this key before publishing content-free state.
    if (!await encryption.hasKey(id)) { await store.remove(id); continue; }
    const job = checkedJob(await store.read(id));
    if (!job.plan && job.status !== 'running') continue;
    // Once the old key is gone, unlink its ciphertext before any new key can
    // become durable. Interrupted replacement then leaves either an unreadable
    // old cache (handled above) or no file, never old ciphertext under a new key.
    await store.remove(id);
    finish(job, 'failed', { code: 'VALIDATION_FAILED', reason: 'context-erased' });
    await store.write(job);
  }
}

function view(job: Job): WikiJobStatus {
  return { id: job.id, status: job.status, stage: job.stage, attempts: job.attempts, createdAt: job.createdAt, updatedAt: job.updatedAt,
    startedAt: job.startedAt, finishedAt: job.finishedAt, cancelRequested: job.cancelRequested, error: job.error };
}
function checkedJob(value: unknown): Job {
  const parsed = jobSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
function finish(job: Job, state: Job['status'], error: Job['error']) {
  job.status = state; job.stage = 'finished'; job.claim = null; job.plan = null; job.error = error;
  job.updatedAt = nowIso(); job.finishedAt = job.updatedAt;
}
function live(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
function invalid() { return new AgentMemoryError('VALIDATION_FAILED', 'Wiki job input or state is invalid'); }
function missing() { return new AgentMemoryError('NOT_FOUND', 'Wiki job is unavailable'); }
