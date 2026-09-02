import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Actor } from './types.js';

const execFileAsync = promisify(execFile);
const trackedPaths = ['evidence', 'candidates', 'wiki', 'MEMORY.md', 'INDEX.md', 'log.md', 'agent-memory.json', 'AGENTS.md'];

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
      const details = error as { stderr?: string; message?: string };
      throw new Error(details.stderr?.trim() || details.message || 'Git operation failed');
    }
  }

  async initialize(): Promise<void> {
    if (existsSync(join(this.gitDir, 'HEAD'))) return;
    await mkdir(this.gitDir, { recursive: true });
    await execFileAsync('git', ['init', '--bare', this.gitDir], { cwd: this.root });
    await this.run(['config', 'core.bare', 'false']);
    await this.run(['config', 'core.worktree', this.root]);
    await this.run(['config', 'user.name', 'Agent Memory']);
    await this.run(['config', 'user.email', 'system@agent-memory.local']);
    await this.run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  }

  async commit(message: string, actor: Actor): Promise<string | null> {
    await this.run(['add', '-A', '--', ...trackedPaths], { actor });
    const hasChanges = await this.hasStagedChanges();
    if (!hasChanges) return null;
    await this.run(['commit', '--no-gpg-sign', '-m', message], { actor });
    return this.run(['rev-parse', 'HEAD']);
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
