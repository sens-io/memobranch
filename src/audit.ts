import { existsSync } from 'node:fs';
import { readFile, stat, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { redactSecrets } from './errors.js';
import type { Principal } from './policy.js';
import { appendText, nowIso, writeText } from './utils.js';

const MAX_AUDIT_BYTES = 10 * 1024 * 1024;
const MAX_METRICS = 64;

interface MetricsState {
  version: 1;
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

export interface AuditEvent {
  operation: string;
  outcome: 'success' | 'denied' | 'error';
  principalId: string;
  tenantId?: string;
  resourceIds?: string[];
  errorCode?: string;
  durationMs?: number;
}

export class OperationsTelemetry {
  readonly auditPath: string;
  readonly metricsPath: string;

  constructor(readonly root: string) {
    this.auditPath = join(root, '.amem', 'audit.jsonl');
    this.metricsPath = join(root, '.amem', 'metrics.json');
  }

  async record(event: AuditEvent): Promise<void> {
    await this.rotateAuditIfNeeded();
    const safe: AuditEvent & { timestamp: string } = {
      timestamp: nowIso(),
      operation: clean(event.operation, 64),
      outcome: event.outcome,
      principalId: clean(event.principalId, 128),
      ...(event.tenantId ? { tenantId: clean(event.tenantId, 128) } : {}),
      ...(event.resourceIds ? { resourceIds: event.resourceIds.slice(0, 50).map((id) => clean(id, 160)) } : {}),
      ...(event.errorCode ? { errorCode: clean(event.errorCode, 64) } : {}),
      ...(event.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(event.durationMs)) }),
    };
    await appendText(this.auditPath, `${JSON.stringify(safe)}\n`);
    await this.increment(`operations_${event.operation}_${event.outcome}`);
  }

  async operation<T>(operation: string, principal: Principal, action: () => Promise<T>, resourceIds?: string[]): Promise<T> {
    const started = Date.now();
    try {
      const result = await action();
      await this.record({ operation, outcome: 'success', principalId: principal.id, ...(principal.tenantId ? { tenantId: principal.tenantId } : {}), ...(resourceIds ? { resourceIds } : {}), durationMs: Date.now() - started });
      return result;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : 'INTERNAL_ERROR';
      await this.record({ operation, outcome: code === 'AUTHORIZATION_DENIED' ? 'denied' : 'error', principalId: principal.id, ...(principal.tenantId ? { tenantId: principal.tenantId } : {}), ...(resourceIds ? { resourceIds } : {}), errorCode: code, durationMs: Date.now() - started });
      throw error;
    }
  }

  async increment(name: string, amount = 1): Promise<void> {
    const state = await this.readMetrics();
    const key = metricName(name);
    if (!(key in state.counters) && Object.keys(state.counters).length >= MAX_METRICS) return;
    state.counters[key] = (state.counters[key] ?? 0) + amount;
    await writeText(this.metricsPath, `${JSON.stringify(state, null, 2)}\n`);
  }

  async gauge(name: string, value: number): Promise<void> {
    const state = await this.readMetrics();
    const key = metricName(name);
    if (!(key in state.gauges) && Object.keys(state.gauges).length >= MAX_METRICS) return;
    state.gauges[key] = Number.isFinite(value) ? value : 0;
    await writeText(this.metricsPath, `${JSON.stringify(state, null, 2)}\n`);
  }

  async prometheus(): Promise<string> {
    const state = await this.readMetrics();
    return [
      ...Object.entries(state.counters).map(([name, value]) => `agent_memory_${name}_total ${value}`),
      ...Object.entries(state.gauges).map(([name, value]) => `agent_memory_${name} ${value}`),
      '',
    ].join('\n');
  }

  private async readMetrics(): Promise<MetricsState> {
    if (!existsSync(this.metricsPath)) return { version: 1, counters: {}, gauges: {} };
    try {
      const value = JSON.parse(await readFile(this.metricsPath, 'utf8')) as MetricsState;
      if (value.version !== 1 || !value.counters || !value.gauges) throw new Error('Unsupported metrics state');
      return value;
    } catch {
      return { version: 1, counters: {}, gauges: {} };
    }
  }

  private async rotateAuditIfNeeded(): Promise<void> {
    if (!existsSync(this.auditPath) || (await stat(this.auditPath)).size < MAX_AUDIT_BYTES) return;
    await truncate(this.auditPath, 0);
  }
}

function clean(value: string, max: number): string {
  return redactSecrets(value).replace(/[\r\n]/g, ' ').slice(0, max);
}

function metricName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'unknown';
}
