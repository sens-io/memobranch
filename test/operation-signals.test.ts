import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { combineSignals } from '../src/operation.js';

test('signal composition forwards either parent and removes all listeners', () => {
  for (const index of [0, 1]) {
    const parents = [new AbortController(), new AbortController()];
    const combined = combineSignals(parents.map(parent => parent.signal));
    parents[index]!.abort('cancelled');
    assert.equal(combined.signal.aborted, true);
    assert.equal(combined.signal.reason, 'cancelled');
    for (const parent of parents) assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
    combined.dispose();
  }
});

test('signal composition handles already aborted parents and ordinary completion', () => {
  const first = new AbortController(), second = new AbortController();
  second.abort('before dispatch');
  const preCancelled = combineSignals([first.signal, second.signal]);
  assert.equal(preCancelled.signal.reason, 'before dispatch');
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  const complete = combineSignals([first.signal, first.signal]);
  assert.equal(getEventListeners(first.signal, 'abort').length, 1);
  complete.dispose();
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  first.abort();
  assert.equal(complete.signal.aborted, false);
});
