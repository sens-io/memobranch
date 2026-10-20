import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentMemoryError } from './errors.js';
import { principalFromEnv } from './policy.js';
import { sha256, withFileLock } from './utils.js';
import { MemoryVault } from './vault.js';

export interface ClientSetupOptions {
  client: 'claude-code';
  configPath: string;
  vaultRoot: string;
  permissions?: 'read' | 'read,write';
}
export interface ClientSetupEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}
export interface ClientSetupPlan {
  version: 1;
  client: 'claude-code';
  configPath: string;
  vaultRoot: string;
  expectedRevision: string;
  entryName: 'memobranch';
  entry: ClientSetupEntry;
  change: 'add' | 'unchanged';
  diagnostics: { vaultReady: true; tenantBound: true; modelConfigured: boolean; automaticMemory: false };
  instructions: string[];
}
interface SetupState {
  version: 1;
  configPath: string;
  vaultRoot: string;
  entry: ClientSetupEntry;
  backupPath: string | null;
}
const MAX_CONFIG_BYTES = 1_048_576;
const MISSING = 'missing';

/** Read-only preview. It does not spawn a server or create client/vault files. */
export async function previewClientSetup(options: ClientSetupOptions): Promise<ClientSetupPlan> {
  const normalized = normalize(options);
  const config = await new MemoryVault(normalized.vaultRoot).config();
  const current = await readConfig(normalized.configPath);
  const entry = makeEntry(normalized.vaultRoot, config.tenantId, normalized.permissions);
  const existing = servers(current.json).memobranch;
  if (existing !== undefined && !same(existing, entry)) fail('A different memobranch server already exists; it will not be overwritten');
  return {
    version: 1, client: 'claude-code', configPath: normalized.configPath, vaultRoot: normalized.vaultRoot,
    expectedRevision: current.revision, entryName: 'memobranch', entry, change: existing === undefined ? 'add' : 'unchanged',
    diagnostics: { vaultReady: true, tenantBound: true, modelConfigured: Boolean(process.env.AMEM_LLM_API_KEY || process.env.OPENAI_API_KEY), automaticMemory: false },
    instructions: [
      'Apply explicitly with the displayed expected revision. Existing configuration is backed up before a change.',
      'Claude Code may request project trust and approval for this MCP server. Then inspect /mcp or claude mcp get memobranch.',
      'This installs MCP tools. Automatic prompt recall and completed-turn capture are available only in the opt-in Harness integration.',
      'Model credentials and encryption keys remain in the launching environment and are never copied into this configuration.',
    ],
  };
}

