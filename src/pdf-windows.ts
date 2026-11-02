import { randomBytes } from 'node:crypto';
import { win32 } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AgentMemoryError } from './errors.js';
import { withoutCancellation } from './operation.js';
import { runPdfSupervisor } from './pdf-supervisor.js';

export const WINDOWS_PDF_HOST_VERSION = '1.0.0';
const cleanupTimeout = 10_000;
/** @internal Fingerprinted, operator-provisioned native helper; never a request-selected launcher. */
export function windowsPdfHost(host: { path: string; sha256: string }) {
  const root = process.env.SystemRoot;
  if (!root || !win32.isAbsolute(root) || root.includes('\0')) throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Windows SystemRoot is unavailable');
  const safeCwd = win32.join(root, 'System32');
  const environment: NodeJS.ProcessEnv = { SystemRoot: root, PATH: safeCwd + ';' + root, LANG: 'C', LC_ALL: 'C' };
  const request = (operation: 'check' | 'check-work' | 'run' | 'cleanup', path: string, end: number, extra: Record<string, unknown> = {}) => ({
    version: 1, operation, root: path, parentPid: process.pid, deadline: Date.now() + Math.max(1, Math.floor(end - performance.now())),
    token: randomBytes(16).toString('hex'), ...extra,
  });
  const cleanup = (path: string) => withoutCancellation(async () => {
    const end = performance.now() + cleanupTimeout;
    await runPdfSupervisor({ file: host.path, args: [] }, request('cleanup', path, end), { cwd: safeCwd, env: environment, end, maximum: 8192 });
  });
  const check = async (operation: 'check' | 'check-work', path: string, timeoutMs: number) => {
    const end = performance.now() + timeoutMs;
    const value = await runPdfSupervisor({ file: host.path, args: [] }, request(operation, path, end), { cwd: safeCwd, env: environment, end, maximum: 8192 });
    if (value.out.toString('utf8').trim() !== `memobranch-pdf-host ${WINDOWS_PDF_HOST_VERSION}`) {
      throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Windows PDF host has an unsupported protocol/version');
    }
  };
  return {
    metadata: { sha256: host.sha256, version: WINDOWS_PDF_HOST_VERSION },
    checkRoot: (path: string, timeoutMs: number) => check('check', path, timeoutMs),
    checkWork: (path: string, timeoutMs: number) => check('check-work', path, timeoutMs),
    run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, end: number, maximum: number) {
      return runPdfSupervisor({ file: host.path, args: [] }, request('run', cwd, end, {
        executable: file, arguments: args, environment: Object.entries(env).filter((entry): entry is [string,string] => entry[1] !== undefined).map(([key,value]) => `${key}=${value}`),
      }), { cwd: safeCwd, env: environment, end, maximum, cleanup: () => cleanup(cwd) });
    },
    cleanup,
  };
}
export type WindowsPdfHost = ReturnType<typeof windowsPdfHost>;
