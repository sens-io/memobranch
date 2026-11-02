import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { EncryptionManager } from './encryption.js';
import { AgentMemoryError } from './errors.js';
import { throwIfCancelled } from './operation.js';

export const wikiJobIdSchema = z.string().regex(/^wj-[a-f0-9]{32}$/);
const envelope = z.object({ meta: z.object({ id: wikiJobIdSchema, type: z.literal('wiki-job'), scope: z.literal('project'),
  sensitivity: z.literal('secret'), createdAt: z.string().datetime({ offset: true }), encrypted: z.literal('aes-256-gcm'),
  cipherVersion: z.literal(1), iv: z.string().max(32), tag: z.string().max(32), keyRef: wikiJobIdSchema }).strict(),
body: z.string().max(8_000_000) }).strict();

/** Internal runtime store. Every call is made under the canonical vault writer lock. */
export class WikiJobStore {
  constructor(private readonly root: string, private readonly encryption: EncryptionManager) {}

  async ids(): Promise<string[]> {
    const directory = await this.directory(false);
    if (!directory) return [];
    const ids: string[] = []; let entries = 0;
    for await (const entry of await opendir(directory.path)) {
      if (++entries > 1000) throw invalid();
      if (!/^wj-[a-f0-9]{32}\.json$/.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw invalid();
      ids.push(entry.name.slice(0, -5));
      if (ids.length > 100) throw invalid();
    }
    await this.assertDirectory(directory);
    return ids.sort();
  }

  async read(id: string): Promise<unknown> {
    checkedId(id);
    const directory = await this.directory(false);
    if (!directory) throw missing();
    const path = join(directory.path, `${id}.json`);
    let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw missing(); throw invalid(); }
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 8_000_000 || (process.platform !== 'win32' && (before.mode & 0o077) !== 0)) throw invalid();
      const data = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < data.length) {
        const read = await handle.read(data, count, data.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      const after = await handle.stat();
      if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw invalid();
      await this.assertDirectory(directory);
      const parsed = envelope.parse(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(data.subarray(0, count))));
      if (parsed.meta.id !== id || parsed.meta.keyRef !== id) throw invalid();
      const result = await this.encryption.decrypt(parsed.meta, parsed.body);
      if (Buffer.byteLength(result.body) > 5_000_000) throw invalid();
      return JSON.parse(result.body);
    } catch (error) {
      if (error instanceof AgentMemoryError) throw error;
      throw invalid();
    } finally { await handle.close(); }
  }

  async write(value: { id: string; createdAt: string }): Promise<void> {
    checkedId(value.id); throwIfCancelled();
    const plaintext = JSON.stringify(value);
    if (Buffer.byteLength(plaintext) > 5_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Wiki job result exceeds its storage limit');
    const directory = (await this.directory(true))!;
    const encrypted = await this.encryption.encrypt({ id: value.id, type: 'wiki-job', scope: 'project', sensitivity: 'secret', createdAt: value.createdAt }, plaintext);
    const serialized = JSON.stringify(encrypted);
    if (Buffer.byteLength(serialized) > 8_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Wiki job ciphertext exceeds its storage limit');
    const temporary = join(directory.path, `.${value.id}-${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(serialized); await handle.sync();
      await this.assertDirectory(directory);
      const destination = join(directory.path, `${value.id}.json`);
      try { if (!(await lstat(destination)).isFile() || (await lstat(destination)).isSymbolicLink()) throw invalid(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(temporary, destination);
      await this.assertDirectory(directory);
      const parent = await open(directory.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await parent.sync(); } finally { await parent.close(); }
    } finally {
      await handle.close();
      await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    }
  }

  async remove(id: string): Promise<void> {
    checkedId(id);
    const directory = await this.directory(false);
    if (!directory) return;
    await this.encryption.erase(id);
    await this.assertDirectory(directory);
    await unlink(join(directory.path, `${id}.json`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }

  private async directory(create: boolean): Promise<{ path: string; identity: Stats } | null> {
    const root = await realpath(this.root);
    if (!(await lstat(this.root)).isDirectory() || (await lstat(this.root)).isSymbolicLink()) throw invalid();
    const parent = join(root, '.amem');
    if (!(await lstat(parent)).isDirectory() || (await lstat(parent)).isSymbolicLink() || await realpath(parent) !== parent) throw invalid();
    const path = join(parent, 'wiki-jobs');
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    let identity;
    try { identity = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const directory = { path, identity }; await this.assertDirectory(directory); return directory;
  }

  private async assertDirectory(directory: { path: string; identity: Stats }): Promise<void> {
    const current = await lstat(directory.path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directory.identity.dev || current.ino !== directory.identity.ino ||
        await realpath(directory.path) !== directory.path || (process.platform !== 'win32' && (current.mode & 0o077) !== 0)) throw invalid();
  }
}

function checkedId(id: string) { if (!wikiJobIdSchema.safeParse(id).success) throw invalid(); }
function invalid() { return new AgentMemoryError('VALIDATION_FAILED', 'Wiki job runtime state is invalid or unsafe'); }
function missing() { return new AgentMemoryError('NOT_FOUND', 'Wiki job is unavailable'); }
