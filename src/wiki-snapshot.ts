import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentMemoryError } from './errors.js';
import { effectiveTimestamp } from './effective-time.js';
import type { GitStore } from './git-store.js';
import { throwIfCancelled } from './operation.js';
import type { MarkdownDocument, MemoryMeta, VaultConfig } from './types.js';
import type { WikiPageMeta } from './wiki-types.js';

export interface WikiSnapshotOptions {
  commit: string;
  at?: never;
  pageKeys: string[];
  includeSensitive?: boolean | undefined;
  includeSecret?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export type WikiDatedSnapshotOptions = Omit<WikiSnapshotOptions, 'commit' | 'at'> & { at: string; commit?: never };

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
  selection?: { kind: 'git-committer-time'; at: string; committedAt: string; traversal: 'first-parent'; scannedCommits: number };
}

export const snapshotOptionsSchema = z.object({ commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    pageKeys: z.array(z.string().min(1).max(200)).min(1).max(25),
    includeSensitive: z.boolean().optional(), includeSecret: z.boolean().optional(),
    signal: z.instanceof(AbortSignal).optional(),
  }).strict();

export const datedSnapshotOptionsSchema = snapshotOptionsSchema.omit({ commit: true }).extend({ at: z.string().min(1).max(64) });

export function snapshotOptions(value: unknown): WikiSnapshotOptions | WikiDatedSnapshotOptions {
  const parsed = z.union([snapshotOptionsSchema, datedSnapshotOptionsSchema]).safeParse(value);
  if (!parsed.success || new Set(parsed.data.pageKeys).size !== parsed.data.pageKeys.length) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Use exactly one full commit hash or recorded timestamp, and 1–25 distinct page keys');
  }
  return 'at' in parsed.data ? { ...parsed.data, at: recordedTimestamp(parsed.data.at) } : parsed.data;
}

function recordedTimestamp(value: unknown): string {
  try { return effectiveTimestamp(value); }
  catch { throw new AgentMemoryError('VALIDATION_FAILED', 'Recorded times require ISO timestamps with a timezone and at most millisecond precision'); }
}

async function recordedCommit(git: GitStore, head: string, at: string) {
  // Do not use --until: Git may stop early when ancestor clocks are out of order.
  // Notes, signatures and configurable display additions must not enter this parser.
  const history = await git.run(['--no-replace-objects', '--no-optional-locks', 'log', '--first-parent', '--max-count=2001',
    '--no-patch', '--no-notes', '--no-show-signature', '--no-decorate', '--no-color', '--format=%H%x00%cI', head, '--']);
  const lines = history ? history.split('\n') : [];
  for (const [index, line] of lines.slice(0, 2000).entries()) {
    throwIfCancelled();
    const match = /^(?:([a-f0-9]{40}|[a-f0-9]{64}))\0([^\0\r\n]+)$/.exec(line);
    if (!match) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid local Git recorded-time history');
    const committedAt = recordedTimestamp(match[2]);
    if (Date.parse(committedAt) <= Date.parse(at)) return { commit: match[1]!,
      selection: { kind: 'git-committer-time' as const, at, committedAt, traversal: 'first-parent' as const, scannedCommits: index + 1 } };
  }
  if (lines.length > 2000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Recorded-time Wiki selection exceeds 2000 local first-parent commits; use a full commit hash');
  throw new AgentMemoryError('NOT_FOUND', 'Wiki snapshot or a required dependency is unavailable');
}

export function assertSnapshotPath(path: string, configuration = false): void {
  if (path.length > 1000 || !(configuration && path === 'agent-memory.json' || /^(?:wiki|evidence)\/.+\.md$/.test(path))
      || /[\\\x00-\x1f\x7f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || /^\.(git|amem)$/i.test(part))) {
    throw new AgentMemoryError('NOT_FOUND', 'Wiki snapshot or a required dependency is unavailable');
  }
}

/** Object reads only: no checkout, worktree, ref, index or source copy is created. */
export async function snapshotReader(git: GitStore, selector: string | { at: string }, config: VaultConfig) {
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
  const resolved = typeof selector === 'string' ? { commit: selector, selection: undefined } : await recordedCommit(git, head, selector.at);
  const { commit, selection } = resolved;
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
  return { head, commit, selection, read, async finish() {
    throwIfCancelled();
    if (await dirty() || await run(['rev-parse', '--verify', 'HEAD']) !== head) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Vault revision changed while reading the Wiki snapshot');
    }
  } };
}
