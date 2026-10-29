import { AsyncResource } from 'node:async_hooks';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { AgentMemoryError } from './errors.js';
import { terminateGit } from './git-store.js';
import { cancellationError, operationSignal, throwIfCancelled } from './operation.js';

export const pdfSupervisorMarker = (token: string) => Buffer.from(`\nMEMOBRANCH_PDF_SETTLED:${token}\n`, 'ascii');

/** @internal Only trusted local adapters supply this command and cleanup callback. */
export async function runPdfSupervisor(command: { file: string; args: string[] }, request: { token: string; [key: string]: unknown },
  options: { cwd: string; env: NodeJS.ProcessEnv; end: number; maximum: number; cleanup?: () => Promise<void> }) {
  throwIfCancelled();
  const input = JSON.stringify(request) + '\n', marker = pdfSupervisorMarker(request.token);
  if (!/^[a-f0-9]{32}$/.test(request.token) || Buffer.byteLength(input) > 32768 || !Number.isSafeInteger(options.maximum) || options.maximum < 1) {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid owned PDF supervisor request');
  }
  if (performance.now() >= options.end) throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'PDF processing exceeded its execution deadline');
  const signal = operationSignal();
  return new Promise<{ out: Buffer; err: Buffer }>((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(command.file, command.args, {
      cwd: options.cwd, env: options.env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe','pipe','pipe'],
    });
    const output: Buffer[] = [], diagnostics: Buffer[] = [];
    let outBytes = 0, errBytes = 0, failure: unknown, forceTimer: ReturnType<typeof setTimeout> | undefined, forcing: Promise<void> | undefined;
    let finishing = false, cleanupAttempted = false;
    const cleanup = async () => { cleanupAttempted = true; await options.cleanup?.(); };
    const finish = (code: number | null) => {
      if (finishing) return; finishing = true;
      clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
      void (async () => {
        const stderr = Buffer.concat(diagnostics), settled = stderr.length >= marker.length && stderr.subarray(-marker.length).equals(marker);
        try {
          if (forcing) await forcing;
          if (!settled && child.pid && options.cleanup && !cleanupAttempted) await cleanup();
        } catch {
          throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Owned PDF process cleanup could not be confirmed; private work files were retained', { pdfCleanupUncertain: true });
        }
        if (failure) throw failure;
        if (signal?.aborted) throw cancellationError();
        if (!settled || code !== 0) throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Owned PDF supervisor failed or returned no completed cleanup receipt');
        const err = stderr.subarray(0, -marker.length);
        if (err.length > 65536) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF processor diagnostics exceeded limits');
        return { out: Buffer.concat(output), err };
      })().then(resolve, reject);
    };
    const stop = (reason: unknown) => {
      failure ??= reason;
      // EOF is the supervisor's cooperative cancellation/parent-death channel.
      child.stdin.end();
      forceTimer ??= setTimeout(() => {
        forcing = (async () => {
          try {
            if (process.platform !== 'win32') await terminateGit(child);
            else if (child.exitCode === null && child.signalCode === null && !child.kill('SIGKILL')) throw new Error('Owned supervisor did not stop');
          } finally { await cleanup(); }
          if (child.exitCode === null && child.signalCode === null) await new Promise<void>((done, failed) => {
            const exited = () => { clearTimeout(deadline); done(); };
            const deadline = setTimeout(() => { child.removeListener('exit', exited); failed(new Error('Owned supervisor exit could not be confirmed')); }, 1000);
            child.once('exit', exited);
          });
        })();
        // A dead leader can leave inherited pipes open. Settlement must not
        // depend on their close event; even failed cleanup returns an honest error.
        const forced = () => {
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
          if (child.exitCode === null && child.signalCode === null) child.unref();
          finish(child.exitCode);
        };
        void forcing.then(forced, forced);
      }, 1000);
    };
    const abort = AsyncResource.bind(() => stop(cancellationError()));
    const timer = setTimeout(() => stop(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'PDF processing exceeded its execution deadline')), Math.max(1, options.end - performance.now()));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (bytes: Buffer) => {
      outBytes += bytes.length;
      if (outBytes > options.maximum) stop(new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF processor exceeded its complete output limit'));
      else output.push(bytes);
    });
    child.stderr.on('data', (bytes: Buffer) => {
      errBytes += bytes.length;
      if (errBytes > 65536 + marker.length) stop(new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF processor diagnostics exceeded limits'));
      else diagnostics.push(bytes);
    });
    child.once('error', () => { failure ??= new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Owned PDF supervisor could not start'); });
    child.once('close', finish);
    child.stdin.write(input);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}
