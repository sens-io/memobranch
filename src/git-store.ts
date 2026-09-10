import { AsyncResource } from 'node:async_hooks';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentMemoryError, redactSecrets } from './errors.js';
import { cancellationError, operationSignal, recordCommit, throwIfCancelled, withoutCancellation } from './operation.js';
import type { Actor } from './types.js';
import { nowIso, writeText } from './utils.js';

const trackedPaths = ['evidence', 'candidates', 'wiki', 'MEMORY.md', 'INDEX.md', 'log.md', 'agent-memory.json', 'agent-memory.json.v1.bak', 'AGENTS.md', '.gitignore'];

export interface GitRunOptions {
  allowFailure?: boolean;
  actor?: Actor;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GitIntegrity {
  healthy: boolean;
  head: string | null;
  dirty: boolean;
  error?: string;
}

export interface RemoteStatus {
  configured: boolean;
  remote?: string;
  branch?: string;
  head?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  diverged: boolean;
  conflicts: string[];
  lastSuccessfulSync: string | null;
}

interface SyncIntent {
  version: 1;
  phase: 'prepared' | 'pushing' | 'accepted';
  originalHead: string;
  originalSyncState: string | null;
  baselineJournals: string[];
  push?: { url: string; branch: string; head: string };
  lastSuccessfulSync?: string;
}

export class GitStore {
  readonly gitDir: string;

  constructor(readonly root: string) {
    this.gitDir = join(root, '.amem', 'git');
  }

  async run(args: string[], options: GitRunOptions = {}): Promise<string> {
    const signal = options.signal ?? operationSignal();
    if (signal?.aborted) {
      const error = cancellationError();
      if (args[0] === 'push') throw new AgentMemoryError(error.code, error.message, { ...error.safeDetails, pushNotStarted: true });
      throw error;
    }
    const timeoutMs = gitTimeout(options.timeoutMs);
    const actor = options.actor;
    const email = actor?.email ?? `${safeIdentity(actor?.id ?? 'system')}@agent-memory.local`;
    try {
      const stdout = await executeGit(args, {
        cwd: this.root,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_DIR: this.gitDir,
          GIT_WORK_TREE: args[0] === 'init' ? undefined : this.root,
          GIT_AUTHOR_NAME: actor?.name ?? 'Agent Memory',
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: actor?.name ?? 'Agent Memory',
          GIT_COMMITTER_EMAIL: email,
        },
      }, signal, timeoutMs);
      return stdout.trim();
    } catch (error) {
      // Interrupted probes must not masquerade as absent refs or remotes.
      if (error instanceof AgentMemoryError) throw error;
      const details = error as { code?: string; stderr?: string; stdout?: string; message?: string };
      if (details.code === 'ENOENT') throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Git executable was not found; install Git and ensure it is on PATH');
      if (options.allowFailure) return '';
      const code = ['fetch', 'push', 'remote', 'ls-remote'].includes(args[0] ?? '') ? 'REMOTE_TRANSPORT' : 'GIT_OPERATION_FAILED';
      // Only a normally exited, single-ref porcelain rejection proves that the
      // remote did not accept this push. A timeout or lost response does not.
      const refspec = args.at(-1);
      const rejected = args[0] === 'push' && args.includes('--porcelain') && refspec?.startsWith('HEAD:refs/heads/')
        && details.stdout?.split('\n').some((line) => line.startsWith(`!\t${refspec}\t`));
      throw new AgentMemoryError(code, redactSecrets(details.stderr?.trim() || details.message || 'Git operation failed'), rejected ? { pushRejected: true } : undefined);
    }
  }

  async initialize(): Promise<void> {
    throwIfCancelled();
    if (existsSync(join(this.gitDir, 'HEAD'))) return;
    await mkdir(this.gitDir, { recursive: true });
    await this.run(['init', '--bare', this.gitDir]);
    await this.run(['config', 'core.bare', 'false']);
    await this.run(['config', 'core.worktree', this.root]);
    await this.run(['config', 'user.name', 'Agent Memory']);
    await this.run(['config', 'user.email', 'system@agent-memory.local']);
    await this.run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  }

