import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
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
  let handle;
  for (;;) {
    try {
      handle = await open(lockPath, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new AgentMemoryError('LOCK_TIMEOUT', `Timed out waiting for vault lock: ${lockPath}`);
      if (await isStaleLock(lockPath)) {
        await rm(lockPath, { force: true });
        continue;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n${nowIso()}\n`, 'utf8');
    return await action();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    const [pidLine = '', timestampLine = ''] = (await readFile(lockPath, 'utf8')).split('\n');
    const timestamp = Date.parse(timestampLine);
    if (Number.isFinite(timestamp) && Date.now() - timestamp > 30_000) return true;
    const pid = Number(pidLine);
    if (!Number.isInteger(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  } catch {
    return true;
  }
}

export function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