/** Reconstructs the requested entry rather than trusting a caller-edited plan. */
export async function applyClientSetup(plan: ClientSetupPlan): Promise<{ applied: boolean; revision: string; backupPath: string | null; statePath: string }> {
  if (plan.version !== 1 || plan.entryName !== 'memobranch' || typeof plan.expectedRevision !== 'string') fail('Invalid setup preview');
  const permissions = plan.entry.env.AMEM_PERMISSIONS;
  if (permissions !== 'read' && permissions !== 'read,write') fail('Setup permissions must be read or read,write');
  const options = normalize({ client: plan.client, configPath: plan.configPath, vaultRoot: plan.vaultRoot, permissions });
  await mkdir(dirname(options.configPath), { recursive: true });
  return withFileLock(`${options.configPath}.memobranch.lock`, async () => {
    const currentPlan = await previewClientSetup(options);
    if (currentPlan.expectedRevision !== plan.expectedRevision) fail('Client configuration changed; create and review a new preview');
    if (!same(currentPlan.entry, plan.entry)) fail('Setup entry no longer matches the reviewed vault identity');
    const current = await readConfig(options.configPath);
    const statePath = `${options.configPath}.memobranch-state.json`;
    const state = await readState(statePath);
    if (currentPlan.change === 'unchanged') {
      // Never adopt a pre-existing entry merely because it happens to match.
      return { applied: false, revision: current.revision, backupPath: state?.backupPath ?? null, statePath };
    }
    if (state) fail('An existing setup ownership record needs inspection before a new installation');
    const next = { ...current.json, mcpServers: { ...servers(current.json), memobranch: currentPlan.entry } };
    const nextText = renderClientConfig(next);
    const backupPath = current.text === null ? null : `${options.configPath}.memobranch-backup-${randomUUID()}`;
    if (backupPath) await writeFile(backupPath, current.text!, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    // The backup/state files carry only this explicitly selected installation.
    // A crash before ownership is recorded leaves the client entry untouched by remove.
    await replaceChecked(options.configPath, current.revision, nextText);
    await atomicPrivateWrite(statePath, `${JSON.stringify({ version: 1, configPath: options.configPath, vaultRoot: options.vaultRoot, entry: currentPlan.entry, backupPath } satisfies SetupState, null, 2)}\n`);
    return { applied: true, revision: sha256(nextText), backupPath, statePath };
  });
}

export async function removeClientSetup(options: ClientSetupOptions & { expectedRevision?: string }): Promise<{ removed: boolean; revision: string; backupPath: string | null }> {
  const normalized = normalize(options);
  const statePath = `${normalized.configPath}.memobranch-state.json`;
  // An absent owner record is a read-only no-op; it must not create directories.
  const originalState = await readState(statePath);
  if (!originalState) return { removed: false, revision: (await readConfig(normalized.configPath)).revision, backupPath: null };
  if (!options.expectedRevision) fail('Review the current client configuration and pass its --expected-revision before removal');
  return withFileLock(`${normalized.configPath}.memobranch.lock`, async () => {
    const state = await readState(statePath);
    if (!state) return { removed: false, revision: (await readConfig(normalized.configPath)).revision, backupPath: null };
    if (state.configPath !== normalized.configPath || state.vaultRoot !== normalized.vaultRoot) fail('Setup ownership does not match this client and vault');
    const current = await readConfig(normalized.configPath);
    if (current.revision !== options.expectedRevision) fail('Client configuration changed; review it again before removal');
    const currentServers = servers(current.json);
    if (!same(currentServers.memobranch, state.entry)) fail('The installed server was changed; removal requires manual inspection');
    const nextServers = { ...currentServers };
    delete nextServers.memobranch;
    const next = { ...current.json, mcpServers: nextServers };
    const text = renderClientConfig(next);
    await replaceChecked(normalized.configPath, current.revision, text);
    await rm(statePath);
    return { removed: true, revision: sha256(text), backupPath: state.backupPath };
  });
}

/** Launches only the canonical generated server; never executes arbitrary commands
 * found in an existing client file. Only initialization and a read-only tool run.
 */
export async function verifyClientSetup(options: ClientSetupOptions): Promise<{ valid: true; connected: true; modelConfigured: boolean; automaticMemory: false; version: unknown }> {
  const preview = await previewClientSetup(options);
  if (preview.change !== 'unchanged') fail('The previewed server is not installed');
  const version = await probeServer(preview.entry);
  return { valid: true, connected: true, modelConfigured: preview.diagnostics.modelConfigured, automaticMemory: false, version };
}

function normalize(options: ClientSetupOptions): Required<ClientSetupOptions> {
  if (options.client !== 'claude-code') fail('Supported client: claude-code');
  if (!options.configPath?.trim() || !options.vaultRoot?.trim()) fail('An explicit client config file and vault root are required');
  const permissions = options.permissions ?? 'read';
  if (permissions !== 'read' && permissions !== 'read,write') fail('Setup permissions must be read or read,write');
  return { client: 'claude-code', configPath: resolve(options.configPath), vaultRoot: resolve(options.vaultRoot), permissions };
}

function makeEntry(vaultRoot: string, tenantId: string, permissions: string): ClientSetupEntry {
  return {
    type: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('../dist/mcp.js', import.meta.url)), vaultRoot],
    env: {
      AMEM_VAULT: vaultRoot, AMEM_ACTOR_ID: 'claude-code', AMEM_ACTOR_NAME: 'Claude Code',
      AMEM_TENANT_ID: tenantId, AMEM_PERMISSIONS: permissions,
      AMEM_ALLOWED_SCOPES: 'user,project,public', AMEM_MAX_SENSITIVITY: 'internal',
    },
  };
}

async function readConfig(path: string): Promise<{ text: string | null; json: Record<string, unknown>; revision: string }> {
  const text = await readRegular(path);
  if (text === null) return { text, json: {}, revision: MISSING };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail('Client configuration is not valid JSON'); }
  if (!isObject(parsed)) fail('Client configuration must be a JSON object');
  servers(parsed);
  return { text, json: parsed, revision: sha256(text) };
}

async function readRegular(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail('Client configuration and ownership records must be regular files, not symbolic links');
    if (info.size > MAX_CONFIG_BYTES) fail('Client configuration exceeds the 1 MiB limit');
    const buffer = await readFile(path);
    if (buffer.length > MAX_CONFIG_BYTES) fail('Client configuration exceeds the 1 MiB limit');
    return buffer.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readState(path: string): Promise<SetupState | null> {
  const text = await readRegular(path);
  if (text === null) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('Setup ownership record is invalid'); }
  if (!isObject(value) || value.version !== 1 || typeof value.configPath !== 'string' || typeof value.vaultRoot !== 'string'
      || !isObject(value.entry) || (value.backupPath !== null && typeof value.backupPath !== 'string')) fail('Setup ownership record is invalid');
  return value as unknown as SetupState;
}

