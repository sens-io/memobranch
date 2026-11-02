import { AgentMemoryError } from './errors.js';
import { throwIfCancelled } from './operation.js';

export interface TokenCounter {
  name: string;
  /** Set false only for a tokenizer matching the target model. */
  estimated: boolean;
  count(text: string): number;
}

export interface ContextBudgetOptions {
  maxCharacters?: number;
  maxTokens?: number | undefined;
  tokenCounter?: TokenCounter | undefined;
  residentShare?: number | undefined;
}

export interface ContextBlock {
  id: string;
  section: 'resident' | 'retrieved';
  text: string;
}

export interface ContextBudgetReport {
  maxCharacters: number;
  characters: number;
  maxTokens: number | null;
  tokens: number;
  counter: string;
  estimated: boolean;
  omitted: Array<{ id: string; reason: 'budget' | 'duplicate' }>;
}

/** Deliberately conservative for common byte-based tokenizers, not usage billing. */
export const utf8ByteCounter: TokenCounter = {
  name: 'utf8-bytes', estimated: true, count: text => Buffer.byteLength(text, 'utf8'),
};

export function packContext(blocks: readonly ContextBlock[], options: ContextBudgetOptions & { maxCharacters: number }) {
  const { maxCharacters, maxTokens, residentShare = 0.25, tokenCounter = utf8ByteCounter } = options;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 ||
      (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1)) ||
      !Number.isFinite(residentShare) || residentShare < 0 || residentShare > 1 ||
      typeof tokenCounter.name !== 'string' || !tokenCounter.name.trim() || tokenCounter.name.length > 80 ||
      typeof tokenCounter.estimated !== 'boolean' || typeof tokenCounter.count !== 'function') {
    throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid context budget or token counter');
  }
  const count = (text: string) => {
    throwIfCancelled();
    const value = tokenCounter.count(text);
    if (!Number.isSafeInteger(value) || value < 0 || (text.length > 0 && value === 0)) {
      throw new AgentMemoryError('VALIDATION_FAILED', 'Token counter must return a positive safe integer for nonempty text');
    }
    return value;
  };
  if (count('') !== 0) throw new AgentMemoryError('VALIDATION_FAILED', 'Token counter must count empty text as zero');
  let text = '';
  const selected: ContextBlock[] = [];
  const unique: ContextBlock[] = [];
  const byId = new Map<string, ContextBlock>();
  const seen = new Set<string>();
  const omitted: ContextBudgetReport['omitted'] = [];
  for (const block of blocks) {
    if (seen.has(block.id)) { omitted.push({ id: block.id, reason: 'duplicate' }); continue; }
    seen.add(block.id);
    byId.set(block.id, block);
    unique.push(block);
  }
  const fits = (next: string, fraction = 1) => next.length <= Math.floor(maxCharacters * fraction)
    && (maxTokens === undefined || count(next) <= Math.floor(maxTokens * fraction));
  const add = (block: ContextBlock, fraction = 1) => {
    const next = text ? `${text}\n\n${block.text}` : block.text;
    if (!fits(next, fraction)) return false;
    text = next; selected.push(block); return true;
  };
  const selectedIds = new Set<string>();
  for (const block of unique.filter(block => block.section === 'resident')) {
    if (add(block, residentShare)) selectedIds.add(block.id);
  }
  // A resident record that did not fit its reservation must keep its original
  // search rank. Deduplicate only after selection, not before that fallback.
  const retrievedIds = new Set(blocks.filter(block => block.section === 'retrieved').map(block => block.id));
  for (const id of retrievedIds) {
    if (selectedIds.has(id)) continue;
    const block = { ...byId.get(id)!, section: 'retrieved' as const };
    if (add(block)) selectedIds.add(id);
  }
  for (const block of unique.filter(block => block.section === 'resident')) {
    if (!selectedIds.has(block.id) && add(block)) selectedIds.add(block.id);
  }
  for (const block of unique) if (!selectedIds.has(block.id)) omitted.push({ id: block.id, reason: 'budget' });
  const budget: ContextBudgetReport = { maxCharacters, characters: text.length, maxTokens: maxTokens ?? null,
    tokens: count(text), counter: tokenCounter.name, estimated: tokenCounter.estimated, omitted };
  return { text, selected, budget, truncated: omitted.some(item => item.reason === 'budget') };
}
