import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import type { MemoryVault } from './vault.js';
import { nowIso, withFileLock, writeText } from './utils.js';

export interface MaintenanceResult {
  startedAt: string;
  finishedAt: string;
  recovery: Awaited<ReturnType<MemoryVault['recover']>>;
  expiry: Awaited<ReturnType<MemoryVault['expireDue']>>;
  index: Awaited<ReturnType<MemoryVault['reindex']>>;
  doctor: Awaited<ReturnType<MemoryVault['doctor']>>;
  sync?: Awaited<ReturnType<MemoryVault['sync']>>;
}

export interface ServiceHandle {
  host: string;
  port: number;
  stop(): Promise<void>;
}

interface ManagedWatcher {
  close(): void;
}

export class MaintenanceService {
  private running: Promise<MaintenanceResult> | null = null;
  private lastResult: MaintenanceResult | null = null;
  private lastError: AgentMemoryError | null = null;
  private watchers: ManagedWatcher[] = [];
  private server: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private readonly leasePath: string;
  private readonly leaseLockPath: string;
  private leaseOwnerToken: string | null = null;

  constructor(readonly vault: MemoryVault) {
    this.leasePath = join(vault.root, '.amem', 'service.json');
    this.leaseLockPath = join(vault.root, '.amem', 'service.lock');
  }

  async runOnce(): Promise<MaintenanceResult> {
    if (this.running) return this.running;
    this.running = this.performCycle();
    try {
      this.lastResult = await this.running;
      this.lastError = null;
      return this.lastResult;
    } catch (error) {
      this.lastError = toAgentMemoryError(error);
      throw error;
    } finally {
      this.running = null;
    }
  }

