import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentMemoryError } from './errors.js';
import type { MarkdownDocument, Sensitivity } from './types.js';
import { writeText } from './utils.js';

const CIPHER = 'aes-256-gcm';

interface WrappedKey {
  iv: string;
  tag: string;
  ciphertext: string;
}

interface KeyStore {
  version: 1;
  keys: Record<string, WrappedKey>;
}

export interface EncryptedEnvelopeMeta {
  id: string;
  type: string;
  scope: string;
  sensitivity: Sensitivity;
  status?: string;
  createdAt: string;
  updatedAt?: string;
  encrypted: 'aes-256-gcm';
  cipherVersion: 1;
  iv: string;
  tag: string;
  keyRef: string;
}

export class EncryptionManager {
  private readonly keyStorePath: string;
  private readonly masterKey: Buffer | null;

  constructor(readonly root: string, encodedMasterKey = process.env.AMEM_MASTER_KEY) {
    this.keyStorePath = join(root, '.amem', 'keys.json');
    this.masterKey = encodedMasterKey ? parseMasterKey(encodedMasterKey) : null;
  }

  get available(): boolean {
    return this.masterKey !== null;
  }

  get fingerprint(): string | null {
    return this.masterKey ? createHash('sha256').update(this.masterKey).digest('hex').slice(0, 16) : null;
  }