  async commit(message: string, actor: Actor, paths: string[] = trackedPaths): Promise<string | null> {
    const availablePaths: string[] = [];
    for (const path of [...new Set(paths)]) {
      if (existsSync(join(this.root, path)) || await this.run(['ls-files', '--', path], { allowFailure: true })) availablePaths.push(path);
    }
    if (availablePaths.length === 0) return null;
    await this.run(['add', '-A', '--', ...availablePaths], { actor });
    const changedPaths = await this.stagedChanges(availablePaths);
    if (changedPaths.length === 0) return null;
    const originalHead = await this.run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    // A scoped add does not scope a normal commit: unrelated staged changes
    // must stay in the caller's index, including when a commit is retried.
    try {
      await this.run(['commit', '--only', '--no-gpg-sign', '-m', message, '--', ...changedPaths], { actor });
    } catch (error) {
      // A hook can time out after Git has advanced the ref. Settle that boundary
      // before a transaction decides whether it can restore its original files.
      let currentHead: string;
      try {
        currentHead = await withoutCancellation(() => this.run(['rev-parse', '--verify', 'HEAD']));
      } catch {
        // A missing outcome probe is not proof that the ref never advanced.
        // Keep ready recovery state instead of undoing a possibly durable write.
        throw new AgentMemoryError('GIT_OPERATION_FAILED', 'Git commit outcome is unknown; recovery is required', { commitOutcomeUnknown: true });
      }
      if (currentHead && currentHead !== originalHead) throw committedGitError(error, currentHead);
      throw error;
    }
    try {
      return await this.run(['rev-parse', 'HEAD']);
    } catch (error) {
      throw committedGitError(error);
    }
  }

  async configureRemote(name: string, url: string): Promise<void> {
    validateRemote(name, url);
    await this.initialize();
    const existing = await this.run(['remote', 'get-url', name], { allowFailure: true });
    if (existing) await this.run(['remote', 'set-url', name, url]);
    else await this.run(['remote', 'add', name, url]);
  }

  async getRemoteUrl(name: string): Promise<string | null> {
    validateRemoteName(name);
    return (await this.run(['remote', 'get-url', name], { allowFailure: true })) || null;
  }

  async removeRemote(name: string): Promise<void> {
    validateRemoteName(name);
    const existing = await this.run(['remote', 'get-url', name], { allowFailure: true });
    if (existing) await this.run(['remote', 'remove', name]);
  }

  async remoteStatus(name: string, branch: string, fetch = true): Promise<RemoteStatus> {
    validateRemoteName(name);
    validateBranch(branch);
    const configuredUrl = await this.run(['remote', 'get-url', name], { allowFailure: true });
    const lastSuccessfulSync = await this.lastSuccessfulSync();
    const conflicts = (await this.run(['diff', '--name-only', '--diff-filter=U'], { allowFailure: true })).split('\n').filter(Boolean);
    if (!configuredUrl) return { configured: false, ahead: 0, behind: 0, diverged: false, conflicts, lastSuccessfulSync };
    if (fetch) await this.run(['fetch', '--prune', name]);
    const head = await this.run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    const upstream = await this.run(['rev-parse', '--verify', `${name}/${branch}`], { allowFailure: true });
    if (!head || !upstream) {
      return { configured: true, remote: name, branch, head: head || null, upstream: upstream || null, ahead: head ? 1 : 0, behind: upstream ? 1 : 0, diverged: false, conflicts, lastSuccessfulSync };
    }
    const counts = await this.run(['rev-list', '--left-right', '--count', `HEAD...${name}/${branch}`]);
    const [ahead = 0, behind = 0] = counts.split(/\s+/).map(Number);
    return { configured: true, remote: name, branch, head, upstream, ahead, behind, diverged: ahead > 0 && behind > 0, conflicts, lastSuccessfulSync };
  }

