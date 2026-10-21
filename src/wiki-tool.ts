import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { mergeOptionsSchema } from './wiki-merge.js';
import { snapshotOptionsSchema } from './wiki-snapshot.js';

// Both protocols use the core's strict inputs, but cancellation belongs to the host.
export const wikiSnapshotToolSchema = snapshotOptionsSchema.omit({ signal: true })
  .refine(value => new Set(value.pageKeys).size === value.pageKeys.length, 'Use distinct page keys');
export const wikiMergeToolSchema = mergeOptionsSchema.omit({ signal: true });

export function wikiToolInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid Wiki tool arguments');
  return parsed.data;
}

/** Leave 1 MiB below the MCP SDK's default 10 MiB stdio buffer for protocol overhead. */
export function wikiToolResult<T>(value: T, plan?: unknown): T {
  const check = (input: unknown) => {
    const text = JSON.stringify(input, null, 2);
    if (Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text }] }), 'utf8') > 9 * 1_048_576) {
      throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete Wiki tool review exceeds 9 MiB');
    }
  };
  check(value);
  if (plan !== undefined) check({ name: 'memory_wiki_apply', arguments: { plan } });
  return value;
}
