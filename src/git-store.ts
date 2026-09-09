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

export class GitStore {
  readonly gitDir: string;

  constructor(readonly root: string) {
    this.gitDir = join(root, '.amem', 'git');
  }

  async run(args: string[], options: GitRunOptions = {}): Promise<string> {
    const signal = options.signal ?? operationSignal();
    if (signal?.aborted) throw cancellationError();
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
      const details = error as { code?: string; stderr?: string; message?: string };
      if (details.code === 'ENOENT') throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Git executable was not found; install Git and ensure it is on PATH');
      if (options.allowFailure) return '';
      const code = ['fetch', 'push', 'remote'].includes(args[0] ?? '') ? 'REMOTE_TRANSPORT' : 'GIT_OPERATION_FAILED';
      throw new AgentMemoryError(code, redactSecrets(details.stderr?.trim() || details.message || 'Git operation failed'));
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
    const originalHead = await this.run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    const syncStatePath = join(this.root, '.amem', 'sync-state.json');
    const originalSyncState = existsSync(syncStatePath) ? await readFile(syncStatePath, 'utf8') : null;
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
        await this.run(['push', name, `HEAD:${branch}`], options.actor ? { actor: options.actor } : {});
        pushed = true;
        recordCommit('remote_sync', pushedHead);
      }
      const finish = async () => {
        // Push updates the tracking ref. Avoid a second network operation after
        // the externally committed step, which could hide a successful push.
        const status = await this.remoteStatus(name, branch, !pushed);
        const lastSuccessfulSync = nowIso();
        await writeText(syncStatePath, `${JSON.stringify({ lastSuccessfulSync }, null, 2)}\n`);
        return { ...status, lastSuccessfulSync, pushed, merged };
      };
      return pushed ? await withoutCancellation(finish) : await finish();
    } catch (error) {
      // A successful push is externally committed and cannot be rolled back here.
      // Keep the matching local revision so a retry is idempotent and does not
      // manufacture a local/remote divergence.
      if (!pushed) await withoutCancellation(() => this.restoreSyncSnapshot(originalHead, syncStatePath, originalSyncState));
      if (pushed) {
        throw new AgentMemoryError(
          error instanceof AgentMemoryError ? error.code : 'GIT_OPERATION_FAILED',
          error instanceof AgentMemoryError ? error.message : 'Git push completed, but local synchronization bookkeeping failed',
          {
            ...(error instanceof AgentMemoryError ? error.safeDetails : { cause: redactSecrets(error instanceof Error ? error.message : String(error)) }),
            pushed: true,
            completed: true,
          },
        );
      }
      if (error instanceof AgentMemoryError) throw error;
      throw new AgentMemoryError('REMOTE_CONFLICT', 'Local synchronized state failed vault validation', {
        cause: error instanceof Error ? redactSecrets(error.message) : String(error),
      });
    }
  }

  private async restoreSyncSnapshot(head: string, syncStatePath: string, syncState: string | null): Promise<void> {
    await this.run(['merge', '--abort'], { allowFailure: true });
    if (head) {
      await this.run(['reset', '--hard', head], { allowFailure: true });
      await this.run(['clean', '-fd', '--', ...trackedPaths], { allowFailure: true });
    }
    if (syncState === null) await rm(syncStatePath, { force: true });
    else await writeText(syncStatePath, syncState);
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
      else if (exitCode !== 0) reject(Object.assign(new Error(`Git operation failed with exit code ${exitCode ?? 'unknown'}`), { stderr: Buffer.concat(stderr).toString('utf8') }));
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