  async sync(
    name: string,
    branch: string,
    options: { push?: boolean; actor?: Actor; reconcile?: () => Promise<void>; validate?: () => Promise<void> } = {},
  ): Promise<RemoteStatus & { pushed: boolean; merged: boolean }> {
    if (await this.pendingSyncSnapshot()) {
      throw new AgentMemoryError('TRANSACTION_RECOVERY_FAILED', 'A previous synchronization requires recovery before another sync can start');
    }
    const originalHead = await this.run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    if (!originalHead) throw new AgentMemoryError('REMOTE_CONFLICT', 'Synchronization requires an existing local commit');
    const syncStatePath = join(this.root, '.amem', 'sync-state.json');
    const originalSyncState = existsSync(syncStatePath) ? await readFile(syncStatePath, 'utf8') : null;
    const intent: SyncIntent = {
      version: 1,
      phase: 'prepared',
      originalHead,
      originalSyncState,
      baselineJournals: await this.transactionJournals(),
    };
    // This outer record owns the whole merge, including reconciliation journals.
    // It must exist before Git can replace the configuration or tracked files.
    await this.persistSyncIntent(intent);
    let pushed = false;
    try {
      const before = await this.remoteStatus(name, branch, true);
      if (!before.configured) throw new AgentMemoryError('REMOTE_INVALID', `Remote ${name} is not configured`);
      let merged = false;
      if (before.behind > 0) {
        if (before.ahead === 0) {
          await this.run(['merge', '--ff-only', `${name}/${branch}`], options.actor ? { actor: options.actor } : {});
        } else {
          try {
            await this.run(['merge', '--no-edit', '--no-gpg-sign', `${name}/${branch}`], options.actor ? { actor: options.actor } : {});
          } catch (error) {
            if (interruptedGit(error)) throw error;
            const conflicts = (await this.run(['diff', '--name-only', '--diff-filter=U'], { allowFailure: true })).split('\n').filter(Boolean);
            throw new AgentMemoryError('REMOTE_CONFLICT', 'Remote synchronization produced conflicts; the merge was aborted', {
              cause: error instanceof Error ? redactSecrets(error.message) : 'Git merge failed',
              conflicts,
            });
          }
        }
        merged = true;
        if (originalHead) await this.assertEvidenceAppendOnly(originalHead);
        await options.reconcile?.();
      }
      await options.validate?.();
      if (options.push) {
        const pushedHead = await this.run(['rev-parse', 'HEAD']);
        const pushUrls = (await this.run(['remote', 'get-url', '--push', '--all', name])).split('\n').filter(Boolean);
        if (pushUrls.length !== 1) throw new AgentMemoryError('REMOTE_INVALID', 'Recoverable synchronization requires exactly one push destination');
        const url = pushUrls[0]!;
        validateRemote(name, url);
        // Resolve the actual push endpoint before crossing the external commit
        // boundary. A missing destination is still a safe local rollback.
        await this.run(['ls-remote', '--refs', url, `refs/heads/${branch}`]);
        intent.phase = 'pushing';
        intent.push = { url, branch, head: pushedHead };
        await this.persistSyncIntent(intent);
        try {
          await this.run(['push', '--porcelain', name, `HEAD:refs/heads/${branch}`], options.actor ? { actor: options.actor } : {});
        } catch (error) {
          if (error instanceof AgentMemoryError && (error.safeDetails?.pushRejected === true || error.safeDetails?.pushNotStarted === true)) {
            // Persist the confirmed rejection before attempting compensation;
            // a failed reset must remain locally recoverable after restart.
            intent.phase = 'prepared';
            delete intent.push;
            await this.persistSyncIntent(intent);
          }
          throw error;
        }
        pushed = true;
        recordCommit('remote_sync', pushedHead);
        await withoutCancellation(async () => {
          intent.phase = 'accepted';
          intent.lastSuccessfulSync = nowIso();
          await this.persistSyncIntent(intent);
        });
      }
      const finish = async () => {
        // Push updates the tracking ref. Avoid a second network operation after
        // the externally committed step, which could hide a successful push.
        const status = await this.remoteStatus(name, branch, !pushed);
        const lastSuccessfulSync = nowIso();
        intent.phase = 'accepted';
        intent.lastSuccessfulSync = lastSuccessfulSync;
        await this.persistSyncIntent(intent);
        await writeText(syncStatePath, `${JSON.stringify({ lastSuccessfulSync }, null, 2)}\n`);
        await rm(this.syncIntentPath(), { force: true });
        return { ...status, lastSuccessfulSync, pushed, merged };
      };
      return pushed ? await withoutCancellation(finish) : await finish();
    } catch (error) {
      // A successful push is externally committed and cannot be rolled back here.
      // Keep the matching local revision so a retry is idempotent and does not
      // manufacture a local/remote divergence.
      if (!pushed && intent.phase === 'prepared') {
        try {
          await withoutCancellation(() => this.restoreSyncSnapshot(intent));
        } catch (rollbackError) {
          throw new AgentMemoryError(
            error instanceof AgentMemoryError ? error.code : 'REMOTE_CONFLICT',
            error instanceof AgentMemoryError ? error.message : 'Local synchronized state failed vault validation',
            {
              ...(error instanceof AgentMemoryError ? error.safeDetails : {}),
              recoveryRequired: true,
              rollbackCause: redactSecrets(rollbackError instanceof Error ? rollbackError.message : String(rollbackError)),
            },
          );
        }
      }
      if (pushed || intent.phase === 'accepted') {
        throw new AgentMemoryError(
          error instanceof AgentMemoryError ? error.code : 'GIT_OPERATION_FAILED',
          error instanceof AgentMemoryError ? error.message : 'Git push completed, but local synchronization bookkeeping failed',
          {
            ...(error instanceof AgentMemoryError ? error.safeDetails : { cause: redactSecrets(error instanceof Error ? error.message : String(error)) }),
            pushed,
            completed: true,
          },
        );
      }
      if (intent.phase === 'pushing') {
        // An interrupted transport may have updated the remote ref. Preserve
        // both local state and intent until an authorized recovery confirms it.
        throw new AgentMemoryError(
          error instanceof AgentMemoryError ? error.code : 'REMOTE_TRANSPORT',
          error instanceof AgentMemoryError ? error.message : 'Git push outcome is unknown; recovery is required',
          { ...(error instanceof AgentMemoryError ? error.safeDetails : {}), pushOutcomeUnknown: true, recoveryRequired: true },
        );
      }
      if (error instanceof AgentMemoryError) throw error;
      throw new AgentMemoryError('REMOTE_CONFLICT', 'Local synchronized state failed vault validation', {
        cause: error instanceof Error ? redactSecrets(error.message) : String(error),
      });
    }
  }

