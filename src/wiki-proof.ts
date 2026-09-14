import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { types } from 'node:util';
import { AgentMemoryError } from './errors.js';
import { throwIfCancelled } from './operation.js';

function invalidProof(): AgentMemoryError {
  return new AgentMemoryError('VALIDATION_FAILED', 'Wiki proof is invalid or unavailable; query or prepare the plan again on this vault');
}

function invalidJson(): AgentMemoryError {
  return new AgentMemoryError('VALIDATION_FAILED', 'Wiki proof values must be plain JSON data');
}

/** Sort object keys without invoking getters/toJSON; preserve meaningful array order. */
export function stableWikiJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(current: unknown, depth: number): string {
    if (depth > 128) throw invalidJson();
    if (current === null) return 'null';
    if (typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'number' && Number.isFinite(current)) return JSON.stringify(current);
    if (typeof current !== 'object' || types.isProxy(current) || ancestors.has(current)) throw invalidJson();
    const array = Array.isArray(current);
    const prototype: unknown = Object.getPrototypeOf(current);
    if (!array && prototype !== Object.prototype && prototype !== null) throw invalidJson();
    if (Object.getOwnPropertySymbols(current).length) throw invalidJson();
    const properties = Object.getOwnPropertyDescriptors(current);
    if (Object.values(properties).some((property) => !('value' in property))) throw invalidJson();
    ancestors.add(current);
    try {
      if (array) {
        const length = (current as unknown[]).length;
        const keys = Object.keys(properties).filter((key) => key !== 'length');
        if (keys.length !== length || keys.some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) throw invalidJson();
        return `[${Array.from({ length }, (_, index) => encode(properties[String(index)]!.value, depth + 1)).join(',')}]`;
      }
      return `{${Object.keys(properties).sort().flatMap((key) => {
        const property = properties[key]!;
        return !property.enumerable || property.value === undefined ? [] : [`${JSON.stringify(key)}:${encode(property.value, depth + 1)}`];
      }).join(',')}}`;
    } finally {
      ancestors.delete(current);
    }
  }
  return encode(value, 0);
}

interface ProofDirectory {
  path: string;
  identity: Stats;
}

/** Local operational attestation. Keys are never part of canonical knowledge or Git. */
export class WikiProof {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async sign(value: object): Promise<string> {
    return (await this.digest(value, true)).toString('hex');
  }

  async verify(value: object, proof: string): Promise<void> {
    throwIfCancelled();
    if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) throw invalidProof();
    const expected = await this.digest(value, false);
    throwIfCancelled();
    if (!timingSafeEqual(expected, Buffer.from(proof, 'hex'))) throw invalidProof();
  }

  private async digest(value: object, create: boolean): Promise<Buffer> {
    throwIfCancelled();
    if (value === null || typeof value !== 'object') throw invalidJson();
    const serialized = stableWikiJson(value);
    throwIfCancelled();
    let key: Buffer | undefined;
    try {
      const directory = await this.directory(create);
      try {
        key = await this.readKey(directory);
      } catch (error) {
        if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await this.publishKey(directory);
        key = await this.readKey(directory);
      }
      throwIfCancelled();
      return createHmac('sha256', key).update(serialized).digest();
    } catch (error) {
      if (error instanceof AgentMemoryError) throw error;
      throw invalidProof();
    } finally {
      key?.fill(0);
    }
  }

  private async directory(create: boolean): Promise<ProofDirectory> {
    const root = await lstat(this.root);
    throwIfCancelled();
    if (!root.isDirectory() || root.isSymbolicLink()) throw invalidProof();
    const path = join(await realpath(this.root), '.amem');
    throwIfCancelled();
    if (create) {
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const identity = await lstat(path);
    const directory = { path, identity };
    await this.assertDirectory(directory);
    return directory;
  }

  private async assertDirectory(directory: ProofDirectory): Promise<void> {
    throwIfCancelled();
    const current = await lstat(directory.path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directory.identity.dev || current.ino !== directory.identity.ino || await realpath(directory.path) !== directory.path) throw invalidProof();
    throwIfCancelled();
  }

  private async readKey(directory: ProofDirectory): Promise<Buffer> {
    await this.assertDirectory(directory);
    const path = join(directory.path, 'wiki-proof-key');
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) throw invalidProof();
    throwIfCancelled();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const key = Buffer.alloc(32);
    try {
      const state = await handle.stat();
      if (!state.isFile() || state.dev !== before.dev || state.ino !== before.ino || state.size !== 32 || (process.platform !== 'win32' && (state.mode & 0o777) !== 0o600)) throw invalidProof();
      await this.assertDirectory(directory);
      if ((await handle.read(key, 0, key.length, 0)).bytesRead !== key.length || (await handle.stat()).size !== 32) throw invalidProof();
      await this.assertDirectory(directory);
      return key;
    } catch (error) {
      key.fill(0);
      throw error;
    } finally {
      await handle.close();
    }
  }

  private async publishKey(directory: ProofDirectory): Promise<void> {
    await this.assertDirectory(directory);
    const temporary = join(directory.path, `.wiki-proof-key-${randomUUID()}`);
    const key = randomBytes(32);
    let created = false;
    try {
      throwIfCancelled();
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      try {
        await this.assertDirectory(directory);
        await handle.chmod(0o600);
        await handle.writeFile(key);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.assertDirectory(directory);
      try {
        // A complete key becomes visible at once; losing creators use the winner's key.
        await link(temporary, join(directory.path, 'wiki-proof-key'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await this.assertDirectory(directory);
      const directoryHandle = await open(directory.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } finally {
      key.fill(0);
      if (created) await unlink(temporary);
    }
  }
}
