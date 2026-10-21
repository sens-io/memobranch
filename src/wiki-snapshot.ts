import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentMemoryError } from './errors.js';
import type { GitStore } from './git-store.js';
import { throwIfCancelled } from './operation.js';
import type { MarkdownDocument, MemoryMeta, VaultConfig } from './types.js';
import type { WikiPageMeta } from './wiki-types.js';

export interface WikiSnapshotOptions {
  commit: string;
  pageKeys: string[];
  includeSensitive?: boolean | undefined;
  includeSecret?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface WikiSnapshot {
  version: 1;
  kind: 'wiki-revision-view';
  commit: string;
  authorityHead: string;
  checkedAt: string;
  requestedKeys: string[];
  pages: Array<MarkdownDocument<MemoryMeta | WikiPageMeta> & { currentRevision: number }>;
  sources: Array<{ id: string; path: string; sha256: string }>;
  rules: Array<{ id: string; revision: number }>;
  warnings: string[];
}

export function snapshotOptions(value: unknown): WikiSnapshotOptions {
  const parsed = z.object({ commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    pageKeys: z.array(z.string().min(1).max(200)).min(1).max(25),
    includeSensitive: z.boolean().optional(), includeSecret: z.boolean().optional(),
    signal: z.instanceof(AbortSignal).optional(),
  }).strict().safeParse(value);
  if (!parsed.success || new Set(parsed.data.pageKeys).size !== parsed.data.pageKeys.length) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Use a full commit hash and 1–25 distinct page keys');
  }
  return parsed.data;
}

export function assertSnapshotPath(path: string, configuration = false): void {
  if (path.length > 1000 || !(configuration && path === 'agent-memory.json' || /^(?:wiki|evidence)\/.+\.md$/.test(path))
      || /[\\\x00-\x1f\x7f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || /^\.(git|amem)$/i.test(part))) {
    throw new AgentMemoryError('NOT_FOUND', 'Wiki snapshot or a required dependency is unavailable');
  }
}

/** Object reads only: no checkout, worktree, ref, index or source copy is created. */
export async function snapshotReader(git: GitStore, commit: string, config: VaultConfig) {
  const unavailable = () => new AgentMemoryError('NOT_FOUND', 'Wiki snapshot or a required dependency is unavailable');
  const run = (args: string[]) => git.run(['--no-replace-objects', ...args]);
  // Grafts can change ancestry; promisor stores can fetch missing objects on read.
  if (process.env.GIT_GRAFT_FILE || existsSync(join(git.gitDir, 'info', 'grafts'))
      || await git.run(['config', '--get-regexp', /(^remote\..*\.promisor$|^extensions\.partialclone$)/.source], { allowFailure: true })) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Wiki revision views require local full history without grafts or partial-clone configuration');
  }
  const head = await run(['rev-parse', '--verify', 'HEAD']);
  const dirty = () => run(['--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=normal', '--ignored=matching', '--', 'agent-memory.json', 'wiki', 'evidence']);
  if (await dirty()) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Commit or recover managed changes before reading a Wiki snapshot');
  }
  try {
    if (await run(['cat-file', '-t', commit]) !== 'commit') throw unavailable();
    await run(['merge-base', '--is-ancestor', commit, head]);
  } catch (error) { throwIfCancelled(); if (error instanceof AgentMemoryError && error.code !== 'GIT_OPERATION_FAILED') throw error; throw unavailable(); }
  let bytes = 0, documents = 0;
  const read = async (path: string) => {
    throwIfCancelled();
    assertSnapshotPath(path, true);
    const entry = await run(['ls-tree', '-l', '-z', commit, '--', `:(literal)${path}`]);
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\s+(\d+)\t([^\0]+)\0$/.exec(entry);
    if (!match || match[4] !== path) throw unavailable();
    bytes += Number(match[3]); documents++;
    if (Number(match[3]) > 10_000_000 || bytes > 20_000_000 || documents > 200) {
      throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Wiki snapshot exceeds 200 documents or 20 MB of stored records');
    }
    return run(['cat-file', 'blob', match[2]!]);
  };
  let historic: Record<string, unknown>;
  try { historic = JSON.parse(await read('agent-memory.json')) as Record<string, unknown>; }
  catch (error) { throwIfCancelled(); if (error instanceof AgentMemoryError) throw error; throw unavailable(); }
  if (!historic || typeof historic !== 'object' || Array.isArray(historic)
      || historic.version !== 2 || historic.vaultId !== config.vaultId || historic.tenantId !== config.tenantId) throw unavailable();
  return { head, read, async finish() {
    throwIfCancelled();
    if (await run(['rev-parse', '--verify', 'HEAD']) !== head || await dirty()) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Vault revision changed while reading the Wiki snapshot');
    }
  } };
}