  async pendingSyncSnapshot(): Promise<{ originalHead: string } | null> {
    const intent = await this.readSyncIntent();
    return intent ? { originalHead: intent.originalHead } : null;
  }

  async recoverSync(options: { confirmPush?: () => Promise<void> } = {}): Promise<void> {
    const intent = await this.readSyncIntent();
    if (!intent) return;
    if (intent.phase === 'pushing') {
      if (!options.confirmPush) throw new AgentMemoryError('TRANSACTION_RECOVERY_FAILED', 'The pending push requires authorized remote confirmation');
      await options.confirmPush();
      const push = intent.push!;
      const remote = await this.run(['ls-remote', '--refs', push.url, `refs/heads/${push.branch}`]);
      const remoteHead = remote.split(/\s+/)[0];
      let accepted = remoteHead === push.head;
      if (!accepted && remoteHead && /^[a-f0-9]{40,64}$/.test(remoteHead)) {
        // A later remote commit can still prove the attempted push was accepted.
        await this.run(['fetch', '--no-tags', push.url, `refs/heads/${push.branch}`]);
        try { await this.run(['merge-base', '--is-ancestor', push.head, 'FETCH_HEAD']); accepted = true; }
        catch (error) { if (interruptedGit(error)) throw error; }
      }
      if (!accepted) throw new AgentMemoryError('TRANSACTION_RECOVERY_FAILED', 'The remote does not confirm the pending push; its local state and recovery intent were retained', { pushOutcomeUnknown: true });
      intent.phase = 'accepted';
      intent.lastSuccessfulSync = nowIso();
      await this.persistSyncIntent(intent);
    }
    if (intent.phase === 'prepared') await this.restoreSyncSnapshot(intent);
    else {
      await writeText(join(this.root, '.amem', 'sync-state.json'), `${JSON.stringify({ lastSuccessfulSync: intent.lastSuccessfulSync }, null, 2)}\n`);
      await rm(this.syncIntentPath(), { force: true });
    }
  }

