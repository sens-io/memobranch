import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { experiencePrepareSchema } from '../src/experience.js';
import { availabilityAtSchema } from '../src/knowledge-availability.js';

test('collection budget: constrained inputs fail before parsing each element or running later refinements', () => {
  let elements = 0, refinements = 0;
  const schema = z.array(z.string().refine(() => { elements++; return true; })).max(25)
    .refine(() => { refinements++; return true; });
  const result = schema.safeParse(Array.from({ length: 20000 }, () => 'untrusted element'));
  assert.equal(result.success, false);
  assert.equal(elements, 0); assert.equal(refinements, 0);
  assert.deepEqual(result.error!.issues.map(issue => issue.code), ['too_big']);
});

test('collection budget: real experience and availability schemas do not allocate one issue per oversized member', () => {
  const values = Array.from({ length: 20000 }, () => null);
  for (const [schema, input, path] of [
    [availabilityAtSchema, { pageKeys: values, at: '2026-10-24T00:00:00Z' }, 'pageKeys'],
    [experiencePrepareSchema, { traceIds: values, name: 'budget-check', description: 'Bounded collection fixture.',
      procedure: 'Do not execute input.', conditions: ['Fixture only.'], limitations: ['No quality claim.'] }, 'traceIds'],
  ] as const) {
    const result = schema.safeParse(input); assert.equal(result.success, false);
    assert.deepEqual(result.error!.issues.map(issue => ({ path: issue.path, code: issue.code })), [{ path: [path], code: 'too_big' }]);
  }
});
