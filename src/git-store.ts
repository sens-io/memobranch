import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AgentMemoryError, redactSecrets } from './errors.js';
import type { Actor } from './types.js';
import { nowIso, writeText } from './utils.js';

const execFileAsync = promisify(execFile);
const trackedPaths = ['evidence', 'candidates', 'wiki', 'MEMORY.md', 'INDEX.md', 'log.md', 'agent-memory.json', 'agent-memory.json.v1.bak', 'AGENTS.md'];

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

  async run(args: string[], options: { allowFailure?: boolean; actor?: Actor } = {}): Promise<string> {
    const actor = options.actor;
    const email = actor?.email ?? `${safeIdentity(actor?.id ?? 'system')}@agent-memory.local`;
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.root,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_DIR: this.gitDir,
          GIT_WORK_TREE: this.root,
          GIT_AUTHOR_NAME: actor?.name ?? 'Agent Memory',
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: actor?.name ?? 'Agent Memory',
          GIT_COMMITTER_EMAIL: email,
        },
      });
      return stdout.trim();
    } catch (error) {
      if (options.allowFailure) return '';
      const details = error as { code?: string; stderr?: string; message?: string };
      if (details.code === 'ENOENT') throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Git executable was not found; install Git and ensure it is on PATH');
      const code = ['fetch', 'push', 'remote'].includes(args[0] ?? '') ? 'REMOTE_TRANSPORT' : 'GIT_OPERATION_FAILED';
      throw new AgentMemoryError(code, redactSecrets(details.stderr?.trim() || details.message || 'Git operation failed'));
    }
  }

  async initialize(): Promise<void> {
    if (existsSync(join(this.gitDir, 'HEAD'))) return;
    await mkdir(this.gitDir, { recursive: true });
    try {
      await execFileAsync('git', ['init', '--bare', this.gitDir], { cwd: this.root });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Git executable was not found; install Git and ensure it is on PATH');
      throw error;
    }
    await this.run(['config', 'core.bare', 'false']);
    await this.run(['config', 'core.worktree', this.root]);
    await this.run(['config', 'user.name', 'Agent Memory']);
    await this.run(['config', 'user.email', 'system@agent-memory.local']);
    await this.run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  }

  async commit(message: string, actor: Actor): Promise<string | null> {
    const availablePaths: string[] = [];
    for (const path of trackedPaths) {
      if (existsSync(join(this.root, path)) || await this.run(['ls-files', '--', path], { allowFailure: true })) availablePaths.push(path);
    }
    await this.run(['add', '-A', '--', ...availablePaths], { actor });
    const hasChanges = await this.hasStagedChanges();
    if (!hasChanges) return null;
    await this.run(['commit', '--no-gpg-sign', '-m', message], { actor });
    return this.run(['rev-parse', 'HEAD']);
  }

  async configureRemote(name: string, url: string): Promise<void> {
    validateRemote(name, url);
    await this.initialize();
    const existing = await this.run(['remote', 'get-url', name], { allowFailure: true });
    if (existing) await this.run(['remote', 'set-url', name, url]);
    else await this.run(['remote', 'add', name, url]);
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
          const conflicts = (await this.run(['diff', '--name-only', '--diff-filter=U'], { allowFailure: true })).split('\n').filter(Boolean);
          await this.run(['merge', '--abort'], { allowFailure: true });
          throw new AgentMemoryError('REMOTE_CONFLICT', 'Remote synchronization produced conflicts; the merge was aborted', {
            cause: error instanceof Error ? redactSecrets(error.message) : 'Git merge failed',
            conflicts,
          });
        }
      }
      merged = true;
      await options.reconcile?.();
    }
    try {
      await options.validate?.();
    } catch (error) {
      throw new AgentMemoryError('REMOTE_CONFLICT', 'Local synchronized state failed vault validation', {
        cause: error instanceof Error ? redactSecrets(error.message) : String(error),
      });
    }
    let pushed = false;
    if (options.push) {
      await this.run(['push', name, `HEAD:${branch}`], options.actor ? { actor: options.actor } : {});
      pushed = true;
    }
    await writeText(join(this.root, '.amem', 'sync-state.json'), `${JSON.stringify({ lastSuccessfulSync: nowIso() }, null, 2)}\n`);
    return { ...(await this.remoteStatus(name, branch, true)), pushed, merged };
  }

  async integrity(): Promise<GitIntegrity> {
    if (!existsSync(join(this.gitDir, 'HEAD'))) return { healthy: false, head: null, dirty: false, error: 'Git store is not initialized' };
    try {
      const fsck = await this.run(['fsck', '--no-dangling']);
      const head = await this.run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
      const status = await this.run(['status', '--porcelain', '--', ...trackedPaths], { allowFailure: true });
      return { healthy: !fsck.toLowerCase().includes('error'), head: head || null, dirty: Boolean(status), ...(fsck ? { error: fsck } : {}) };
    } catch (error) {
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

  private async hasStagedChanges(): Promise<boolean> {
    try {
      await execFileAsync('git', ['diff', '--cached', '--quiet'], {
        cwd: this.root,
        env: { ...process.env, GIT_DIR: this.gitDir, GIT_WORK_TREE: this.root },
      });
      return false;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 1) return true;
      throw error;
    }
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

function safeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

export function validateRemote(name: string, url: string): void {
  validateRemoteName(name);
  if (!url.trim() || /[\r\n]/.test(url)) throw new AgentMemoryError('REMOTE_INVALID', 'Remote URL is invalid');
  try {
    const parsed = new URL(url);
    const secretParameter = [...parsed.searchParams.keys()].find((key) => /^(?:access_?token|auth|api_?key|password|token)$/i.test(key));
    if (parsed.username || parsed.password || secretParameter) throw new AgentMemoryError('REMOTE_INVALID', 'Credential-bearing remote URLs are not allowed');
    if (!['https:', 'ssh:', 'file:'].includes(parsed.protocol)) throw new AgentMemoryError('REMOTE_INVALID', `Unsupported remote protocol: ${parsed.protocol}`);
  } catch (error) {
    if (error instanceof AgentMemoryError) throw error;
    if (url.includes('://')) throw new AgentMemoryError('REMOTE_INVALID', 'Remote URL is invalid');
    if (/^[^/\\]+@[^:]+:/.test(url)) return;
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
