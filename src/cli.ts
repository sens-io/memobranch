#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { toAgentMemoryError } from './errors.js';
import { MaintenanceService } from './maintenance.js';
import { authorize, localAdminPrincipal, principalFromEnv } from './policy.js';
import { memoryKinds, scopes, sensitivities, type Actor, type MemoryKind, type Scope, type Sensitivity } from './types.js';
import { MemoryVault } from './vault.js';
import { startWebServer } from './web.js';

import { VERSION } from './version.js';
import { runIntegrationSetup } from './integration-cli.js';
import { applyDirectoryImport, previewDirectoryImport, readDirectoryImportPlan, readImportPreview, serializeDirectoryImportPlan } from './directory-import.js';
import { withOperation } from './operation.js';
import { applyWebImport, previewWebImport, readWebImportPlan, serializeWebImportPlan } from './web-import.js';
import { applyPdfImport, previewPdfImport, readPdfImportPlan, serializePdfImportPlan } from './pdf-import.js';
import { mergeOptionsSchema } from './wiki-merge.js';

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
    case 'memory': {
      const action = requiredPositional(parsed, 0, 'at or validity');
      if (action === 'at') {
        const key = flagString(parsed, 'key');
        print(await vault.memoriesAt(requiredPositional(parsed, 1, 'ISO timestamp'), {
          ...(key === undefined ? {} : { key }), includeUnknown: flagBoolean(parsed, 'include-unknown'),
          includeSensitive: flagBoolean(parsed, 'include-sensitive'), includeSecret: flagBoolean(parsed, 'include-secret'),
          offset: numberFlag(parsed, 'offset', 0), limit: numberFlag(parsed, 'limit', 30),
        }));
      } else if (action === 'validity') {
        if (!flagBoolean(parsed, 'confirm')) throw new Error('Time annotation requires --confirm');
        const from = requiredFlag(parsed, 'from'), until = requiredFlag(parsed, 'until');
        print(await vault.setMemoryValidity(requiredPositional(parsed, 1, 'memory ID'), {
          validFrom: from === 'unknown' ? null : from, validUntil: until === 'unknown' ? null : until,
          expectedRevision: numberFlag(parsed, 'expected-revision', 0),
        }));
      } else throw new Error('Memory action must be at or validity');
      return;
    }
    case 'import': {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try {
        await withOperation(controller.signal, async () => {
          const action = requiredPositional(parsed, 0, 'preview or apply');
          if (action === 'preview') {
            process.stdout.write(serializeDirectoryImportPlan(await previewDirectoryImport(requiredPositional(parsed, 1, 'source directory'))));
          } else if (action === 'apply') {
            const plan = await readDirectoryImportPlan(requiredFlag(parsed, 'plan'));
            const result = await applyDirectoryImport(vault, plan, {
              scope: enumFlag(parsed, 'scope', scopes, 'project'), sensitivity: enumFlag(parsed, 'sensitivity', sensitivities, 'internal'),
              ...(flagBoolean(parsed, 'progress') ? { onProgress: progress => process.stderr.write(`${JSON.stringify({ completed: progress.completed,
                total: progress.total, evidenceId: progress.result.evidenceId, commit: progress.result.commit })}\n`) } : {}),
            });
            print(result);
            if (result.status !== 'completed') process.exitCode = result.status === 'cancelled' ? 130 : 2;
          } else if (action === 'web-preview') {
            const plan = await previewWebImport(parsed.positionals.slice(1), { timeoutMs: numberFlag(parsed, 'timeout-ms', 10_000) });
            process.stdout.write(serializeWebImportPlan(plan));
          } else if (action === 'web-apply') {
            const result = await applyWebImport(vault, await readWebImportPlan(requiredFlag(parsed, 'plan')), {
              timeoutMs: numberFlag(parsed, 'timeout-ms', 10_000),
              scope: enumFlag(parsed, 'scope', scopes, 'project'), sensitivity: enumFlag(parsed, 'sensitivity', sensitivities, 'internal'),
              ...(flagBoolean(parsed, 'progress') ? { onProgress: progress => { process.stderr.write(`${JSON.stringify({ completed: progress.completed,
                total: progress.total, evidenceId: progress.result.evidenceId, commit: progress.result.commit })}\n`); } } : {}),
            });
            print(result);
            if (result.status !== 'completed') process.exitCode = result.status === 'cancelled' ? 130 : 2;
          } else if (action === 'pdf-preview') {
            process.stdout.write(serializePdfImportPlan(await previewPdfImport(requiredPositional(parsed, 1, 'PDF file'), { timeoutMs: numberFlag(parsed, 'timeout-ms', 10_000) })));
          } else if (action === 'pdf-apply') {
            print(await applyPdfImport(vault, await readPdfImportPlan(requiredFlag(parsed, 'plan')), {
              timeoutMs: numberFlag(parsed, 'timeout-ms', 10_000), scope: enumFlag(parsed, 'scope', scopes, 'project'),
              sensitivity: enumFlag(parsed, 'sensitivity', sensitivities, 'internal'),
            }));
          } else throw new Error('Import action must be preview, apply, web-preview, web-apply, pdf-preview or pdf-apply');
        });
      } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      return;
    }
    case 'source': {
      if (requiredPositional(parsed, 0, 'timeline') !== 'timeline') throw new Error('Source action must be timeline');
      print(await vault.sourceTimeline(requiredPositional(parsed, 1, 'source URI'), {
        ...(parsed.flags.has('from') ? { from: requiredFlag(parsed, 'from') } : {}),
        ...(parsed.flags.has('to') ? { to: requiredFlag(parsed, 'to') } : {}),
        offset: numberFlag(parsed, 'offset', 0), limit: numberFlag(parsed, 'limit', 30),
        includeSensitive: flagBoolean(parsed, 'include-sensitive'), includeSecret: flagBoolean(parsed, 'include-secret'),
      }));
      return;
    }
    case 'setup': {
      const action = parsed.positionals[0] ?? 'preview';
      if (!['preview', 'apply', 'verify', 'remove'].includes(action)) throw new Error('Setup action must be preview, apply, verify, or remove');
      const client = flagString(parsed, 'client') ?? 'claude-code';
      if (client !== 'claude-code') throw new Error('Only the claude-code project configuration is supported');
      const permissions = flagString(parsed, 'permissions') ?? 'read';
      if (permissions !== 'read' && permissions !== 'read,write') throw new Error('Setup permissions must be read or read,write');
      const expectedRevision = flagString(parsed, 'expected-revision');
      print(await runIntegrationSetup(action as 'preview' | 'apply' | 'verify' | 'remove', {
        client, configPath: resolve(flagString(parsed, 'config') ?? '.mcp.json'), vaultRoot: root, permissions,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      }));
      return;
    }
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
    case 'explain':
      print(await vault.explain(requiredText(parsed.positionals.join(' '), 'A search query is required'), searchOptions(parsed)));
      return;
    case 'recall':
      print(await vault.recall(requiredText(parsed.positionals.join(' '), 'A recall query is required'), {
        ...searchOptions(parsed), ...contextBudget(parsed),
      }));
      return;
    case 'context': {
      const query = requiredText(parsed.positionals.join(' '), 'A context query is required');
      const context = await vault.contextDetailed(query, { ...searchOptions(parsed), ...contextBudget(parsed) });
      if (parsed.flags.has('json')) print({ context: context.text, ...context });
      else process.stdout.write(`${context.text}\n`);
      return;
    }
    case 'ask': {
      const question = requiredText(parsed.positionals.join(' '), 'A question is required');
      const answer = await vault.answer(question, { ...searchOptions(parsed), ...contextBudget(parsed) });
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
    case 'experience': {
      const args = parsed;
      const action = args.positionals[0];
      if (!['capture', 'prepare', 'export'].includes(action ?? '')) {
        throw new Error('Experience actions: capture, prepare, export. Validation requires a trusted host callback through the library; no executable/module path is accepted.');
      }
      authorize(vault.principal, action === 'export' ? 'review' : 'write');
      await vault.config();
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try {
        await withOperation(controller.signal, async () => {
          const selection = { includeSensitive: flagBoolean(args, 'include-sensitive'), includeSecret: flagBoolean(args, 'include-secret') };
          if (action === 'export') {
            print(await vault.experienceExport(requiredPositional(args, 1, 'validation evidence ID'), {
              ...selection, confirm: flagBoolean(args, 'confirm'),
            }));
          } else {
            authorize(vault.principal, 'read');
            const file = requiredFlag(args, 'file');
            if (file === '-') throw new Error('Experience input requires a bounded local JSON file, not stdin');
            const value = await readImportPreview(file);
            if (action === 'capture') {
              print(await vault.experienceCapture(value as never, {
                scope: enumFlag<Scope>(args, 'scope', ['user', 'project', 'team', 'public'], 'user'),
                sensitivity: enumFlag<Sensitivity>(args, 'sensitivity', ['public', 'internal', 'sensitive', 'secret'], 'internal'),
              }));
            } else {
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Experience proposal input must be an object');
              print(await vault.experiencePrepare({ ...value, ...selection } as never));
            }
          }
        });
      } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
      return;
    }
    case 'wiki':
      await wikiCommand(vault, parsed);
      return;
    case 'maintenance':
      print(await new MaintenanceService(vault).runOnce());
      return;
    case 'serve':
      await serve(vault, parsed);
      return;
    case 'web': {
      if (parsed.flags.has('host')) throw new Error('Web management binds only to 127.0.0.1; --host is not supported');
      const handle = await startWebServer(root, { principal, port: numberFlag(parsed, 'port', 0) });
      print({ status: 'web', url: handle.url, token: handle.token, notice: 'Enter this token in the browser. Keep it private; restart rotates it.' });
      await new Promise<void>((resolveStop) => {
        const stop = () => { void handle.stop().finally(resolveStop); };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      return;
    }
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

async function wikiCommand(vault: MemoryVault, args: ParsedArgs): Promise<void> {
  const action = args.positionals[0] ?? 'catalog';
  const input = { ...args, positionals: args.positionals.slice(1) };
  if (action === 'jobs') return wikiJobsCommand(vault, input);
  const maxPages = args.flags.has('max-pages') ? Number(requiredFlag(args, 'max-pages')) : undefined;
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50)) {
    throw new Error('--max-pages must be an integer between 1 and 50');
  }
  const budget = maxPages === undefined ? {} : { maxPages };
  if ((action === 'ingest' || action === 'file') && flagBoolean(args, 'apply')) authorize(vault.principal, 'review');
  switch (action) {
    case 'catalog': print(await vault.wikiCatalog()); return;
    case 'snapshot': {
      if (args.flags.has('commit') === args.flags.has('at')) throw new Error('Use exactly one of --commit or --at');
      const selector = args.flags.has('at') ? { at: requiredFlag(args, 'at') } : { commit: requiredFlag(args, 'commit') };
      const controller = new AbortController(), stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { await withOperation(controller.signal, async () => print(await vault.wikiSnapshot({
        ...selector, pageKeys: input.positionals,
        includeSensitive: flagBoolean(args, 'include-sensitive'), includeSecret: flagBoolean(args, 'include-secret'),
      }))); } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      return;
    }
    case 'merge-prepare': {
      authorize(vault.principal, 'read'); authorize(vault.principal, 'write'); await vault.config();
      if (args.flags.has('apply')) throw new Error('Manual merges never auto-apply; inspect the proposal and use wiki apply explicitly');
      const controller = new AbortController(), stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try {
        await withOperation(controller.signal, async () => {
          const file = requiredFlag(args, 'file');
          if (file === '-') throw new Error('Manual merge input requires a bounded local JSON file, not stdin');
          const document = await readImportPreview(file);
          if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('A manual merge object is required');
          const input = mergeOptionsSchema.safeParse({ ...document, includeSensitive: flagBoolean(args, 'include-sensitive'), includeSecret: flagBoolean(args, 'include-secret') });
          if (!input.success) throw new Error('Invalid bounded manual Wiki merge input');
          print(await vault.wikiMergePrepare(input.data));
        });
      } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      return;
    }
    case 'rules': print(await vault.wikiRules()); return;
    case 'migrate': print(await vault.wikiMigrate()); return;
    case 'set-rules': {
      const expectedRevision = args.flags.has('expected-revision') ? Number(requiredFlag(args, 'expected-revision')) : undefined;
      if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
        throw new Error('--expected-revision must be a nonnegative integer');
      }
      print(await vault.wikiSetRules({
        purpose: requiredFlag(args, 'purpose'),
        instructions: await contentFrom(input),
        scope: enumFlag(args, 'scope', scopes, 'user'),
        sensitivity: enumFlag(args, 'sensitivity', sensitivities, 'internal'),
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      }));
      return;
    }
    case 'ingest':
      print(await vault.wikiIngest({
        evidenceIds: [...input.positionals, ...csvFlag(args, 'evidence')],
        apply: flagBoolean(args, 'apply'),
        ...budget,
      }));
      return;
    case 'apply': {
      const document = await jsonFileFrom(args);
      const plan = document !== null && typeof document === 'object' && 'plan' in document ? document.plan : document;
      // Keep normal stdin cancellation until input is complete; the write itself
      // needs cooperative cancellation so ready transactions can finish safely.
      const controller = new AbortController(), stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { print(await vault.wikiApply(plan, { signal: controller.signal })); }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      return;
    }
    case 'preview': {
      const document = await jsonFileFrom(args);
      const plan = document !== null && typeof document === 'object' && 'plan' in document ? document.plan : document;
      print(await vault.wikiPreview(plan));
      return;
    }
    case 'correct': {
      const expectedRevision = args.flags.has('expected-revision') ? numberFlag(args, 'expected-revision', 0) : undefined;
      print(await vault.wikiCorrect(requiredPositional(input, 0, 'Wiki key'),
        await contentFrom({ ...input, positionals: input.positionals.slice(1) }),
        expectedRevision === undefined ? {} : { expectedRevision }));
      return;
    }
    case 'query':
      print(await vault.wikiQuery(requiredText(input.positionals.join(' '), 'A Wiki question is required'), budget));
      return;
    case 'file': {
      const key = flagString(args, 'key');
      print(await vault.wikiFile(await jsonFileFrom(args), {
        title: requiredFlag(args, 'title'),
        ...(key === undefined ? {} : { key }),
        pageType: enumFlag(args, 'page-type', ['query', 'comparison'] as const, 'query'),
        apply: flagBoolean(args, 'apply'),
      }));
      return;
    }
    case 'lint':
      print(await vault.wikiLint({ semantic: flagBoolean(args, 'semantic'), ...budget }));
      return;
    case 'revoke':
      print(await vault.wikiRevoke(requiredPositional(input, 0, 'Wiki page key'), requiredFlag(args, 'reason')));
      return;
    default: throw new Error(`Unknown wiki action: ${action}`);
  }
}

