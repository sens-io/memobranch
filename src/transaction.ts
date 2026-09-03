import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AgentMemoryError } from './errors.js';
import { isEncryptedEnvelope, parseMasterKey } from './encryption.js';
import { parseMarkdown } from './markdown.js';
import type { Actor } from './types.js';
import { nowIso, resolveInside, shortId, writeText } from './utils.js';
import type { GitStore } from './git-store.js';

type TransactionPhase = 'writing' | 'ready';

type StoredText =
  | { encoding: 'base64'; data: string }
  | { encoding: 'aes-256-gcm'; iv: string; tag: string; data: string };

interface FileState {
  original: StoredText | string | null;
  desired: StoredText | string;
}

interface TransactionManifest {
  version: 1;
  id: string;
  createdAt: string;
  phase: TransactionPhase;
  actor: Actor;
  message: string;
  writes: Record<string, FileState>;
}

export interface RecoveryResult {
  rolledBack: string[];
  replayed: string[];
  commits: string[];
}

export class VaultTransaction {
  private readonly manifestPath: string;
  private manifest: TransactionManifest;

  private constructor(readonly root: string, readonly git: GitStore, manifest: TransactionManifest, private readonly masterKey: Buffer | null) {
    this.manifest = manifest;
    this.manifestPath = join(root, '.amem', 'transactions', `${manifest.id}.json`);
  }

  static async begin(root: string, git: GitStore, actor: Actor, message: string, encodedMasterKey?: string): Promise<VaultTransaction> {
    const manifest: TransactionManifest = {
      version: 1,
      id: `txn-${shortId()}`,
      createdAt: nowIso(),
      phase: 'writing',
      actor,
      message,
      writes: {},
    };
    const transaction = new VaultTransaction(root, git, manifest, encodedMasterKey ? parseMasterKey(encodedMasterKey) : null);
    await transaction.persist();
    return transaction;
  }

  async write(rootPath: string, content: string): Promise<void> {
    const absolute = resolveInside(this.root, rootPath);
    const normalized = toPosix(relative(this.root, absolute));
    const prior = this.manifest.writes[normalized];
    if (!prior) {
      const original = existsSync(absolute) ? await readFile(absolute, 'utf8') : null;
      this.manifest.writes[normalized] = {
        original: original === null ? null : encodeText(original, normalized, this.masterKey),
        desired: encodeText(content, normalized, this.masterKey),
      };
    } else {
      prior.desired = encodeText(content, normalized, this.masterKey);
    }
    await this.persist();
    await writeText(absolute, content);
  }

  async append(rootPath: string, content: string): Promise<void> {
    const absolute = resolveInside(this.root, rootPath);
    const current = existsSync(absolute) ? await readFile(absolute, 'utf8') : '';
    await this.write(rootPath, `${current}${content}`);
  }

  async commit(): Promise<string | null> {
    this.manifest.phase = 'ready';
    await this.persist();
    const commit = await this.git.commit(this.manifest.message, this.manifest.actor);
    await rm(this.manifestPath, { force: true });
    return commit;
  }

  async rollback(): Promise<void> {
    const entries = Object.entries(this.manifest.writes).reverse();
    for (const [path, state] of entries) {
      const absolute = resolveInside(this.root, path);
      if (state.original === null) await rm(absolute, { force: true });
      else await writeText(absolute, decodeText(state.original, path, this.masterKey));
    }
    await rm(this.manifestPath, { force: true });
  }

  private async persist(): Promise<void> {
    await mkdir(join(this.root, '.amem', 'transactions'), { recursive: true });
    await writeText(this.manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`);
  }
}

export async function recoverTransactions(root: string, git: GitStore, encodedMasterKey?: string): Promise<RecoveryResult> {
  const directory = join(root, '.amem', 'transactions');
  if (!existsSync(directory)) return { rolledBack: [], replayed: [], commits: [] };
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const masterKey = encodedMasterKey ? parseMasterKey(encodedMasterKey) : null;
  const result: RecoveryResult = { rolledBack: [], replayed: [], commits: [] };
  for (const file of files) {
    const path = join(directory, file);
    let manifest: TransactionManifest;
    try {
      manifest = JSON.parse(await readFile(path, 'utf8')) as TransactionManifest;
      validateManifest(manifest);
    } catch (error) {
      throw new AgentMemoryError('TRANSACTION_RECOVERY_FAILED', `Invalid transaction journal: ${file}`, {
        file,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (manifest.phase === 'ready') {
      for (const [rootPath, state] of Object.entries(manifest.writes)) {
        await writeText(resolveInside(root, rootPath), decodeText(state.desired, rootPath, masterKey));
      }
      const commit = await git.commit(manifest.message, manifest.actor);
      if (commit) result.commits.push(commit);
      result.replayed.push(manifest.id);
    } else {
      for (const [rootPath, state] of Object.entries(manifest.writes).reverse()) {
        const absolute = resolveInside(root, rootPath);
        if (state.original === null) await rm(absolute, { force: true });
        else await writeText(absolute, decodeText(state.original, rootPath, masterKey));
      }
      result.rolledBack.push(manifest.id);
    }
    await rm(path, { force: true });
  }
  return result;
}

export async function pendingTransactionCount(root: string): Promise<number> {
  const directory = join(root, '.amem', 'transactions');
  if (!existsSync(directory)) return 0;
  return (await readdir(directory)).filter((name) => name.endsWith('.json')).length;
}

function validateManifest(value: TransactionManifest): void {
  if (value.version !== 1 || !value.id || !['writing', 'ready'].includes(value.phase) || !value.actor?.id || !value.message || !value.writes) {
    throw new Error('Malformed transaction manifest');
  }
  for (const [path, state] of Object.entries(value.writes)) {
    if (!path || !state || typeof state !== 'object' || !isStoredText(state.desired) || (state.original !== null && !isStoredText(state.original))) {
      throw new Error(`Malformed transaction file state: ${path}`);
    }
  }
}

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

function encodeText(value: string, path: string, masterKey: Buffer | null): StoredText {
  if (!isPlaintextConfidential(value)) return { encoding: 'base64', data: Buffer.from(value, 'utf8').toString('base64') };
  if (!masterKey) throw new AgentMemoryError('ENCRYPTION_KEY_UNAVAILABLE', 'A master key is required to journal confidential plaintext safely');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(`agent-memory-journal:${path}:v1`));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { encoding: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}

function decodeText(value: StoredText | string, path: string, masterKey: Buffer | null): string {
  if (typeof value === 'string') return value;
  if (value.encoding === 'base64') return Buffer.from(value.data, 'base64').toString('utf8');
  if (!masterKey) throw new AgentMemoryError('ENCRYPTION_KEY_UNAVAILABLE', 'A master key is required to recover a confidential transaction');
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(`agent-memory-journal:${path}:v1`));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new AgentMemoryError('TRANSACTION_RECOVERY_FAILED', `Unable to decrypt transaction state for ${path}`);
  }
}

function isPlaintextConfidential(value: string): boolean {
  try {
    const parsed = parseMarkdown<Record<string, unknown>>(value);
    if (isEncryptedEnvelope(parsed.meta)) return false;
    return ['sensitive', 'secret'].includes(String(parsed.meta.sensitivity));
  } catch {
    return false;
  }
}

function isStoredText(value: unknown): value is StoredText | string {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object') return false;
  const stored = value as Partial<StoredText>;
  if (stored.encoding === 'base64') return typeof stored.data === 'string';
  return stored.encoding === 'aes-256-gcm' && typeof stored.data === 'string' && typeof stored.iv === 'string' && typeof stored.tag === 'string';
}
