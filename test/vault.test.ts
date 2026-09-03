import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { MemoryVault } from '../src/vault.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshVault(options: { masterKey?: string } = {}): Promise<MemoryVault> {
  const root = await mkdtemp(join(tmpdir(), 'amem-test-'));
  roots.push(root);
  const vault = new MemoryVault(root, options);
  await vault.initialize('test-vault');
  return vault;
}

test('initialization preserves existing agent instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amem-test-'));
  roots.push(root);
  await writeFile(join(root, 'AGENTS.md'), '# Existing project rules\n\nKeep this.\n');
  const vault = new MemoryVault(root);
  await vault.initialize('existing-project');
  const instructions = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(instructions, /Existing project rules/);
  assert.match(instructions, /AGENT_MEMORY_WIKI_START/);
});

test('capture is idempotent and every mutation is attributed in Git', async () => {
  const vault = await freshVault();
  const actor = { id: 'agent-codex', name: 'Codex' };
  const first = await vault.capture({ content: 'The user prefers concise Chinese answers.', actor });
  const second = await vault.capture({ content: 'The user prefers concise Chinese answers.', actor });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.commit, null);
  const history = await vault.history();
  assert.equal(history[0]?.author, 'Codex');
  assert.match(history[0]?.subject ?? '', /capture/);
});

test('explicit candidate becomes canonical, searchable memory with provenance', async () => {
  const vault = await freshVault();
  const evidence = await vault.capture({ content: 'Remember that my preferred language is Chinese.' });
  const candidate = await vault.propose(
    {
      kind: 'preference',
      key: 'response language',
      statement: 'The user prefers answers in Chinese.',
      scope: 'user',
      sensitivity: 'internal',
      confidence: 0.95,
      explicit: true,
      conditions: ['When responding to this user.'],
      tags: ['language'],
    },
    [evidence.evidencePath],
  );
  const consolidated = await vault.consolidate();

  assert.deepEqual(consolidated.promoted, [candidate.id]);
  const hits = await vault.search('Chinese language');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.kind, 'preference');
  assert.match(hits[0]?.snippet ?? '', /prefers answers in Chinese/i);
  const resident = await readFile(join(vault.root, 'MEMORY.md'), 'utf8');
  assert.match(resident, /response language/);
  const report = await vault.doctor();
  assert.equal(report.healthy, true);
  assert.equal(report.counts.activeMemories, 1);
});

test('conflicting statements stay visible until approval supersedes the old memory', async () => {
  const vault = await freshVault();
  const oldCandidate = await vault.propose({
    kind: 'fact', key: 'deployment region', statement: 'The project deploys to us-east-1.', scope: 'project',
    sensitivity: 'internal', confidence: 0.9, explicit: true, conditions: [], tags: ['deployment'],
  });
  await vault.consolidate();
  const replacement = await vault.propose({
    kind: 'fact', key: 'deployment region', statement: 'The project deploys to ap-southeast-1.', scope: 'project',
    sensitivity: 'internal', confidence: 0.9, explicit: true, conditions: [], tags: ['deployment'],
  });
  const conflict = await vault.consolidate();

  assert.deepEqual(conflict.conflicts, [replacement.id]);
  assert.equal((await vault.doctor()).conflicts.length, 1);
  assert.equal((await vault.consolidate()).commit, null);
  await vault.approve(replacement.id, { id: 'human-reviewer', name: 'Human Reviewer' });
  const hits = await vault.search('deployment region');
  assert.equal(hits.length, 1);
  assert.match(hits[0]?.snippet ?? '', /ap-southeast-1/);
  assert.doesNotMatch(hits[0]?.snippet ?? '', /us-east-1/);
  assert.notEqual(oldCandidate.id, replacement.id);
});

test('sensitive memories are filtered before retrieval', async () => {
  const vault = await freshVault({ masterKey: '11'.repeat(32) });
  await vault.propose({
    kind: 'fact', key: 'private codename', statement: 'The private codename is Blue Finch.', scope: 'project',
    sensitivity: 'secret', confidence: 1, explicit: true, conditions: [], tags: ['codename'],
  });
  await vault.consolidate();

  assert.equal((await vault.search('Blue Finch')).length, 0);
  assert.equal((await vault.search('Blue Finch', { includeSecret: true })).length, 1);
  const resident = await readFile(join(vault.root, 'MEMORY.md'), 'utf8');
  assert.doesNotMatch(resident, /Blue Finch/);
});

test('a one-off procedure is deferred and revoked memory disappears from retrieval', async () => {
  const vault = await freshVault();
  const procedure = await vault.propose({
    kind: 'procedure', key: 'release process', statement: 'Always deploy on Friday evening.', scope: 'team',
    sensitivity: 'internal', confidence: 0.99, explicit: false, conditions: [], tags: ['release'],
  });
  assert.deepEqual((await vault.consolidate()).deferred, [procedure.id]);
  const approved = await vault.approve(procedure.id);
  assert.equal((await vault.search('Friday deploy')).length, 1);
  await vault.forget(approved.memoryId, 'The policy was retired.');
  assert.equal((await vault.search('Friday deploy')).length, 0);
});
