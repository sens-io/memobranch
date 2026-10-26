import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { throwIfCancelled } from './operation.js';
import { scopes, sensitivities } from './types.js';
import { sha256 } from './utils.js';
import { stableWikiJson } from './wiki-proof.js';

const text = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
export const cloudHostPathSchema = z.string().min(1).max(4096)
  .refine(value => isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value));
export const cloudAttenuationSchema = z.object({
  scopes: z.array(z.enum(scopes)).min(1).max(scopes.length).refine(values => new Set(values).size === values.length),
  maxSensitivity: z.enum(sensitivities),
}).strict();
export const cloudWikiAccountSchema = z.object({ id: text, tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
  root: cloudHostPathSchema, vaultId: text, tenantId: text, sharedWikiConfig: cloudHostPathSchema,
  ...cloudAttenuationSchema.shape,
}).strict();
const accountsSchema = z.object({ version: z.literal(1), accounts: z.array(cloudWikiAccountSchema).max(100)
  .refine(values => new Set(values.map(value => value.id)).size === values.length)
  .refine(values => new Set(values.map(value => value.tokenSha256)).size === values.length),
}).strict();
export type CloudWikiAccount = z.infer<typeof cloudWikiAccountSchema>;
export type CloudWikiAttenuation = z.infer<typeof cloudAttenuationSchema>;

/** Host-only regular files. The final path cannot be a link or change during the read. */
export async function readCloudHostFile(path: string, maximum = 100_000): Promise<Buffer> {
  if (!cloudHostPathSchema.safeParse(path).success) invalidConfig();
  try {
    throwIfCancelled(); const initial = await lstat(path);
    if (!initial.isFile() || initial.isSymbolicLink()) invalidConfig();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.dev !== initial.dev || before.ino !== initial.ino) invalidConfig();
      if (before.size > maximum) tooLarge();
      const buffer = Buffer.alloc(maximum + 1); let total = 0;
      for (;;) {
        throwIfCancelled(); const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
        if (!bytesRead) break;
        total += bytesRead; if (total > maximum) tooLarge();
      }
      const after = await handle.stat(), current = await lstat(path);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== after.dev || current.ino !== after.ino
        || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) invalidConfig();
      return buffer.subarray(0, total);
    } finally { await handle.close(); }
  } catch (error) {
    throwIfCancelled(); if (error instanceof AgentMemoryError) throw error; return invalidConfig();
  }
}

/** JSON.parse alone accepts duplicate keys. Reject them, including escaped spellings, and deep envelopes. */
export function parseCloudJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const objects: Array<Set<string> | null> = [];
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (character === '{' || character === '[') {
        objects.push(character === '{' ? new Set() : null);
        if (objects.length > 64) throw new Error();
      } else if (character === '}' || character === ']') objects.pop();
      else if (character === '"') {
        const start = index++;
        for (; index < text.length; index++) {
          if (text[index] === '\\') index++;
          else if (text[index] === '"') break;
        }
        let next = index + 1; while (/\s/.test(text[next] ?? '') && next < text.length) next++;
        if (text[next] === ':') {
          const keys = objects.at(-1), key: string = JSON.parse(text.slice(start, index + 1));
          if (!keys || keys.has(key)) throw new Error(); keys.add(key);
        }
      }
    }
    return JSON.parse(text);
  } catch { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid cloud Wiki JSON'); }
}

export async function readCloudAccounts(path: string) {
  try {
    const config = accountsSchema.safeParse(parseCloudJson(await readCloudHostFile(path)));
    if (!config.success) invalidConfig();
    return { ...config.data, hash: sha256(stableWikiJson(config.data)) };
  } catch (error) {
    throwIfCancelled();
    if (error instanceof AgentMemoryError && error.code === 'CONTENT_TOO_LARGE') throw error;
    return invalidConfig();
  }
}

function invalidConfig(): never { throw new AgentMemoryError('CONFIG_INVALID', 'Cloud Wiki host configuration is unavailable or invalid'); }
function tooLarge(): never { throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Cloud Wiki host file exceeds its byte limit'); }