  async start(options: { host?: string; port?: number } = {}): Promise<ServiceHandle> {
    const config = await this.vault.config();
    const host = options.host ?? '127.0.0.1';
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new AgentMemoryError('CONFIG_INVALID', 'The maintenance HTTP server only supports loopback addresses');
    await this.acquireLease();
    const schedule = () => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => { void this.runOnce().catch(() => undefined); }, config.maintenance.debounceMs);
    };
    try {
      this.watchers = await createManagedWatchers(this.vault.root, schedule);
    } catch (error) {
      await this.releaseLease();
      throw error;
    }
    this.timer = setInterval(() => { void this.runOnce().catch(() => undefined); }, config.maintenance.intervalMs);
    this.timer.unref();
    await this.runOnce().catch(() => undefined);
    this.server = createServer(async (request, response) => {
      if (request.url === '/metrics') {
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        response.end(await this.vault.telemetry.prometheus());
        return;
      }
      if (request.url === '/healthz') {
        const unavailable = Boolean(this.lastError) || !this.lastResult || this.lastResult.doctor.healthy !== true;
        const payload = {
          status: unavailable ? 'unavailable' : 'ok',
          running: Boolean(this.running),
          lastFinishedAt: this.lastResult?.finishedAt ?? null,
          configuration: this.lastResult?.doctor.configuration ?? null,
          git: this.lastResult?.doctor.git ?? null,
          index: this.lastResult?.doctor.index ?? null,
          recovery: this.lastResult?.doctor.recovery ?? null,
          maintenance: this.lastResult ? { startedAt: this.lastResult.startedAt, finishedAt: this.lastResult.finishedAt } : null,
          error: this.lastError?.toJSON().error ?? null,
        };
        response.writeHead(unavailable ? 503 : 200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(`${JSON.stringify(payload)}\n`);
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{"error":"not_found"}\n');
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(options.port ?? 0, host, () => resolve());
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
    try {
      await this.updateLease({ host, port });
    } catch (error) {
      try { await this.stop(); } catch { /* Preserve the startup failure. */ }
      throw error;
    }
    return { host, port, stop: () => this.stop() };
  }

  async stop(): Promise<void> {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.timer) clearInterval(this.timer);
    for (const watcher of this.watchers) watcher.close();
    if (this.server?.listening) await new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()));
    this.debounce = null;
    this.timer = null;
    this.watchers = [];
    this.server = null;
    this.vault.llm.cancelPending();
    if (this.running) {
      await Promise.race([
        this.running.catch(() => undefined),
        new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5_000);
          timeout.unref();
        }),
      ]);
    }
    await this.releaseLease();
  }

  private async performCycle(): Promise<MaintenanceResult> {
    const startedAt = nowIso();
    const recovery = await this.vault.recover();
    const expiry = await this.vault.expireDue();
    const index = await this.vault.reindex(Boolean((await this.vault.config()).index.embeddingModel));
    const doctor = await this.vault.doctor();
    const config = await this.vault.config();
    const sync = config.remote && config.maintenance.autoSync ? await this.vault.sync() : undefined;
    const finishedAt = nowIso();
    await this.vault.telemetry.gauge('maintenance_healthy', doctor.healthy ? 1 : 0);
    return { startedAt, finishedAt, recovery, expiry, index, doctor, ...(sync ? { sync } : {}) };
  }

  private async acquireLease(): Promise<void> {
    const ownerToken = randomUUID();
    await withFileLock(this.leaseLockPath, async () => {
      if (existsSync(this.leasePath)) {
        try {
          const lease = JSON.parse(await readFile(this.leasePath, 'utf8')) as { pid?: number };
          if (lease.pid && isLive(lease.pid)) throw new AgentMemoryError('LOCK_TIMEOUT', `Maintenance service is already running with pid ${lease.pid}`);
        } catch (error) {
          if (error instanceof AgentMemoryError) throw error;
        }
        await rm(this.leasePath, { force: true });
      }
      let handle;
      try {
        handle = await open(this.leasePath, 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AgentMemoryError('LOCK_TIMEOUT', 'Maintenance service lease was acquired concurrently');
        throw error;
      }
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, ownerToken, startedAt: nowIso() }, null, 2)}\n`);
      } finally {
        await handle.close();
      }
      this.leaseOwnerToken = ownerToken;
    });
  }

  private async updateLease(state: { host: string; port: number }): Promise<void> {
    const ownerToken = this.leaseOwnerToken;
    if (!ownerToken) throw new AgentMemoryError('LOCK_TIMEOUT', 'Maintenance service does not own a lease');
    await withFileLock(this.leaseLockPath, async () => {
      const lease = await this.readLease();
      if (lease.ownerToken !== ownerToken) throw new AgentMemoryError('LOCK_TIMEOUT', 'Maintenance service lease ownership changed');
      await writeText(this.leasePath, `${JSON.stringify({ ...lease, ...state, pid: process.pid, ownerToken }, null, 2)}\n`);
    });
  }

  private async releaseLease(): Promise<void> {
    const ownerToken = this.leaseOwnerToken;
    if (!ownerToken) return;
    let released = false;
    try {
      await withFileLock(this.leaseLockPath, async () => {
        try {
          const lease = await this.readLease();
          if (lease.ownerToken === ownerToken) await rm(this.leasePath, { force: true });
          released = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          released = true;
        }
      });
    } finally {
      if (released) this.leaseOwnerToken = null;
    }
  }

  private async readLease(): Promise<{ pid?: number; ownerToken?: string; startedAt?: string; host?: string; port?: number }> {
    return JSON.parse(await readFile(this.leasePath, 'utf8')) as { pid?: number; ownerToken?: string; startedAt?: string; host?: string; port?: number };
  }
}

function isLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function createManagedWatchers(root: string, onChange: () => void): Promise<ManagedWatcher[]> {
  const managed = ['wiki', 'evidence', 'candidates'].map((directory) => join(root, directory));
  const nativeWatchers: FSWatcher[] = [];
  let closed = false;
  let polling = false;
  let poller: NodeJS.Timeout | null = null;
  let fingerprint = await managedFingerprint(managed);

  const closeNativeWatchers = () => {
    for (const watcher of nativeWatchers.splice(0)) watcher.close();
  };
  const startPollingFallback = () => {
    if (closed || poller) return;
    poller = setInterval(() => {
      if (polling || closed) return;
      polling = true;
      void managedFingerprint(managed)
        .then((next) => {
          if (next !== fingerprint) {
            fingerprint = next;
            onChange();
          }
        })
        .finally(() => { polling = false; });
    }, 250);
    poller.unref();
  };

  try {
    for (const directory of managed) {
      if (!existsSync(directory)) continue;
      const watcher = watch(directory, { recursive: true }, () => onChange());
      watcher.on('error', () => {
        closeNativeWatchers();
        startPollingFallback();
      });
      nativeWatchers.push(watcher);
    }
  } catch {
    closeNativeWatchers();
    startPollingFallback();
  }

  return [{
    close() {
      closed = true;
      closeNativeWatchers();
      if (poller) clearInterval(poller);
      poller = null;
    },
  }];
}

async function managedFingerprint(roots: string[]): Promise<string> {
  return (await Promise.all(roots.map(snapshotDirectory))).flat().sort().join('\n');
}

async function snapshotDirectory(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const snapshots = await Promise.all(entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return snapshotDirectory(path);
      if (!entry.isFile()) return [];
      try {
        const metadata = await stat(path);
        return [`${path}:${metadata.size}:${metadata.mtimeMs}`];
      } catch {
        return [];
      }
    }));
    return snapshots.flat();
  } catch {
    return [];
  }
}
