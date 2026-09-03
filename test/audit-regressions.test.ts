import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';
import type { Principal } from '../src/policy.js';
import type { ProposedMemory, Scope, Sensitivity } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];
const masterKey = '51'.repeat(32);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshVault(options: ConstructorParameters<typeof MemoryVault>[1] = {}): Promise<MemoryVault> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-audit-'));
  roots.push(root);
  const vault = new MemoryVault(root, options);
  await vault.initialize('audit-regression');
  return vault;
}

function principal(tenantId: string, overrides: Partial<Principal> = {}): Principal {
  return {
    id: 'limited',
    name: 'Limited principal',
    permissions: ['read'],
    scopes: ['user'],
    maxSensitivity: 'public',
    tenantId,
    ...overrides,
  };
}

test('context, get, and history enforce principal scope, sensitivity, and tenant', async () => {
  const admin = await freshVault();
  const config = await admin.config();
  const proposed = await admin.propose({
    kind: 'fact', key: 'restricted context', statement: 'CONTEXT_SCOPE_LEAK_CANARY', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await admin.consolidate();

  const limited = new MemoryVault(admin.root, { principal: principal(config.tenantId) });
  assert.doesNotMatch(await limited.context('CONTEXT_SCOPE_LEAK_CANARY'), /CONTEXT_SCOPE_LEAK_CANARY/);

  const otherTenant = new MemoryVault(admin.root, {
    principal: principal('another-tenant', { scopes: ['user', 'project', 'team', 'public'], maxSensitivity: 'secret' }),
  });
  const memory = await admin.get((await admin.search('CONTEXT_SCOPE_LEAK_CANARY'))[0]!.id);
  await assert.rejects(otherTenant.get(String(memory.meta.id)), authorizationDenied);
  await assert.rejects(otherTenant.history(), authorizationDenied);
  assert.ok(proposed.id);
});

class DowngradingLlm extends LlmClient {
  override async extractMemories(_content: string, _defaults: { scope: Scope; sensitivity: Sensitivity }): Promise<ProposedMemory[]> {
    return [{
      kind: 'fact', key: 'classified', statement: 'CLASSIFIED_PAYLOAD_91C2', scope: 'public', sensitivity: 'public',
      confidence: 1, explicit: true, conditions: [], tags: [],
    }];
  }
}

test('evidence provenance prevents an LLM from broadening scope or lowering sensitivity', async () => {
  const vault = await freshVault({ masterKey, llm: new DowngradingLlm() });
  const result = await vault.capture({
    content: 'CLASSIFIED_PAYLOAD_91C2', scope: 'team', sensitivity: 'secret', extract: true,
  });
  const candidate = await vault.get(result.candidates[0]!.id);
  assert.equal(candidate.meta.scope, 'team');
  assert.equal(candidate.meta.sensitivity, 'secret');
  const raw = await readFile(join(vault.root, result.candidates[0]!.path), 'utf8');
  assert.doesNotMatch(raw, /CLASSIFIED_PAYLOAD_91C2/);
  const gitMatch = await vault.git.run(['grep', '-n', 'CLASSIFIED_PAYLOAD_91C2', 'HEAD'], { allowFailure: true });
  assert.equal(gitMatch, '');
});

test('limited writers cannot erase other scopes from generated projections', async () => {
  const admin = await freshVault();
  const config = await admin.config();
  await admin.propose({
    kind: 'fact', key: 'project resident', statement: 'PROJECT_RESIDENT_CANARY', scope: 'project',
    sensitivity: 'internal', confidence: 1, explicit: true, conditions: [], tags: [],
  });
  await admin.consolidate();
  assert.match(await readFile(join(admin.root, 'MEMORY.md'), 'utf8'), /PROJECT_RESIDENT_CANARY/);

  const writer = new MemoryVault(admin.root, {
    principal: principal(config.tenantId, { permissions: ['read', 'write'], maxSensitivity: 'internal' }),
  });
  await writer.capture({ content: 'ordinary user evidence', scope: 'user', sensitivity: 'internal' });
  assert.match(await readFile(join(admin.root, 'MEMORY.md'), 'utf8'), /PROJECT_RESIDENT_CANARY/);
  assert.equal(existsSync(join(admin.root, 'agent-memory.json')), true);
});

function authorizationDenied(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'AUTHORIZATION_DENIED';
}