  async encrypt<T extends object>(meta: T, body: string): Promise<{ meta: EncryptedEnvelopeMeta; body: string }> {
    const logical = meta as T & { id?: unknown; type?: unknown; scope?: unknown; sensitivity?: unknown; status?: unknown; createdAt?: unknown; updatedAt?: unknown };
    const id = required(logical.id, 'id');
    const type = required(logical.type, 'type');
    const scope = required(logical.scope, 'scope');
    const sensitivity = required(logical.sensitivity, 'sensitivity') as Sensitivity;
    if (!['sensitive', 'secret'].includes(sensitivity)) {
      throw new AgentMemoryError('ENCRYPTION_FAILED', 'Only confidential documents use envelope encryption');
    }
    const dataKey = await this.getOrCreateDataKey(id);
    const iv = randomBytes(12);
    const cipher = createCipheriv(CIPHER, dataKey, iv);
    const envelopeBase = {
      id,
      type,
      scope,
      sensitivity,
      ...(typeof logical.status === 'string' ? { status: logical.status } : {}),
      createdAt: required(logical.createdAt, 'createdAt'),
      ...(typeof logical.updatedAt === 'string' ? { updatedAt: logical.updatedAt } : {}),
    };
    cipher.setAAD(Buffer.from(documentAad(envelopeBase)));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ meta, body }), 'utf8'), cipher.final()]);
    const envelope: EncryptedEnvelopeMeta = {
      ...envelopeBase,
      encrypted: CIPHER,
      cipherVersion: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyRef: id,
    };
    return { meta: envelope, body: `ENC[${ciphertext.toString('base64')}]` };
  }

  async decrypt<T extends object>(meta: EncryptedEnvelopeMeta, body: string): Promise<MarkdownDocument<T>> {
    const master = this.requireMasterKey();
    void master;
    const store = await this.readKeyStore();
    const wrapped = store.keys[meta.keyRef];
    if (!wrapped) {
      throw new AgentMemoryError('ENCRYPTION_KEY_UNAVAILABLE', `The data key for ${meta.id} is unavailable`, { id: meta.id });
    }
    const dataKey = unwrapKey(this.requireMasterKey(), meta.keyRef, wrapped);
    const match = body.trim().match(/^ENC\[([A-Za-z0-9+/=]+)\]$/);
    if (!match?.[1]) throw new AgentMemoryError('ENCRYPTION_FAILED', `Encrypted document ${meta.id} has an invalid body`);
    try {
      const decipher = createDecipheriv(CIPHER, dataKey, Buffer.from(meta.iv, 'base64'));
      decipher.setAAD(Buffer.from(documentAad(meta)));
      decipher.setAuthTag(Buffer.from(meta.tag, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(match[1], 'base64')), decipher.final()]).toString('utf8');
      const logical = JSON.parse(plaintext) as { meta: T; body: string };
      return { path: '', meta: logical.meta, body: logical.body };
    } catch (error) {
      if (error instanceof AgentMemoryError) throw error;
      throw new AgentMemoryError('ENCRYPTION_FAILED', `Unable to decrypt ${meta.id}`, { id: meta.id });
    }
  }

  async erase(id: string): Promise<boolean> {
    this.requireMasterKey();
    const store = await this.readKeyStore();
    if (!store.keys[id]) return false;
    delete store.keys[id];
    await this.writeKeyStore(store);
    return true;
  }

  async hasKey(id: string): Promise<boolean> {
    const store = await this.readKeyStore();
    return Boolean(store.keys[id]);
  }

  private async getOrCreateDataKey(id: string): Promise<Buffer> {
    const master = this.requireMasterKey();
    const store = await this.readKeyStore();
    const existing = store.keys[id];
    if (existing) return unwrapKey(master, id, existing);
    const dataKey = randomBytes(32);
    store.keys[id] = wrapKey(master, id, dataKey);
    await this.writeKeyStore(store);
    return dataKey;
  }

  private requireMasterKey(): Buffer {
    if (!this.masterKey) {
      throw new AgentMemoryError(
        'ENCRYPTION_KEY_UNAVAILABLE',
        'A 32-byte AMEM_MASTER_KEY is required for sensitive and secret memory',
      );
    }
    return this.masterKey;
  }

  private async readKeyStore(): Promise<KeyStore> {
    if (!existsSync(this.keyStorePath)) return { version: 1, keys: {} };
    try {
      const parsed = JSON.parse(await readFile(this.keyStorePath, 'utf8')) as KeyStore;
      if (parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== 'object') throw new Error('Unsupported key store');
      return parsed;
    } catch (error) {
      throw new AgentMemoryError('ENCRYPTION_FAILED', `Invalid key store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeKeyStore(store: KeyStore): Promise<void> {
    await writeText(this.keyStorePath, `${JSON.stringify(store, null, 2)}\n`);
    await chmod(this.keyStorePath, 0o600);
  }
}

export function isEncryptedEnvelope(meta: object): meta is EncryptedEnvelopeMeta {
  return (meta as { encrypted?: unknown }).encrypted === CIPHER;
}

export function isConfidential(sensitivity: Sensitivity): boolean {
  return sensitivity === 'sensitive' || sensitivity === 'secret';
}

export function parseMasterKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) {
    throw new AgentMemoryError('CONFIG_INVALID', 'AMEM_MASTER_KEY must decode to exactly 32 bytes');
  }
  return key;
}

function wrapKey(master: Buffer, id: string, dataKey: Buffer): WrappedKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, master, iv);
  cipher.setAAD(Buffer.from(`agent-memory-key:${id}:v1`));
  const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function unwrapKey(master: Buffer, id: string, wrapped: WrappedKey): Buffer {
  try {
    const decipher = createDecipheriv(CIPHER, master, Buffer.from(wrapped.iv, 'base64'));
    decipher.setAAD(Buffer.from(`agent-memory-key:${id}:v1`));
    decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, 'base64')), decipher.final()]);
  } catch {
    throw new AgentMemoryError('ENCRYPTION_KEY_UNAVAILABLE', `Unable to unwrap the data key for ${id}`, { id });
  }
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new AgentMemoryError('ENCRYPTION_FAILED', `Confidential document is missing ${field}`);
  return value;
}

function documentAad(meta: { id: string; type: string; scope: string; sensitivity: Sensitivity; status?: string; createdAt: string; updatedAt?: string }): string {
  return ['agent-memory', 'document', 'v1', meta.id, meta.type, meta.scope, meta.sensitivity, meta.status ?? '', meta.createdAt, meta.updatedAt ?? ''].join(':');
}