  private syncIntentPath(): string {
    return join(this.root, '.amem', 'sync-intent.json');
  }

  private async persistSyncIntent(intent: SyncIntent): Promise<void> {
    await writeText(this.syncIntentPath(), `${JSON.stringify(intent, null, 2)}\n`);
  }

  private async readSyncIntent(): Promise<SyncIntent | null> {
    if (!existsSync(this.syncIntentPath())) return null;
    try {
      const value = JSON.parse(await readFile(this.syncIntentPath(), 'utf8')) as SyncIntent;
      if (value.version !== 1 || !['prepared', 'pushing', 'accepted'].includes(value.phase)
        || typeof value.originalHead !== 'string' || !/^[a-f0-9]{40,64}$/.test(value.originalHead)
        || (value.originalSyncState !== null && typeof value.originalSyncState !== 'string')
        || !Array.isArray(value.baselineJournals) || value.baselineJournals.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.json$/.test(name))) {
        throw new Error('Malformed synchronization snapshot');
      }
      if (value.push !== undefined) {
        validateRemote('recovery', value.push.url);
        validateBranch(value.push.branch);
        if (!/^[a-f0-9]{40,64}$/.test(value.push.head)) throw new Error('Malformed pending push');
      }
      if (value.phase === 'pushing' && !value.push) throw new Error('Missing pending push');
      if (value.phase === 'accepted' && (typeof value.lastSuccessfulSync !== 'string' || !Number.isFinite(Date.parse(value.lastSuccessfulSync)))) throw new Error('Missing accepted sync time');
      await this.run(['cat-file', '-e', `${value.originalHead}^{commit}`]);
      return value;
    } catch (error) {
      throw new AgentMemoryError('TRANSACTION_RECOVERY_FAILED', 'Invalid synchronization recovery intent', {
        cause: redactSecrets(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  private async transactionJournals(): Promise<string[]> {
    const directory = join(this.root, '.amem', 'transactions');
    return existsSync(directory) ? (await readdir(directory)).filter((name) => name.endsWith('.json')).sort() : [];
  }

  private async restoreSyncSnapshot(intent: SyncIntent): Promise<void> {
    await this.run(['merge', '--abort'], { allowFailure: true });
    await this.run(['reset', '--hard', intent.originalHead]);
    await this.run(['clean', '-fd', '--', ...trackedPaths]);
    const syncStatePath = join(this.root, '.amem', 'sync-state.json');
    if (intent.originalSyncState === null) await rm(syncStatePath, { force: true });
    else await writeText(syncStatePath, intent.originalSyncState);
    // Only the enclosing sync's journals are obsolete. Keep the outer intent
    // until every cleanup succeeds so crashes cannot replay rejected contents.
    for (const name of await this.transactionJournals()) {
      if (!intent.baselineJournals.includes(name)) await rm(join(this.root, '.amem', 'transactions', name), { force: true });
    }
    await rm(this.syncIntentPath(), { force: true });
  }

  private async assertEvidenceAppendOnly(originalHead: string): Promise<void> {
    const changes = await this.run(['diff', '--name-status', '--find-renames', originalHead, 'HEAD', '--', 'evidence']);
    const violations = changes.split('\n').filter(Boolean).filter((line) => !line.startsWith('A\t'));
    if (violations.length > 0) {
      throw new AgentMemoryError('REMOTE_CONFLICT', 'Remote synchronization attempted to modify or remove immutable evidence', {
        violations: violations.slice(0, 20),
      });
    }
  }

  async integrity(): Promise<GitIntegrity> {
    if (!existsSync(join(this.gitDir, 'HEAD'))) return { healthy: false, head: null, dirty: false, error: 'Git store is not initialized' };
    try {
      const fsck = await this.run(['fsck', '--no-dangling']);
      const head = await this.run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
      const status = await this.run(['status', '--porcelain', '--', ...trackedPaths], { allowFailure: true });
      return { healthy: !fsck.toLowerCase().includes('error'), head: head || null, dirty: Boolean(status), ...(fsck ? { error: fsck } : {}) };
    } catch (error) {
      if (interruptedGit(error)) throw error;
      return { healthy: false, head: null, dirty: false, error: error instanceof Error ? redactSecrets(error.message) : String(error) };
    }
  }

  private async lastSuccessfulSync(): Promise<string | null> {
    const path = join(this.root, '.amem', 'sync-state.json');
    if (!existsSync(path)) return null;
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as { lastSuccessfulSync?: unknown };
      return typeof value.lastSuccessfulSync === 'string' ? value.lastSuccessfulSync : null;
    } catch {
      return null;
    }
  }

  private async stagedChanges(paths: string[]): Promise<string[]> {
    // Resolve directories to changed files: Git cannot commit an empty directory
    // pathspec. Disable rename folding so both sides stay in the scoped commit.
    return (await this.run(['diff', '--cached', '--name-only', '--no-renames', '-z', '--', ...paths])).split('\0').filter(Boolean);
  }

  async history(limit = 20, path?: string): Promise<Array<Record<string, string>>> {
    if (!existsSync(join(this.gitDir, 'HEAD'))) return [];
    const format = '%H%x00%aI%x00%an%x00%ae%x00%s%x1e';
    const args = ['log', `--max-count=${limit}`, `--format=${format}`];
    if (path) args.push('--', path);
    const raw = await this.run(args, { allowFailure: true });
    return raw
      .split('\x1e')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [sha = '', date = '', author = '', email = '', subject = ''] = entry.split('\x00');
        return { sha, date, author, email, subject };
      });
  }
}

function committedGitError(error: unknown, commit?: string): AgentMemoryError {
  return new AgentMemoryError(
    error instanceof AgentMemoryError ? error.code : 'GIT_OPERATION_FAILED',
    error instanceof AgentMemoryError ? error.message : redactSecrets(error instanceof Error ? error.message : String(error)),
    { ...(error instanceof AgentMemoryError ? error.safeDetails : {}), commitCreated: true, ...(commit ? { commit } : {}) },
  );
}

function gitTimeout(explicit?: number): number {
  const value = explicit ?? (process.env.AMEM_GIT_TIMEOUT_MS === undefined ? 30_000 : Number(process.env.AMEM_GIT_TIMEOUT_MS));
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) {
    throw new AgentMemoryError('CONFIG_INVALID', 'Git timeout must be an integer between 1 and 300000 milliseconds');
  }
  return value;
}

