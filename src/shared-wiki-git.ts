import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readVaultConfig } from './config.js';
import { AgentMemoryError } from './errors.js';
import { GitStore, type GitRunOptions } from './git-store.js';
import { LlmClient } from './llm.js';
import { cancellationError, combineSignals, operationSignal, throwIfCancelled, withOperation, withoutCancellation } from './operation.js';
import type { Principal } from './policy.js';
import { parseCloudJson, readCloudHostFile } from './shared-wiki-cloud-config.js';
import { sha256, withFileLock } from './utils.js';
import { MemoryVault } from './vault.js';

const rootFiles = new Set(['MEMORY.md', 'INDEX.md', 'WIKI.md', 'log.md', 'agent-memory.json', 'agent-memory.json.v1.bak', 'AGENTS.md', '.gitignore']);
const directories = new Set(['evidence', 'candidates', 'wiki']);
const safeAttributes = '* -filter -text -ident -working-tree-encoding -diff -merge\n';
const hash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const ownerSchema = z.object({ version: z.literal(1), callerVaultId: z.string(), sourceId: z.string(), vaultId: z.string(), tenantId: z.string(),
  remoteHash: z.string().regex(/^[a-f0-9]{64}$/), branch: z.string(), objectFormat: z.enum(['sha1', 'sha256']) }).strict();

export interface SharedGitSource {
  id: string; remote: string; branch: string; commit: string; vaultId: string; tenantId: string;
  allowLocalFile?: boolean | undefined; timeoutMs?: number | undefined; maxCacheBytes?: number | undefined;
}
interface TreeEntry { path: string; hash: string; bytes: number }
interface DirectoryIdentity { path: string; dev: number; ino: number }

