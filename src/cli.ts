#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { memoryKinds, scopes, sensitivities, type Actor, type MemoryKind, type Scope, type Sensitivity } from './types.js';
import { MemoryVault } from './vault.js';

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.flags.has('help') || parsed.command === 'help') {
    process.stdout.write(help());
    return;
  }
  const root = resolve(flagString(parsed, 'root') ?? process.cwd());
  const vault = new MemoryVault(root);
  const actor = actorFrom(parsed);

  switch (parsed.command) {
    case 'init': {
      const initRoot = resolve(parsed.positionals[0] ?? root);
      print(await new MemoryVault(initRoot).initialize(flagString(parsed, 'name')));
      return;
    }
    case 'capture': {
      const content = await contentFrom(parsed);
      const sourceUri = flagString(parsed, 'source');
      print(
        await vault.capture({
          content,
          actor,
          ...(sourceUri ? { sourceUri } : {}),
          scope: enumFlag(parsed, 'scope', scopes, 'user'),
          sensitivity: enumFlag(parsed, 'sensitivity', sensitivities, 'internal'),
          extract: flagBoolean(parsed, 'extract'),
        }),
      );
      return;
    }
    case 'extract': {
      print(await vault.extract(requiredPositional(parsed, 0, 'evidence id'), actor));
      return;
    }
    case 'propose': {
      const statement = await contentFrom(parsed);
      const key = flagString(parsed, 'key');
      if (!key) throw new Error('--key is required');
      const expiresAt = flagString(parsed, 'expires-at');
      print(
        await vault.propose(
          {
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
          },
          csvFlag(parsed, 'evidence'),
          actor,
        ),
      );
      return;
    }
    case 'consolidate':
      print(await vault.consolidate(actor));
      return;
    case 'approve':
      print(await vault.approve(requiredPositional(parsed, 0, 'candidate id'), actor));
      return;
    case 'reject': {
      const reason = flagString(parsed, 'reason');
      if (!reason) throw new Error('--reason is required');
      print(await vault.reject(requiredPositional(parsed, 0, 'candidate id'), reason, actor));
      return;
    }
    case 'forget': {
      const reason = flagString(parsed, 'reason');
      if (!reason) throw new Error('--reason is required');
      print(await vault.forget(requiredPositional(parsed, 0, 'memory id or key'), reason, actor));
      return;
    }
    case 'search': {
      const query = parsed.positionals.join(' ').trim();
      if (!query) throw new Error('A search query is required');
      print(await vault.search(query, searchOptions(parsed)));
      return;
    }
    case 'context': {
      const query = parsed.positionals.join(' ').trim();
      if (!query) throw new Error('A context query is required');
      process.stdout.write(`${await vault.context(query, { ...searchOptions(parsed), maxCharacters: numberFlag(parsed, 'max-chars', 12_000) })}\n`);
      return;
    }
    case 'ask': {
      const question = parsed.positionals.join(' ').trim();
      if (!question) throw new Error('A question is required');
      process.stdout.write(`${await vault.answer(question, { ...searchOptions(parsed), maxCharacters: numberFlag(parsed, 'max-chars', 12_000) })}\n`);
      return;
    }
    case 'get': {
      const document = await vault.get(requiredPositional(parsed, 0, 'document id'));
      print(document);
      return;
    }
    case 'doctor':
      print(await vault.doctor());
      return;
    case 'history':
      print(await vault.history(numberFlag(parsed, 'limit', 20), flagString(parsed, 'path')));
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const command = args.shift() ?? '';
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value) continue;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [rawName = '', inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) {
      flags.set(rawName, inline);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(rawName, next);
      index++;
    } else {
      flags.set(rawName, true);
    }
  }
  return { command, positionals, flags };
}

async function contentFrom(args: ParsedArgs): Promise<string> {
  const file = flagString(args, 'file');
  if (file) return readFile(resolve(file), 'utf8');
  const content = args.positionals.join(' ').trim();
  if (content !== '-') {
    if (!content) throw new Error('Content is required (argument, --file, or - for stdin)');
    return content;
  }
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

function searchOptions(args: ParsedArgs) {
  return {
    limit: numberFlag(args, 'limit', 8),
    includeSensitive: flagBoolean(args, 'include-sensitive'),
    includeSecret: flagBoolean(args, 'include-secret'),
    includeEvidence: flagBoolean(args, 'include-evidence'),
    includeCandidates: flagBoolean(args, 'include-candidates'),
    expandLinks: !flagBoolean(args, 'no-expand'),
  };
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
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

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): string {
  return `Agent Memory Wiki (amem)

Usage:
  amem init [path] [--name NAME]
  amem capture <text|-> [--root PATH] [--extract] [--scope user|project|team|public]
  amem extract <evidence-id> [--root PATH]
  amem propose <statement> --key KEY [--kind fact] [--explicit] [--evidence path,...]
  amem consolidate [--root PATH]
  amem approve <candidate-id> [--root PATH]
  amem reject <candidate-id> --reason TEXT [--root PATH]
  amem forget <memory-id|key> --reason TEXT [--root PATH]
  amem search <query> [--limit 8] [--include-evidence]
  amem context <query> [--max-chars 12000]
  amem ask <question> [--max-chars 12000]
  amem get <id>
  amem doctor
  amem history [--limit 20] [--path wiki/...]

LLM extraction/answers use AMEM_LLM_API_KEY, AMEM_LLM_MODEL, and AMEM_LLM_BASE_URL.
Every mutation accepts --actor, --actor-name, and --actor-email for Git attribution.
`;
}

main().catch((error: unknown) => {
  process.stderr.write(`amem: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