function interruptedGit(error: unknown): error is AgentMemoryError {
  return error instanceof AgentMemoryError && (error.code === 'OPERATION_CANCELLED' || error.safeDetails?.timedOut === true);
}

/** Keep ownership of Git and its helper processes until they have stopped. */
function executeGit(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancellationError()); return; }
    const child = spawn('git', args, { ...options, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maxBuffer = 10 * 1024 * 1024;
    let outputBytes = 0;
    let failure: Error | undefined;
    let exitCode: number | null = null;
    let exited = false;
    let closed = false;
    let stopping = false;
    let stopped = false;
    let settled = false;
    const code = ['fetch', 'push', 'remote', 'ls-remote'].includes(args[0] ?? '') ? 'REMOTE_TRANSPORT' : 'GIT_OPERATION_FAILED';
    const finish = () => {
      if (settled || !closed || (stopping && !stopped)) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (failure) reject(failure);
      else if (exitCode !== 0) reject(Object.assign(new Error(`Git operation failed with exit code ${exitCode ?? 'unknown'}`), {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    };
    const stop = (reason: Error) => {
      if (settled || stopping) return;
      // A confirmed exit 0 has already completed Git's effects. Cancellation or
      // a deadline may still need to reap helpers holding its pipes, but must
      // not turn a completed push into a failure that rolls local HEAD back.
      const cleanupAfterSuccess = exited && exitCode === 0 && reason instanceof AgentMemoryError
        && (reason.code === 'OPERATION_CANCELLED' || reason.safeDetails?.timedOut === true);
      if (!cleanupAfterSuccess) failure = reason;
      stopping = true;
      void terminateGit(child).then(() => {
        stopped = true;
        finish();
      }, (error: unknown) => {
        failure = new AgentMemoryError(code, 'Could not terminate Git subprocesses', {
          cause: redactSecrets(error instanceof Error ? error.message : String(error)),
        });
        stopped = true;
        finish();
      });
    };
    // Abort may be dispatched outside the invoking operation's async context.
    const onAbort = AsyncResource.bind(() => stop(cancellationError()));
    const timeout = setTimeout(() => stop(new AgentMemoryError(code, `Git operation timed out after ${timeoutMs} milliseconds`, { timedOut: true, timeoutMs })), timeoutMs);
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBuffer) stop(new AgentMemoryError(code, 'Git operation exceeded the output limit'));
      else chunks.push(chunk);
    };
    child.stdout!.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr!.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.once('error', (error) => { failure ??= error; });
    child.once('exit', (status) => { exited = true; exitCode = status; });
    child.once('close', () => { closed = true; finish(); });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function terminateGit(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // taskkill traverses the Windows process tree, including SSH and credential
    // helpers. A direct child kill is the fallback when taskkill is unavailable.
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const fallback = () => { child.kill('SIGKILL'); };
      const deadline = setTimeout(() => { killer.kill(); fallback(); }, 1_000);
      killer.once('error', fallback);
      killer.once('close', (status) => { clearTimeout(deadline); if (status !== 0) fallback(); resolve(); });
    });
    return;
  }
  const killGroup = (signal: NodeJS.Signals) => {
    try { process.kill(-child.pid!, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  // Separate process groups catch shell/SSH helpers even when they ignore TERM
  // or close stdio. Escalation must finish even if the Git leader closes first.
  killGroup('SIGTERM');
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  killGroup('SIGKILL');
  // Signal delivery precedes actual process exit. Keep the caller's lock until
  // the group has exited, including helpers that no longer own a stdout pipe.
  while (true) {
    try { process.kill(-child.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    // Container init processes may leave terminated orphans as zombies. Those
    // cannot execute; waiting for their PID removal could otherwise never end.
    if (process.platform === 'linux' && !await hasRunningLinuxGroup(child.pid)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function hasRunningLinuxGroup(group: number): Promise<boolean> {
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const [state, , processGroup] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(processGroup) === group && state !== 'Z' && state !== 'X') return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ESRCH' && code !== 'EACCES') throw error;
    }
  }
  return false;
}

function safeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

export function validateRemote(name: string, url: string): void {
  validateRemoteName(name);
  if (!url.trim() || /[\r\n]/.test(url)) throw new AgentMemoryError('REMOTE_INVALID', 'Remote URL is invalid');
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new AgentMemoryError('REMOTE_INVALID', 'Credential-bearing remote URLs are not allowed');
    if (!['https:', 'ssh:', 'file:'].includes(parsed.protocol)) throw new AgentMemoryError('REMOTE_INVALID', `Unsupported remote protocol: ${parsed.protocol}`);
  } catch (error) {
    if (error instanceof AgentMemoryError) throw error;
    if (url.includes('://')) throw new AgentMemoryError('REMOTE_INVALID', 'Remote URL is invalid');
    const scp = url.match(/^([^/\\:@]+)@([^:]+):(.+)$/);
    if (scp) {
      if (scp[1] !== 'git' || /[?#]/.test(scp[3] ?? '')) throw new AgentMemoryError('REMOTE_INVALID', 'Credential-bearing SCP remote URLs are not allowed');
      return;
    }
    if (!url.startsWith('/') && !url.startsWith('./') && !url.startsWith('../')) {
      throw new AgentMemoryError('REMOTE_INVALID', 'Remote must be an HTTPS, SSH, file, SCP-style, or local path URL');
    }
  }
}

function validateRemoteName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new AgentMemoryError('REMOTE_INVALID', 'Remote name contains invalid characters');
}

function validateBranch(branch: string): void {
  if (!branch || branch.startsWith('-') || /[\s~^:?*\\\[\]]/.test(branch) || branch.includes('..')) {
    throw new AgentMemoryError('REMOTE_INVALID', 'Remote branch name is invalid');
  }
}