async function wikiJobsCommand(vault: MemoryVault, args: ParsedArgs): Promise<void> {
  const action = args.positionals[0] ?? 'list';
  const id = () => requiredPositional(args, 1, 'job ID');
  if (args.flags.has('apply')) throw new Error('Jobs do not auto-apply; use wiki jobs preview and wiki jobs apply explicitly');
  switch (action) {
    case 'enqueue': print(await vault.wikiEnqueue({ evidenceIds: [...args.positionals.slice(1), ...csvFlag(args, 'evidence')],
      ...(args.flags.has('max-pages') ? { maxPages: numberFlag(args, 'max-pages', 20) } : {}) })); return;
    case 'list': print(await vault.wikiJobs()); return;
    case 'show': print(await vault.wikiJob(id())); return;
    case 'plan': print(await vault.wikiJobPlan(id())); return;
    case 'preview': print(await vault.wikiPreviewJob(id())); return;
    case 'apply': authorize(vault.principal, 'review'); print(await vault.wikiApplyJob(id())); return;
    case 'cancel': print(await vault.wikiCancelJob(id())); return;
    case 'retry': print(await vault.wikiRetryJob(id())); return;
    case 'remove': print(await vault.wikiRemoveJob(id())); return;
    case 'run': case 'work': break;
    default: throw new Error('Wiki jobs action must be enqueue, list, show, plan, preview, apply, cancel, retry, remove, run or work');
  }
  const pollMs = numberFlag(args, 'poll-ms', 1000);
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 10000) throw new Error('--poll-ms must be 100–10000');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await withOperation(controller.signal, async () => {
      do {
        const job = await vault.wikiRunJob({ ...(action === 'run' ? { id: id() } : {}), timeoutMs: numberFlag(args, 'timeout-ms', 120000) });
        if (job || action === 'run' || flagBoolean(args, 'once')) print(job);
        if (action === 'run' || flagBoolean(args, 'once')) {
          if (job?.status === 'failed') process.exitCode = 2;
          if (job?.status === 'cancelled') process.exitCode = 130;
          return;
        }
        if (!job) await delay(pollMs, undefined, { signal: controller.signal });
      } while (!controller.signal.aborted);
    });
  } catch (error) { if (controller.signal.aborted) process.exitCode = 130; else throw error; }
  finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (controller.signal.aborted) process.exitCode = 130;
  }
}

