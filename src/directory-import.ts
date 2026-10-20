import { constants, type Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentMemoryError, toAgentMemoryError } from './errors.js';
import { throwIfCancelled } from './operation.js';
import { authorize } from './policy.js';
import type { Scope, Sensitivity } from './types.js';
import { sha256 } from './utils.js';
import type { CaptureResult, MemoryVault } from './vault.js';

const MAX_FILES = 100;
const MAX_BYTES = 5_000_000;
const MAX_FILE_BYTES = 1_000_000;
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
const extensions = new Set(['.md', '.markdown', '.txt']);

export interface DirectoryImportPlan {
  version: 1;
  root: string;
  files: Array<{ path: string; sourceUri: string; sha256: string; bytes: number }>;
  totalBytes: number;
  revision: string;
}

export interface ImportProgress {
  completed: number;
  total: number;
  sourceUri: string;
  result: CaptureResult;
}

/** CLI/local-library only: never register caller-controlled filesystem reads as a server tool. */
export async function previewDirectoryImport(directory: string): Promise<DirectoryImportPlan> {
  return (await scanDirectory(directory)).plan;
}

export async function applyDirectoryImport(vault: MemoryVault, input: DirectoryImportPlan,
  options: { scope?: Scope; sensitivity?: Sensitivity; onProgress?: (progress: ImportProgress) => void } = {}) {
  const config = await vault.config();
  const scope = options.scope ?? 'project';
  const sensitivity = options.sensitivity ?? 'internal';
  authorize(vault.principal, 'write', { tenantId: config.tenantId, scope, sensitivity });
  if (!input || input.version !== 1 || typeof input.root !== 'string' || !Array.isArray(input.files)
      || input.files.length > MAX_FILES || typeof input.revision !== 'string') {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid directory import preview');
  }
  const current = await scanDirectory(input.root);
  if (JSON.stringify(current.plan) !== JSON.stringify(input)) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Directory changed or preview was modified; create a new preview');
  }
  if (current.contents.some(content => content.trim().length > config.limits.maxContentCharacters)) {
    throw new AgentMemoryError('CONTENT_TOO_LARGE', 'An import source exceeds the vault content limit');
  }
  const entries: ImportProgress[] = [];
  try {
    for (const [index, file] of current.plan.files.entries()) {
      throwIfCancelled();
      const result = await vault.capture({ content: current.contents[index]!, sourceUri: file.sourceUri, scope, sensitivity, extract: false });
      const progress = { completed: index + 1, total: current.plan.files.length, sourceUri: file.sourceUri, result };
      entries.push(progress);
      options.onProgress?.(progress);
    }
    return { status: 'completed' as const, total: current.plan.files.length, entries, interruptedCommits: [] };
  } catch (error) {
    const failure = toAgentMemoryError(error);
    return { status: failure.code === 'OPERATION_CANCELLED' ? 'cancelled' as const : 'failed' as const,
      total: current.plan.files.length, entries,
      interruptedCommits: failure.safeDetails?.committed ?? [],
      error: { code: failure.code, message: failure.code === 'OPERATION_CANCELLED' ? 'Import cancelled; retry the unchanged preview to resume.' : 'Import stopped; completed evidence remains saved. Retry the unchanged preview.' } };
  }
}

async function scanDirectory(directory: string) {
  throwIfCancelled();
  if (typeof directory !== 'string' || !directory.trim()) throw new AgentMemoryError('VALIDATION_FAILED', 'An explicit source directory is required');
  const root = await realpath(resolve(directory));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new AgentMemoryError('VALIDATION_FAILED', 'Import source must be a directory');
  const files: DirectoryImportPlan['files'] = [];
  const contents: string[] = [];
  let totalBytes = 0;
  let visited = 0;
  const visit = async (directoryPath: string, depth: number) => {
    throwIfCancelled();
    if (depth > 12 || ++visited > 5000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Import directory traversal limit exceeded');
    if (await realpath(directoryPath) !== directoryPath) throw new AgentMemoryError('VALIDATION_FAILED', 'Import does not follow directory symlinks');
    const entries: Dirent[] = [];
    for await (const entry of await opendir(directoryPath)) {
      throwIfCancelled();
      entries.push(entry);
      if (entries.length + visited > 5000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Import directory entry limit exceeded');
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      throwIfCancelled();
      visited += 1;
      if (visited > 5000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Import directory traversal limit exceeded');
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      const file = join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) throw new AgentMemoryError('VALIDATION_FAILED', 'Import does not follow symbolic links');
      if (entry.isDirectory()) { await visit(file, depth + 1); continue; }
      if (!extensions.has(extname(entry.name).toLowerCase())) continue;
      if (!entry.isFile()) throw new AgentMemoryError('VALIDATION_FAILED', 'Import supports regular text files only');
      if (files.length >= MAX_FILES) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Import supports at most 100 files per preview');
      const bytes = await readBoundedFile(root, file);
      totalBytes += bytes.length;
      if (totalBytes > MAX_BYTES) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Import exceeds the 5 MB total limit');
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new AgentMemoryError('VALIDATION_FAILED', 'Import source must contain valid UTF-8 text'); }
      if (!content.trim() || content.includes('\0')) throw new AgentMemoryError('VALIDATION_FAILED', 'Import source must contain nonempty text without NUL bytes');
      contents.push(content);
      files.push({ path: relative(root, file).split(sep).join('/'), sourceUri: pathToFileURL(file).href,
        sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    }
  };
  await visit(root, 0);
  const currentRoot = await lstat(root);
  if (currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino || await realpath(root) !== root) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Import source directory changed during preview');
  }
  if (!files.length) throw new AgentMemoryError('VALIDATION_FAILED', 'No supported text or Markdown files found');
  const payload = { version: 1 as const, root, files, totalBytes };
  return { plan: { ...payload, revision: sha256(JSON.stringify(payload)) }, contents };
}

async function readBoundedFile(root: string, path: string): Promise<Buffer> {
  const canonical = await realpath(path);
  if (canonical !== path || !canonical.startsWith(`${root}${sep}`)) throw new AgentMemoryError('VALIDATION_FAILED', 'Import source escaped its directory');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const start = await handle.stat();
    if (!start.isFile()) throw new AgentMemoryError('VALIDATION_FAILED', 'Import supports regular files only');
    if (start.size > MAX_FILE_BYTES) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Import file exceeds the 1 MB limit');
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      throwIfCancelled();
      const buffer = Buffer.alloc(Math.min(65536, MAX_FILE_BYTES + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_FILE_BYTES) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Import file exceeds the 1 MB limit');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const end = await handle.stat();
    const pathStat = await lstat(path);
    if (pathStat.isSymbolicLink() || pathStat.dev !== end.dev || pathStat.ino !== end.ino ||
        start.size !== end.size || start.mtimeMs !== end.mtimeMs || start.ctimeMs !== end.ctimeMs || await realpath(path) !== path) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Import file changed while reading');
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
