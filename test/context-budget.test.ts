import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packContext, utf8ByteCounter, type ContextBlock } from '../src/context-budget.js';
import { MemoryVault } from '../src/vault.js';
import { localAdminPrincipal } from '../src/policy.js';
import { withOperation } from '../src/operation.js';

test('budget: final separators, Unicode and complete records obey both limits', () => {
  const blocks: ContextBlock[] = [
    { id: 'a', section: 'retrieved', text: JSON.stringify({ body: '中文 🚀', conditions: ['Only production.'], evidence: ['evidence/complete.md'] }) },
    { id: 'b', section: 'retrieved', text: JSON.stringify({ body: 'other', conditions: ['Do not omit.'] }) },
  ];
  const exact = utf8ByteCounter.count(blocks.map(block => block.text).join('\n\n'));
  const complete = packContext(blocks, { maxCharacters: 1000, maxTokens: exact });
  assert.equal(complete.budget.tokens, exact);
  assert.equal(complete.selected.length, 2);
  const smaller = packContext(blocks, { maxCharacters: 1000, maxTokens: exact - 1 });
  assert.equal(smaller.selected.length, 1);
  assert.deepEqual(JSON.parse(smaller.text).conditions, ['Only production.']);
  assert.ok(smaller.budget.estimated);
  assert.ok(smaller.budget.tokens <= exact - 1);
});

test('budget: deduplicate identities, spill unused resident capacity and preserve order', () => {
  const result = packContext([
    { id: 'a', section: 'resident', text: 'aaa' },
    { id: 'a', section: 'retrieved', text: 'duplicate' },
    { id: 'b', section: 'retrieved', text: 'bbb' },
  ], { maxCharacters: 8, residentShare: 0.5 });
  assert.equal(result.text, 'aaa\n\nbbb');
  assert.equal(result.truncated, false);
  assert.deepEqual(result.budget.omitted, [{ id: 'a', reason: 'duplicate' }]);
  const reclaimed = packContext([{ id: 'b', section: 'retrieved', text: 'abcdef' }], { maxCharacters: 6 });
  assert.equal(reclaimed.text, 'abcdef');
});

test('budget: custom tokenizer is named, exact, and rejects invalid counters/budgets', () => {
  const block: ContextBlock = { id: 'a', section: 'retrieved', text: 'two words' };
  const result = packContext([block], { maxCharacters: 100, maxTokens: 2,
    tokenCounter: { name: 'test-words', estimated: false, count: text => text ? text.split(/\s+/).length : 0 } });
  assert.equal(result.budget.tokens, 2);
  assert.equal(result.budget.estimated, false);
  for (const maxTokens of [0, NaN, Infinity, 1.5]) assert.throws(() => packContext([block], { maxCharacters: 100, maxTokens }));
  for (const value of [0, -1, NaN, 1.5]) assert.throws(() => packContext([block], { maxCharacters: 100,
    tokenCounter: { name: 'invalid', estimated: false, count: text => text ? value : 0 } }));
});

test('context: approved resident/search overlap appears once, complete with conditions and no secret key requirement', async t => {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/context-budget-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root, { masterKey: '24'.repeat(32) });
  await vault.initialize('budget');
  for (const sensitivity of ['public', 'secret'] as const) {
    const candidate = await vault.propose({ kind: 'preference', key: `Atlas ${sensitivity}`, statement: `Atlas ${sensitivity} complete statement`,
      scope: 'user', sensitivity, confidence: 1, explicit: true, conditions: ['Only Atlas production.'], tags: [] });
    await vault.approve(candidate.id);
  }
  const reader = new MemoryVault(root, { masterKey: '' });
  const result = await reader.contextDetailed('Atlas', { maxCharacters: 12_000, maxTokens: 12_000 });
  assert.equal(result.records.length, 1);
  assert.doesNotMatch(result.text, /secret complete/);
  assert.equal(JSON.parse(result.text).conditions[0], 'Only Atlas production.');
  const tiny = await reader.contextDetailed('Atlas', { maxTokens: 2 });
  assert.equal(tiny.text, ''); assert.equal(tiny.truncated, true);
  const foreign = new MemoryVault(root, { principal: { ...localAdminPrincipal(), tenantId: 'other' } });
  await assert.rejects(foreign.contextDetailed('Atlas'), { code: 'AUTHORIZATION_DENIED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withOperation(controller.signal, () => reader.contextDetailed('Atlas')), { code: 'OPERATION_CANCELLED' });
});
