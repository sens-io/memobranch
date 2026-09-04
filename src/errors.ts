export const errorCodes = [
  'AUTHORIZATION_DENIED',
  'CONFIG_INVALID',
  'CONFIG_VERSION_UNSUPPORTED',
  'CONTENT_TOO_LARGE',
  'DEPENDENCY_UNAVAILABLE',
  'ENCRYPTION_KEY_UNAVAILABLE',
  'ENCRYPTION_FAILED',
  'GIT_OPERATION_FAILED',
  'LOCK_TIMEOUT',
  'NOT_FOUND',
  'OPERATION_CANCELLED',
  'REMOTE_CONFLICT',
  'REMOTE_INVALID',
  'REMOTE_TRANSPORT',
  'TRANSACTION_RECOVERY_FAILED',
  'VALIDATION_FAILED',
  'VAULT_NOT_INITIALIZED',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class AgentMemoryError extends Error {
  readonly name = 'AgentMemoryError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly safeDetails?: Record<string, unknown>,
    readonly exitCode = defaultExitCode(code),
  ) {
    super(message);
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.safeDetails ? { details: this.safeDetails } : {}),
      },
    };
  }
}

export function toAgentMemoryError(error: unknown): AgentMemoryError {
  if (error instanceof AgentMemoryError) return error;
  return new AgentMemoryError('VALIDATION_FAILED', redactSecrets(error instanceof Error ? error.message : String(error)));
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,})\b/g, '[redacted-token]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]');
}

function defaultExitCode(code: ErrorCode): number {
  if (code === 'AUTHORIZATION_DENIED') return 3;
  if (code === 'NOT_FOUND') return 4;
  if (code === 'LOCK_TIMEOUT') return 5;
  if (code.startsWith('REMOTE_')) return 6;
  if (code.startsWith('ENCRYPTION_')) return 7;
  if (code === 'DEPENDENCY_UNAVAILABLE') return 8;
  if (code === 'OPERATION_CANCELLED') return 130;
  return 2;
}