async function jsonFileFrom(args: ParsedArgs): Promise<unknown> {
  const file = requiredFlag(args, 'file');
  const text = file === '-' ? await stdinContent() : await readFile(resolve(file), 'utf8');
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error('--file must contain valid JSON'); }
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
  return stdinContent();
}

async function stdinContent(): Promise<string> {
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

function contextBudget(args: ParsedArgs) {
  return { maxCharacters: numberFlag(args, 'max-chars', 12_000),
    ...(args.flags.has('max-tokens') ? { maxTokens: numberFlag(args, 'max-tokens', 1) } : {}),
    ...(args.flags.has('resident-share') ? { residentShare: numberFlag(args, 'resident-share', 0.25) } : {}) };
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
  return `MemoBranch ${VERSION}

Usage:
  amem init [path] [--name NAME]
  amem config [migrate] | policy | version
  amem setup [preview|apply|verify|remove] [--client claude-code] [--config .mcp.json] --root VAULT
    apply/remove require --expected-revision HASH; --permissions read,write is explicit opt-in
  amem capture <text|-> [--extract] [--scope SCOPE] [--sensitivity LEVEL]
  amem extract <evidence-id>
  amem propose <statement> --key KEY [--kind fact] [--explicit] [--evidence path,...]
  amem consolidate | approve <candidate-id> | reject <candidate-id> --reason TEXT
  amem forget <memory-id|key> --reason TEXT
  amem erase <memory-id|key> --reason TEXT
  amem search <query> [--semantic] [--include-sensitive] [--include-secret]
  amem recall <query> [--max-chars N] [--max-tokens N] | explain <query> [--semantic]
  amem context <query> [--max-tokens N] [--resident-share 0.25] [--json] | ask <question> | get <id> | history
  amem import preview <directory> > import-plan.json
  amem import apply --plan import-plan.json [--scope project] [--sensitivity internal] [--progress]
  amem import web-preview <https-url...> [--timeout-ms 10000] > web-plan.json
  amem import web-apply --plan web-plan.json [--scope project] [--sensitivity internal] [--progress]
  amem import pdf-preview <file.pdf> [--timeout-ms 10000] > pdf-plan.json
  amem import pdf-apply --plan pdf-plan.json [--scope project] [--sensitivity internal] [--timeout-ms 10000]
  amem source timeline <source-uri> [--from ISO] [--to ISO] [--offset N] [--limit N]
  amem experience capture --file TRACE.json [--scope project] [--sensitivity internal]
  amem experience prepare --file PROPOSAL.json [--include-sensitive] [--include-secret]
  amem experience export <validation-evidence-id> --confirm [--include-sensitive] [--include-secret]
    Validation requires a trusted host library callback; export returns files as JSON, never installs or executes.
  amem memory at <ISO> [--key KEY] [--include-unknown] [--offset N] [--limit N]
  amem memory validity <memory-id> --from ISO|unknown --until ISO|unknown --expected-revision N --confirm
  amem doctor | recover | reindex [--semantic] | maintenance
  amem remote set <url> [--name origin] [--branch main] [--push]
  amem remote status | remote sync [--push] | remote remove
  amem wiki catalog | rules | migrate
  amem wiki snapshot <page-key...> (--commit FULL_HASH | --at ISO_TIMESTAMP) [--include-sensitive] [--include-secret]
  amem wiki merge-prepare --file MERGE.json [--include-sensitive] [--include-secret]
  amem wiki set-rules <instructions|-> --purpose TEXT [--file PATH] [--expected-revision N]
  amem wiki ingest <evidence-id...> [--evidence id,...] [--apply] [--max-pages N]
  amem wiki jobs enqueue <evidence-id...> [--max-pages N]
  amem wiki jobs list | show <job-id> | plan <job-id> | preview <job-id>
  amem wiki jobs apply <job-id>  (explicit review; never automatic)
  amem wiki jobs run <job-id> [--timeout-ms N]
  amem wiki jobs work [--once] [--poll-ms N] [--timeout-ms N]
  amem wiki jobs cancel | retry | remove <job-id>
  amem wiki apply --file <plan.json|->
  amem wiki preview --file <plan.json|->
  amem wiki correct <page-key> <instruction|-> [--file PATH] [--expected-revision N]
  amem wiki query <question> [--max-pages N]
  amem wiki file --file <query-result.json|-> --title TEXT [--page-type query|comparison] [--apply]
  amem wiki lint [--semantic] [--max-pages N]
  amem wiki revoke <page-key> --reason TEXT
  amem serve [--host 127.0.0.1] [--port 0]
  amem web [--port 0] --root PATH

Common options: --root PATH, --actor ID, --actor-name NAME, --actor-email EMAIL.
LLM: AMEM_LLM_API_KEY, AMEM_LLM_MODEL, AMEM_LLM_BASE_URL, AMEM_EMBEDDING_MODEL.
Security: AMEM_MASTER_KEY, AMEM_PERMISSIONS, AMEM_ALLOWED_SCOPES, AMEM_MAX_SENSITIVITY, AMEM_TENANT_ID.
Wiki planning is not applied by default; catalog, rules, query, and lint do not write canonical knowledge.
`;
}

main().catch((error: unknown) => {
  const normalized = toAgentMemoryError(error);
  process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
  process.exitCode = normalized.exitCode;
});
