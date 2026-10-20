export interface ReviewDiff {
  added: number;
  removed: number;
  lines: Array<{ kind: 'context' | 'added' | 'removed' | 'omitted'; text: string }>;
  truncated: boolean;
}

/** Linear, bounded review display, not a minimal edit-distance algorithm. */
export function reviewDiff(before: string, after: string, maximum = 200): ReviewDiff {
  const left = before ? before.split('\n') : [];
  const right = after ? after.split('\n') : [];
  let prefix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(left.length, right.length) - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
  const removed = left.length - prefix - suffix;
  const added = right.length - prefix - suffix;
  const result: ReviewDiff = { added, removed, lines: [], truncated: false };
  let remaining = Math.max(6, maximum);
  const emit = (kind: 'context' | 'added' | 'removed', values: string[]) => {
    const count = Math.min(remaining, values.length);
    for (const value of values.slice(0, count)) {
      result.lines.push({ kind, text: value.length > 2000 ? `${value.slice(0, 2000)} …` : value });
      if (value.length > 2000) result.truncated = true;
    }
    remaining -= count;
    if (count < values.length) {
      result.lines.push({ kind: 'omitted', text: `${values.length - count} ${kind} lines omitted; read the full before/after bodies.` });
      result.truncated = true;
    }
  };
  emit('context', left.slice(Math.max(0, prefix - 3), prefix));
  // Split the display budget so a large deletion cannot hide all additions.
  const total = remaining;
  remaining = Math.floor(total / 2);
  emit('removed', left.slice(prefix, left.length - suffix));
  remaining += total - Math.floor(total / 2);
  emit('added', right.slice(prefix, right.length - suffix));
  emit('context', right.slice(right.length - suffix, right.length - suffix + 3));
  return result;
}
