import { AsyncLocalStorage } from 'node:async_hooks';
import { AgentMemoryError } from './errors.js';

interface OperationContext {
  signal?: AbortSignal;
  committed: Array<{ operation: string; commit: string }>;
}

const operations = new AsyncLocalStorage<OperationContext>();

/** Own cancellation per invocation, including nested provider and Git work. */
export function withOperation<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  return operations.run({ signal, committed: [] }, async () => {
    throwIfCancelled();
    return action();
  });
}

export function operationSignal(): AbortSignal | undefined {
  return operations.getStore()?.signal;
}

export function cancellationError(): AgentMemoryError {
  const committed = operations.getStore()?.committed ?? [];
  return new AgentMemoryError('OPERATION_CANCELLED', 'Operation was cancelled',
    committed.length ? { committed: [...committed] } : undefined);
}

export function throwIfCancelled(): void {
  if (operationSignal()?.aborted) throw cancellationError();
}

export function recordCommit(operation: string, commit: string | null): void {
  if (commit) operations.getStore()?.committed.push({ operation, commit });
}

/** Recovery and an already-ready commit must settle even after caller cancellation. */
export function withoutCancellation<T>(action: () => Promise<T>): Promise<T> {
  const parent = operations.getStore();
  return operations.run({ committed: parent?.committed ?? [] }, action);
}
