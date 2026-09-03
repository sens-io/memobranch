#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { toAgentMemoryError } from './errors.js';
import { MaintenanceService } from './maintenance.js';
import { localAdminPrincipal, principalFromEnv } from './policy.js';
import { memoryKinds, scopes, sensitivities, type Actor, type MemoryKind, type Scope, type Sensitivity } from './types.js';
import { MemoryVault } from './vault.js';

const VERSION = '1.0.0';

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.flags.has('help') || parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    process.stdout.write(help());
    return;
  }
  if (parsed.command === 'version' || parsed.command === '--version' || parsed.command === '-V' || parsed.flags.has('version')) {
    print({ version: VERSION });
    return;
  }
  const root = resolve(flagString(parsed, 'root') ?? process.cwd());
  const actor = actorFrom(parsed);
  const principal = hasPolicyEnvironment() ? principalFromEnv() : localAdminPrincipal(actor);
  const vault = new MemoryVault(root, { principal });

  switch (parsed.command) {
    case 'init': {
      const initRoot = resolve(parsed.positionals[0] ?? root);
      print(await new MemoryVault(initRoot, { principal }).initialize(flagString(parsed, 'name')));
      return;
    }
    case 'config': {
      if (parsed.positionals[0] === 'migrate') print(await vault.migrate());
      else print(await vault.config());
      return;
    }
    case 'policy':
      print({ principal });
      return;
    case 'capture': {
      const content = await contentFrom(parsed);
      const sourceUri = flagString(parsed, 'source');
      print(await vault.capture({
        content,
        actor,
        ...(sourceUri ? { sourceUri } : {}),
        scope: enumFlag(parsed, 'scope', scopes, 'user'),
        sensitivity: enumFlag(parsed, 'sensitivity', sensitivities, 'internal'),
        extract: flagBoolean(parsed, 'extract'),
      }));
      return;
    }
    case 'extract':
      print(await vault.extract(requiredPositional(parsed, 0, 'evidence id'), actor));
      return;
    case 'propose': {
      const statement = await contentFrom(parsed);
      const key = flagString(parsed, 'key');
      if (!key) throw new Error('--key is required');
      const expiresAt = flagString(parsed, 'expires-at');
      print(await vault.propose({
        kind: enumFlag(parsed, 'kind', memoryKinds, 'fact') as MemoryKind,
        key,
        statement,
        scope: enumFlag(parsed, 'scope', scopes, 'user') as Scope,
        sensitivity: enumFlag(parsed, 'sensitivity', sensitivities, 'internal') as Sensitivity,
        confidence: numberFlag(parsed, 'confidence', 0.8),
        explicit: flagBoolean(parsed, 'explicit'),
        conditions: csvFlag(parsed, 'conditions'),
        tags: csvFlag(parsed, 'tags'),
        ...(expiresAt ? { expiresAt } : {}),
      }, csvFlag(parsed, 'evidence'), actor));
      return;
    }
    case 'consolidate':
      print(await vault.consolidate(actor));
      return;
    case 'approve':
      print(await vault.approve(requiredPositional(parsed, 0, 'candidate id'), actor));
      return;
    case 'reject': {
      const reason = requiredFlag(parsed, 'reason');
      print(await vault.reject(requiredPositional(parsed, 0, 'candidate id'), reason, actor));
      return;
    }
    case 'forget':
      print(await vault.forget(requiredPositional(parsed, 0, 'memory id or key'), requiredFlag(parsed, 'reason'), actor));
      return;
    case 'erase':
      print(await vault.erase(requiredPositional(parsed, 0, 'memory id or key'), requiredFlag(parsed, 'reason'), actor));
      return;
    case 'search': {
      const query = requiredText(parsed.positionals.join(' '), 'A search query is required');
      print(await vault.searchDetailed(query, searchOptions(parsed)));
      return;
    }
    case 'context': {
      const query = requiredText(parsed.positionals.join(' '), 'A context query is required');
      const context = await vault.context(query, { ...searchOptions(parsed), maxCharacters: numberFlag(parsed, 'max-chars', 12_000) });
      if (parsed.flags.has('json')) print({ context });
      else process.stdout.write(`${context}\n`);
      return;
    }
    case 'ask': {
      const question = requiredText(parsed.positionals.join(' '), 'A question is required');
      const answer = await vault.answer(question, { ...searchOptions(parsed), maxCharacters: numberFlag(parsed, 'max-chars', 12_000) });
      if (parsed.flags.has('json')) print({ answer });
      else process.stdout.write(`${answer}\n`);
      return;
    }
    case 'get':
      print(await vault.get(requiredPositional(parsed, 0, 'document id')));
      return;
    case 'doctor':
      print(await vault.doctor());
      return;
    case 'history':
      print(await vault.history(numberFlag(parsed, 'limit', 20), flagString(parsed, 'path')));
      return;
    case 'recover':
      print(await vault.recover());
      return;
    case 'reindex':
      print(await vault.reindex(flagBoolean(parsed, 'semantic')));
      return;
    case 'remote':
      await remoteCommand(vault, parsed);
      return;
    case 'maintenance':
      print(await new MaintenanceService(vault).runOnce());
      return;
    case 'serve':
      await serve(vault, parsed);
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

async function remoteCommand(vault: MemoryVault, args: ParsedArgs): Promise<void> {
  const action = args.positionals[0] ?? 'status';
  if (action === 'status') print(await vault.remoteStatus(!flagBoolean(args, 'no-fetch')));
  else if (action === 'sync') print(await vault.sync({ push: flagBoolean(args, 'push') }));
  else if (action === 'remove') print(await vault.configureRemote(null));
  else if (action === 'set') {
    const url = requiredPositional(args, 1, 'remote URL');
    print(await vault.configureRemote({
      name: flagString(args, 'name') ?? 'origin',
      url,
      branch: flagString(args, 'branch') ?? 'main',
      push: flagBoolean(args, 'push'),
    }));
  } else throw new Error(`Unknown remote action: ${action}`);
}

async function serve(vault: MemoryVault, args: ParsedArgs): Promise<void> {
  const service = new MaintenanceService(vault);
  const handle = await service.start({ host: flagString(args, 'host') ?? '127.0.0.1', port: numberFlag(args, 'port', 0) });
  print({ status: 'serving', host: handle.host, port: handle.port });
  await new Promise<void>((resolveStop) => {
    const stop = () => { void handle.stop().finally(resolveStop); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

function parseArgs(args: string[]): ParsedArgs {
  const command = args.shift() ?? '';
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [rawName = '', inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(rawName, inline);
    else {
      const next = args[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(rawName, next);
        index += 1;
      } else flags.set(rawName, true);
    }
  }
  return { command, positionals, flags };
}

async function contentFrom(args: ParsedArgs): Promise<string> {
  const file = flagString(args, 'file');
  if (file) return readFile(resolve(file), 'utf8');
  const content = args.positionals.join(' ').trim();
  if (content !== '-') return requiredText(content, 'Content is required (argument, --file, or - for stdin)');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function actorFrom(args: ParsedArgs): Actor {
  const id = flagString(args, 'actor') ?? process.env.AMEM_ACTOR_ID ?? 'human';
  const name = flagString(args, 'actor-name') ?? process.env.AMEM_ACTOR_NAME ?? id;
  const email = flagString(args, 'actor-email') ?? process.env.AMEM_ACTOR_EMAIL;
  return { id, name, ...(email ? { email } : {}) };
}

function hasPolicyEnvironment(): boolean {
  return ['AMEM_PERMISSIONS', 'AMEM_ALLOWED_SCOPES', 'AMEM_MAX_SENSITIVITY', 'AMEM_TENANT_ID'].some((name) => process.env[name] !== undefined);
}

function searchOptions(args: ParsedArgs) {
  return {
    limit: numberFlag(args, 'limit', 8),
    includeSensitive: flagBoolean(args, 'include-sensitive'),
    includeSecret: flagBoolean(args, 'include-secret'),
    includeEvidence: flagBoolean(args, 'include-evidence'),
    includeCandidates: flagBoolean(args, 'include-candidates'),
    expandLinks: !flagBoolean(args, 'no-expand'),
    semantic: flagBoolean(args, 'semantic'),
  };
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function requiredFlag(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function flagBoolean(args: ParsedArgs, name: string): boolean {
  const value = args.flags.get(name);
  return value === true || value === 'true' || value === '1';
}

function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const value = flagString(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function csvFlag(args: ParsedArgs, name: string): string[] {
  return (flagString(args, name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function enumFlag<T extends string>(args: ParsedArgs, name: string, values: readonly T[], fallback: T): T {
  const value = flagString(args, name) ?? fallback;
  if (!values.includes(value as T)) throw new Error(`--${name} must be one of: ${values.join(', ')}`);
  return value as T;
}

function requiredPositional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positionals[index];
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): string {
  return `Agent Memory Wiki ${VERSION}

Usage:
  amem init [path] [--name NAME]
  amem config [migrate] | policy | version
  amem capture <text|-> [--extract] [--scope SCOPE] [--sensitivity LEVEL]
  amem extract <evidence-id>
  amem propose <statement> --key KEY [--kind fact] [--explicit] [--evidence path,...]
  amem consolidate | approve <candidate-id> | reject <candidate-id> --reason TEXT
  amem forget <memory-id|key> --reason TEXT
  amem erase <memory-id|key> --reason TEXT
  amem search <query> [--semantic] [--include-sensitive] [--include-secret]
  amem context <query> | ask <question> | get <id> | history
  amem doctor | recover | reindex [--semantic] | maintenance
  amem remote set <url> [--name origin] [--branch main] [--push]
  amem remote status | remote sync [--push] | remote remove
  amem serve [--host 127.0.0.1] [--port 0]

Common options: --root PATH, --actor ID, --actor-name NAME, --actor-email EMAIL.
LLM: AMEM_LLM_API_KEY, AMEM_LLM_MODEL, AMEM_LLM_BASE_URL, AMEM_EMBEDDING_MODEL.
Security: AMEM_MASTER_KEY, AMEM_PERMISSIONS, AMEM_ALLOWED_SCOPES, AMEM_MAX_SENSITIVITY, AMEM_TENANT_ID.
`;
}

main().catch((error: unknown) => {
  const normalized = toAgentMemoryError(error);
  process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
  process.exitCode = normalized.exitCode;
});
