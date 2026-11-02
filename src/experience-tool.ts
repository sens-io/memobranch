import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { experiencePrepareSchema, experienceTraceSchema } from './experience.js';
import { scopes, sensitivities } from './types.js';

export const experienceCaptureToolSchema = z.object({ trace: experienceTraceSchema,
  scope: z.enum(scopes).optional(), sensitivity: z.enum(sensitivities).optional() }).strict();
export const experiencePrepareToolSchema = z.object({ proposal: experiencePrepareSchema }).strict();
export const experienceExportToolSchema = z.object({ validationId: z.string().regex(/^ev-[a-f0-9]{12}$/),
  confirm: z.literal(true), includeSensitive: z.boolean().optional(), includeSecret: z.boolean().optional() }).strict();

export function experienceToolInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid experience tool arguments');
  return parsed.data;
}

/** Same 1 MiB protocol margin as the existing Wiki review tools; never truncate files. */
export function experienceToolResult<T>(value: T): T {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text }] }), 'utf8') > 9 * 1_048_576) {
    throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Complete experience tool result exceeds 9 MiB');
  }
  return value;
}
