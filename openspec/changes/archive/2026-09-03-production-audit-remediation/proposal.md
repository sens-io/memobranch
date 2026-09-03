# Change: Remediate independent production audit

## Why

An independent review reproduced authorization, confidentiality, concurrency, erasure, synchronization, index-integrity, health, and operational-contract failures that are not covered by the archived production-hardening verification. The repository must fail closed at every boundary before it can claim production readiness.

## What Changes

- Make tenant, scope, and sensitivity authorization authoritative for every read, prompt, derived view, and index operation.
- Preserve provenance confidentiality and prevent an LLM from broadening scope or lowering sensitivity.
- Make locks owner-safe and cover initialization; make cryptographic erasure recoverable and correctly ordered.
- Restore pre-sync state on every failed integration and keep Git remote configuration consistent with vault configuration.
- Treat derived indexes as untrusted caches, verify evidence immutability, and close the conflict-review state machine.
- Bound provider requests, report unhealthy services correctly, and align MCP annotations with real side effects.
- Add automated CI and adversarial regression gates, then replace stale verification claims with commit-bound evidence.

## Impact

- Affected specs: memory-access-control, transactional-vault, remote-git-sync, hybrid-memory-index, maintenance-service, production-agent-api.
- Affected code: `src/vault.ts`, `src/policy.ts`, `src/encryption.ts`, `src/utils.ts`, `src/git-store.ts`, `src/search.ts`, `src/llm.ts`, `src/maintenance.ts`, `src/mcp.ts`.
- Compatibility: no intended CLI or MCP input break. Unsafe credential-bearing remote URLs are rejected more strictly; conflicted memories are no longer returned as ordinary facts.