export function sharedGitRemoteAllowed(value: string, allowLocalFile = false): boolean {
  if (!value || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) return false;
  if (allowLocalFile && isAbsolute(value) && !value.startsWith('//')) return true;
  if (/^git@[a-z0-9][a-z0-9._-]*:[^\s?#]+$/i.test(value)) return true;
  try {
    const parsed = new URL(value);
    if (parsed.password || parsed.search || parsed.hash) return false;
    if (parsed.protocol === 'https:') return !parsed.username && Boolean(parsed.hostname);
    if (parsed.protocol === 'ssh:') return (!parsed.username || parsed.username === 'git') && Boolean(parsed.hostname);
    if (allowLocalFile && parsed.protocol === 'file:' && !parsed.username && (!parsed.hostname || parsed.hostname === 'localhost')) return isAbsolute(fileURLToPath(parsed));
    return false;
  } catch { return false; }
}
export function sharedGitBranchAllowed(value: string): boolean {
  return Boolean(value && value.length <= 200 && value !== '@' && !/^[\/-]|[\/.]$/.test(value) && !/[\s~^:?*\[\]\\\x00-\x1f\x7f]/.test(value)
    && !value.includes('..') && !value.includes('@{') && value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock')));
}

/** A dedicated derived cache, never a caller-selected worktree or whole-vault synchronization. */
export async function readGitSharedWiki(callerRoot: string, callerVaultId: string, binding: SharedGitSource, principal: Principal,
  masterKey: string, selection: { pageKeys: string[]; includeSensitive: boolean; includeSecret: boolean }) {
  throwIfCancelled();
  const timeoutMs = binding.timeoutMs ?? 30_000, maximum = binding.maxCacheBytes ?? 536_870_912;
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(binding.id) || !hash.safeParse(binding.commit).success || !sharedGitRemoteAllowed(binding.remote, binding.allowLocalFile)
    || !sharedGitBranchAllowed(binding.branch) || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000
    || !Number.isInteger(maximum) || maximum < 64_000 || maximum > 1_073_741_824) invalid();
  const parent = operationSignal(), stop = new AbortController(), combined = combineSignals(parent ? [parent, stop.signal] : [stop.signal]);
  const timeout = setTimeout(() => stop.abort(), timeoutMs); timeout.unref();
  try {
    return await withOperation(combined.signal, async () => {
      const base = join(callerRoot, '.amem', 'shared-cache'), identities = await directoryChain(callerRoot, ['.amem', 'shared-cache']);
      const refreshLock = join(base, binding.id + '.lock');
      await createDirectory(refreshLock + '.queue'); identities.push(await directoryIdentity(refreshLock + '.queue'));
      if (await exists(refreshLock)) { const meta = await lstat(refreshLock); if (!meta.isFile() || meta.nlink !== 1) invalid(); }
      return withFileLock(refreshLock, async () => {
        await assertDirectories(identities);
        const slot = join(base, binding.id), created = await createDirectory(slot);
        const owner = { version: 1 as const, callerVaultId, sourceId: binding.id, vaultId: binding.vaultId, tenantId: binding.tenantId,
          remoteHash: sha256(binding.remote), branch: binding.branch, objectFormat: binding.commit.length === 64 ? 'sha256' as const : 'sha1' as const };
        if (created) await writeRegular(join(slot, 'owner.json'), Buffer.from(JSON.stringify(owner)), true);
        const ownership = async () => {
          await assertDirectories(identities);
          const parsed = ownerSchema.safeParse(parseCloudJson(await readCloudHostFile(join(slot, 'owner.json'))));
          if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(owner)) invalid();
        };
        await ownership();
        // Inspect the existing slot before Git or our writes can follow an old
        // metadata link. Remote trees are never allowed to supply this runtime.
        const fixed = await directoryChain(slot, ['vault', '.amem']); identities.push(...fixed);
        const root = join(slot, 'vault'), git = new GitStore(root), hooks = join(root, '.amem', 'empty-hooks');
        await diskBytes(slot); // Reject links/foreign file types before cleanup or Git.
        await removeAbandonedStages(root);
        if (await diskBytes(slot) > maximum) tooLarge();
        await createDirectory(hooks); if ((await readdir(hooks)).length) invalid();
        await writeRegular(join(root, '.amem', 'empty-attributes'), Buffer.alloc(0));
        const run = (args: string[], options: GitRunOptions = {}) => git.run(['--no-replace-objects', '-c', `core.hooksPath=${hooks}`,
          '-c', `core.attributesFile=${join(root, '.amem', 'empty-attributes')}`, '-c', 'core.fsmonitor=false', ...args], { timeoutMs, ...options });
        await createDirectory(git.gitDir); await clearGitLocks(git.gitDir);
        if (!await exists(join(git.gitDir, 'HEAD'))) {
          // GitStore recognizes init here and omits GIT_WORK_TREE. Initialization
          // copies only our empty template and does not inspect a source tree.
          await git.run(['init', '--bare', '--template=' + hooks, '--object-format=' + owner.objectFormat, git.gitDir], { timeoutMs });
          await run(['config', 'core.bare', 'false']); await run(['config', 'core.worktree', root]);
          await run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
        }
        for (const [key, value] of [['core.bare', 'false'], ['core.worktree', root], ['core.hooksPath', hooks], ['core.attributesFile', join(root, '.amem', 'empty-attributes')],
          ['core.fsmonitor', 'false'], ['core.autocrlf', 'false'], ['core.filemode', 'false']]) await run(['config', key!, value!]);
        await run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
        identities.push(await directoryIdentity(git.gitDir));
        await createDirectory(join(git.gitDir, 'info'));
        await writeRegular(join(git.gitDir, 'info', 'attributes'), Buffer.from(safeAttributes));
        const safeMetadata = async () => {
          await ownership(); await assertDirectories(identities);
          for (const path of ['info/grafts', 'objects/info/alternates', 'shallow']) if (await exists(join(git.gitDir, path))) invalid();
          if ((await readCloudHostFile(join(git.gitDir, 'info', 'attributes'), 1000)).toString() !== safeAttributes || (await readdir(hooks)).length) invalid();
          if (process.env.GIT_GRAFT_FILE || await run(['config', '--get-regexp', '(^remote\\..*\\.promisor$|^extensions\\.partialclone$)'], { allowFailure: true })) invalid();
          if (await diskBytes(slot) > maximum) tooLarge();
        };
        await safeMetadata();
        let resourceFailure: unknown, polling: Promise<void> | undefined;
        const monitor = setInterval(() => {
          if (polling) return;
          polling = diskBytes(slot).then(bytes => { if (bytes > maximum) tooLarge(); }).catch(error => { resourceFailure ??= error; stop.abort(); }).finally(() => { polling = undefined; });
        }, 100); monitor.unref();
        try {
          await run(['fetch', '--force', '--no-tags', '--no-recurse-submodules', '--no-auto-gc', '--no-write-commit-graph', '--', binding.remote,
            `+refs/heads/${binding.branch}:refs/remotes/shared/current`]);
        } catch (error) {
          if (resourceFailure) throw resourceFailure;
          if (parent?.aborted) throw cancellationError();
          throw new AgentMemoryError('REMOTE_TRANSPORT', stop.signal.aborted ? 'Shared Git refresh timed out' : 'Shared Git refresh failed');
        } finally { clearInterval(monitor); await polling; }
        if (resourceFailure) throw resourceFailure;
        await safeMetadata();
        const head = await run(['rev-parse', '--verify', 'refs/remotes/shared/current']);
        if (!hash.safeParse(head).success || await run(['cat-file', '-t', binding.commit]) !== 'commit') invalid();
        try { await run(['merge-base', '--is-ancestor', binding.commit, head]); }
        catch { throwIfCancelled(); throw new AgentMemoryError('NOT_FOUND', 'Shared Git pin is not available in current remote history'); }
        const entries = parseTree(await run(['ls-tree', '-r', '-l', '-z', '--full-tree', head], { rawOutput: true }));
        const stage = join(root, '.amem', 'stage-' + randomUUID()); await createDirectory(stage);
        try {
          const beforeStaging = await diskBytes(slot); let stagedBytes = 0;
          for (const entry of entries) {
            throwIfCancelled(); const content = Buffer.from(await run(['cat-file', 'blob', entry.hash], { rawOutput: true }));
            const digest = createHash(owner.objectFormat).update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
            if (content.length !== entry.bytes || digest !== entry.hash) invalid();
            stagedBytes += content.length; if (beforeStaging + stagedBytes > maximum) tooLarge();
            await writeRegular(join(stage, sha256(entry.path)), content, true);
          }
          await withFileLock(join(root, '.amem', 'write.lock'), async () => {
            await ownership(); await assertDirectories(identities);
            const pending = join(root, '.amem', 'shared-cache-pending.json');
            const currentPaths = await managedFiles(root);
            await writeRegular(pending, Buffer.from(JSON.stringify({ version: 1, head })));
            const desired = new Set(entries.map(entry => entry.path));
            for (const path of currentPaths) if (!desired.has(path)) { throwIfCancelled(); await assertDirectories(identities); await rm(join(root, path)); }
            await removeEmptyManagedDirectories(root);
            for (const entry of entries) {
              throwIfCancelled(); await assertDirectories(identities); await ensureManagedParents(root, entry.path);
              const target = join(root, entry.path);
              if (await exists(target) && !(await lstat(target)).isFile()) invalid();
              await rename(join(stage, sha256(entry.path)), target); await chmod(target, 0o600);
            }
            await rm(join(git.gitDir, 'index'), { force: true });
            await run(['read-tree', '--reset', head]); await run(['update-ref', 'refs/heads/main', head]);
            await ownership(); await assertDirectories(identities); await rm(pending, { force: true });
          }, timeoutMs);
        } finally {
          await withoutCancellation(async () => { await assertDirectories(identities); await rm(stage, { recursive: true, force: true }); });
        }
        await safeMetadata();
        const config = await readVaultConfig(root);
        if (config.vaultId !== binding.vaultId || config.tenantId !== binding.tenantId) invalid();
        const source = new MemoryVault(root, { principal, masterKey, llm: new LlmClient({ apiKey: '', embeddingModel: '' }) });
        const retained = await source.withReadSnapshot(() => source.wikiSnapshotWithValidation({ commit: binding.commit, ...selection }), 'read');
        if (retained.snapshot.authorityHead !== head || retained.snapshot.commit !== binding.commit) invalid();
        await ownership(); await assertDirectories(identities); retained.validate(); return retained;
      }, timeoutMs);
    });
  } catch (error) {
    if (parent?.aborted) throw cancellationError();
    if (stop.signal.aborted && error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED') throw new AgentMemoryError('REMOTE_TRANSPORT', 'Shared Git refresh timed out');
    throw error;
  } finally { clearTimeout(timeout); combined.dispose(); }
}

function parseTree(text: string): TreeEntry[] {
  const entries: TreeEntry[] = [], paths = new Map<string, { spelling: string; file: boolean }>(); let bytes = 0;
  for (const line of text.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\s+(\d+)\t(.+)$/.exec(line);
    if (!match) invalid(); const path = match[4]!; assertManagedPath(path);
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      const spelling = parts.slice(0, index + 1).join('/'), normalized = spelling.normalize('NFC').toLowerCase(), file = index === parts.length - 1;
      const previous = paths.get(normalized);
      if (previous && (previous.spelling !== spelling || previous.file !== file || file)) invalid();
      paths.set(normalized, { spelling, file });
    }
    const size = Number(match[3]); bytes += size;
    if (size > 10_000_000 || bytes > 100_000_000 || entries.length >= 5000) tooLarge();
    entries.push({ path, hash: match[2]!, bytes: size });
  }
  if (!entries.some(entry => entry.path === 'agent-memory.json')) invalid(); return entries;
}
function assertManagedPath(path: string): void {
  const parts = path.split('/');
  assertSafeParts(path);
  if (!(rootFiles.has(path) || directories.has(parts[0]!) && path.endsWith('.md'))) invalid();
}
function assertSafeParts(path: string): void {
  const parts = path.split('/');
  if (path.length > 1000 || parts.length > 20 || /[\\:\x00-\x1f\x7f]/.test(path)
    || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^\.(git|amem)$/i.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) invalid();
}
async function managedFiles(root: string): Promise<string[]> {
  const result: string[] = []; let count = 0;
  const walk = async (path: string, depth: number) => {
    if (++count > 10_000 || depth > 20 || result.length > 5000) tooLarge();
    for (const entry of await readdir(path, { withFileTypes: true })) {
      throwIfCancelled(); const full = join(path, entry.name), name = relative(root, full).split(sep).join('/');
      if (path === root && entry.name === '.amem') continue;
      if (entry.isSymbolicLink()) invalid();
      if (entry.isDirectory()) { assertSafeParts(name); if (!directories.has(name.split('/')[0]!)) invalid(); await walk(full, depth + 1); }
      else { assertManagedPath(name); if (!entry.isFile()) invalid(); result.push(name); }
    }
  };
  await walk(root, 0); return result;
}
async function ensureManagedParents(root: string, path: string) {
  let current = root; for (const part of dirname(path).split('/')) { if (part === '.') continue; current = join(current, part); await createDirectory(current); }
}
async function diskBytes(root: string): Promise<number> {
  let bytes = 0, entries = 0;
  const walk = async (path: string, depth: number) => {
    throwIfCancelled(); if (++entries > 50_000 || depth > 40) tooLarge();
    let meta; try { meta = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (meta.isSymbolicLink()) invalid();
    if (meta.isDirectory()) {
      let children; try { children = await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      for (const entry of children) await walk(join(path, entry), depth + 1);
    }
    else if (meta.isFile() && meta.nlink === 1) bytes += meta.size; else invalid();
  };
  await walk(root, 0); return bytes;
}
async function clearGitLocks(gitDir: string) {
  // The outer refresh lock owns all Git commands in this disposable cache.
  // Git's terminated helpers may leave these files after cancellation/crash.
  for (const name of ['index.lock', 'HEAD.lock', 'config.lock', 'packed-refs.lock', 'shallow.lock',
    'refs/heads/main.lock', 'refs/remotes/shared/current.lock']) {
    const path = join(gitDir, name);
    if (!await exists(path)) continue;
    const meta = await lstat(path); if (!meta.isFile() || meta.nlink !== 1) invalid();
    await rm(path);
  }
}
async function removeAbandonedStages(root: string) {
  const runtime = join(root, '.amem');
  for (const name of await readdir(runtime)) {
    throwIfCancelled();
    if (!/^stage-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(name)) continue;
    const path = join(runtime, name), identity = await directoryIdentity(path), files = await readdir(path);
    if (files.length > 5000) tooLarge();
    // Only the reserved layout written by this cache is disposable. Never
    // descend into an unexpected directory or remove private host/key files.
    for (const file of files) {
      throwIfCancelled(); const meta = await lstat(join(path, file));
      if (!/^[a-f0-9]{64}$/.test(file) || !meta.isFile() || meta.nlink !== 1) invalid();
    }
    await assertDirectories([identity]);
    for (const file of files) { throwIfCancelled(); await rm(join(path, file)); }
    await assertDirectories([identity]); await rm(path, { recursive: true });
  }
}
async function removeEmptyManagedDirectories(root: string) {
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      throwIfCancelled(); const full = join(path, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      await walk(full);
    }
    if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
  };
  for (const name of directories) if (await exists(join(root, name))) await walk(join(root, name));
}
async function createDirectory(path: string): Promise<boolean> {
  let created = false;
  try { await mkdir(path, { mode: 0o700 }); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await directoryIdentity(path); return created;
}
async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  const meta = await lstat(path); if (!meta.isDirectory() || meta.isSymbolicLink()) invalid(); return { path, dev: meta.dev, ino: meta.ino };
}
async function directoryChain(root: string, parts: string[]) {
  const identities = [await directoryIdentity(root)]; let current = root;
  for (const part of parts) { current = join(current, part); await createDirectory(current); identities.push(await directoryIdentity(current)); }
  return identities;
}
async function assertDirectories(identities: DirectoryIdentity[]) {
  for (const identity of identities) { const current = await directoryIdentity(identity.path); if (current.dev !== identity.dev || current.ino !== identity.ino) invalid(); }
}
async function writeRegular(path: string, bytes: Buffer, exclusive = false) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | (exclusive ? constants.O_EXCL : 0), 0o600);
  try { const meta = await handle.stat(); if (!meta.isFile() || meta.nlink !== 1) invalid(); await handle.truncate(0); await handle.writeFile(bytes); } finally { await handle.close(); }
}
async function exists(path: string) {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function invalid(): never { throw new AgentMemoryError('CONFIG_INVALID', 'Shared Git cache, source ownership or managed tree is invalid'); }
function tooLarge(): never { throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Shared Git cache or managed tree exceeds its resource limit'); }