function servers(json: Record<string, unknown>): Record<string, unknown> {
  const value = json.mcpServers;
  if (value === undefined) return {};
  if (!isObject(value)) fail('mcpServers must be a JSON object');
  return value;
}

async function replaceChecked(path: string, expectedRevision: string, text: string): Promise<void> {
  assertConfigOutputSize(text);
  if ((await readConfig(path)).revision !== expectedRevision) fail('Client configuration changed; create and review a new preview');
  const temporary = `${path}.memobranch-tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if ((await readConfig(path)).revision !== expectedRevision) fail('Client configuration changed while preparing the update');
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function atomicPrivateWrite(path: string, text: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function probeServer(entry: ClientSetupEntry): Promise<unknown> {
  // Ensure the same tenant/permission parsing as a fresh real client launch.
  principalFromEnv(entry.env);
  const child = spawn(entry.command, entry.args, { env: { ...process.env, ...entry.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let closed = false;
  const closedPromise = new Promise<void>((resolveClosed) => child.once('close', () => { closed = true; resolveClosed(); }));
  try {
    return await new Promise((resolveProbe, rejectProbe) => {
      let output = '';
      let received = 0;
      let settled = false;
      const timer = setTimeout(() => finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'MCP verification timed out; check that the package is built')), 8_000);
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectProbe(error); else resolveProbe(result);
      };
      const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
      child.on('error', () => finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'Could not start the packaged MCP server')));
      child.stdin.on('error', () => finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'MCP verification connection closed')));
      child.on('exit', () => { if (!settled) finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'MCP server exited before verification')); });
      child.stderr.on('data', (buffer: Buffer) => {
        if (settled) return;
        received += buffer.length;
        if (received > MAX_CONFIG_BYTES) finish(new AgentMemoryError('CONTENT_TOO_LARGE', 'MCP verification output exceeded its limit'));
      });
      child.stdout.on('data', (buffer: Buffer) => {
        if (settled) return;
        received += buffer.length;
        if (received > MAX_CONFIG_BYTES) return finish(new AgentMemoryError('CONTENT_TOO_LARGE', 'MCP verification output exceeded its limit'));
        output += buffer.toString('utf8');
        for (;;) {
          const newline = output.indexOf('\n');
          if (newline < 0 || settled) break;
          const line = output.slice(0, newline);
          output = output.slice(newline + 1);
          let response: unknown;
          try { response = JSON.parse(line); } catch { finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'MCP server returned an invalid protocol message')); break; }
          if (!isObject(response)) continue;
          if (response.error) { finish(new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'MCP verification request failed')); break; }
          if (response.id === 1) {
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_version', arguments: {} } });
          } else if (response.id === 2) {
            if (!isObject(response.result) || response.result.isError) finish(new AgentMemoryError('AUTHORIZATION_DENIED', 'MCP server could not read the selected vault with the generated identity'));
            else finish(undefined, response.result);
          }
        }
      });
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'memobranch-setup-verifier', version: '1' } } });
    });
  } finally {
    await stopProbeServer(child, () => closed, closedPromise);
  }
}

async function stopProbeServer(child: ChildProcessWithoutNullStreams, isClosed: () => boolean, closedPromise: Promise<void>): Promise<void> {
  child.stdin.destroy();
  if (isClosed()) return;
  child.kill('SIGTERM');
  if (await waitForClose(closedPromise, 500)) return;
  child.kill('SIGKILL');
  if (await waitForClose(closedPromise, 2_000)) return;
  // Bound cleanup even if the OS cannot report termination. The canonical
  // server does not create descendants; these streams belong to this child.
  child.stdout.destroy();
  child.stderr.destroy();
  child.unref();
  throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'MCP verification process did not close after termination');
}

async function waitForClose(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([closed.then(() => true), new Promise<false>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function renderClientConfig(value: Record<string, unknown>): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  assertConfigOutputSize(text);
  return text;
}

function assertConfigOutputSize(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) fail('Updated client configuration would exceed the 1 MiB limit; the original file was not changed');
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function same(left: unknown, right: unknown): boolean { return stable(left) === stable(right); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function fail(message: string): never { throw new AgentMemoryError('VALIDATION_FAILED', message); }
