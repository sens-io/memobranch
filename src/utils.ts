import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AgentMemoryError } from './errors.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function shortId(seed?: string): string {
  return seed ? sha256(seed).slice(0, 12) : randomUUID().replaceAll('-', '').slice(0, 12);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'memory';
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function appendText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'a');
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export function resolveInside(root: string, requested = '.'): string {
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, requested);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`Path escapes the vault: ${requested}`);
  }
  return target;
}

export async function withFileLock<T>(lockPath: string, action: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const ownerToken = randomUUID();
  const ticket = process.hrtime.bigint().toString();
  const queuePath = `${lockPath}.queue`;
  const contenderPath = join(queuePath, `${ticket.padStart(24, '0')}-${ownerToken}.json`);
  await mkdir(queuePath, { recursive: true });
  const contenderHandle = await open(contenderPath, 'wx');
  try {
    await contenderHandle.writeFile(`${JSON.stringify({ version: 1, pid: process.pid, ownerToken, ticket, createdAt: nowIso() })}\n`, 'utf8');
  } finally {
    await contenderHandle.close();
  }
  try {
    for (;;) {
      const winner = await firstLiveContender(queuePath);
      if (winner === ownerToken) {
        let handle;
        try {
          handle = await open(lockPath, 'wx');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (await clearObservedStaleLock(lockPath)) continue;
        }
        if (handle) {
          try {
            await handle.writeFile(`${JSON.stringify({ version: 1, pid: process.pid, ownerToken, createdAt: nowIso() })}\n`, 'utf8');
            return await action();
          } finally {
            await handle.close();
            if (await lockBelongsTo(lockPath, ownerToken)) await rm(lockPath, { force: true });
          }
        }
      }
      if (Date.now() >= deadline) throw new AgentMemoryError('LOCK_TIMEOUT', `Timed out waiting for vault lock: ${lockPath}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  } finally {
    await rm(contenderPath, { force: true });
  }
}

async function firstLiveContender(queuePath: string): Promise<string | null> {
  for (const name of (await readdir(queuePath)).filter((entry) => entry.endsWith('.json')).sort()) {
    const path = join(queuePath, name);
    const separator = name.indexOf('-');
    const expectedOwner = separator >= 0 ? name.slice(separator + 1, -'.json'.length) : name.slice(0, -'.json'.length);
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown; ownerToken?: unknown; ticket?: unknown };
      if (!Number.isInteger(value.pid) || Number(value.pid) <= 0 || typeof value.ownerToken !== 'string' || !value.ownerToken || typeof value.ticket !== 'string' || !/^\d+$/.test(value.ticket)) {
        throw new Error('Malformed lock contender');
      }
      if (value.ownerToken !== expectedOwner) throw new Error('Lock contender owner does not match its path');
      if (processIsDead(Number(value.pid))) {
        await rm(path, { force: true });
        continue;
      }
      return value.ownerToken;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      try {
        if (Date.now() - (await stat(path)).mtimeMs > 30_000) {
          await rm(path, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
      }
      // A newly created contender is visible before its owner finishes writing.
      // Treat it as the earliest ticket so nobody can pass an incomplete peer.
      return expectedOwner;
    }
  }
  return null;
}

async function clearObservedStaleLock(lockPath: string): Promise<boolean> {
  try {
    const raw = await readFile(lockPath, 'utf8');
    const parsed = parseLock(raw);
    const stale = parsed ? processIsDead(parsed.pid) : Date.now() - (await stat(lockPath)).mtimeMs > 30_000;
    if (!stale) return false;
    if (await readFile(lockPath, 'utf8') !== raw) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function processIsDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function parseLock(raw: string): { pid: number; ownerToken?: string } | null {
  try {
    const value = JSON.parse(raw) as { pid?: unknown; ownerToken?: unknown };
    if (!Number.isInteger(value.pid) || Number(value.pid) <= 0) return null;
    return { pid: Number(value.pid), ...(typeof value.ownerToken === 'string' ? { ownerToken: value.ownerToken } : {}) };
  } catch {
    const [pidLine = ''] = raw.split('\n');
    const pid = Number(pidLine);
    return Number.isInteger(pid) && pid > 0 ? { pid } : null;
  }
}

async function lockBelongsTo(lockPath: string, ownerToken: string): Promise<boolean> {
  try {
    return parseLock(await readFile(lockPath, 'utf8'))?.ownerToken === ownerToken;
  } catch {
    return false;
  }
}

export function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
