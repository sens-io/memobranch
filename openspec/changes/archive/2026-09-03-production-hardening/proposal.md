## Why

The current release proves the Git-native LLM Wiki model, but it still trusts caller-supplied identity, scans the vault on every query, has no remote synchronization or crash transaction boundary, and cannot safely operate on confidential memory. A production release needs explicit security, durability, operability, and compatibility contracts before it can be deployed as an always-on Agent memory service.

## What Changes

- Add versioned configuration migration and a durable transaction journal that recovers interrupted multi-file mutations without exposing partial state.
- Add server-owned principals, role permissions, scope and sensitivity authorization, encrypted confidential records, and cryptographic erasure.
- Add a persistent incremental lexical index plus optional OpenAI-compatible embedding generation and hybrid ranking.
- Add explicit remote Git configuration, status, fetch/merge/push synchronization, divergence reporting, and conflict-safe failure behavior.
- Add one-shot and daemon maintenance, structured audit events, health snapshots, and Prometheus-compatible metrics.
- Add production CLI/MCP operations for policy inspection, indexing, synchronization, recovery, maintenance, and health.
- Add integration, security, recovery, synchronization, and performance-regression tests plus release documentation.
- **BREAKING**: MCP write attribution and permissions come from the server environment instead of caller-supplied actor fields.
- **BREAKING**: writing `sensitive` or `secret` content requires an encryption master key.

## Capabilities

### New Capabilities

- `transactional-vault`: Atomic logical mutations, crash recovery, repository integrity checks, configuration migration, and safe concurrent access.
- `memory-access-control`: Server-owned identity, permissions, scope and sensitivity filtering, encrypted confidential records, and cryptographic erasure.
- `hybrid-memory-index`: Persistent incremental lexical indexing, optional embedding cache, hybrid ranking, and index health/rebuild behavior.
- `remote-git-sync`: Remote configuration, ahead/behind status, safe bidirectional synchronization, conflict reporting, and authenticated transport delegation to Git.
- `maintenance-service`: Scheduled maintenance, file-change reindexing, graceful lifecycle, structured audit events, health state, and metrics.
- `production-agent-api`: Stable CLI/MCP contracts, bounded inputs and outputs, error semantics, compatibility rules, and operational documentation.

### Modified Capabilities

None. This repository does not yet have archived OpenSpec capability specifications.

## Impact

- Core changes affect `src/vault.ts`, `src/git-store.ts`, search/indexing, configuration types, CLI, and MCP registration.
- New modules will cover access policy, encryption, transactions, persistent indexing, remote synchronization, maintenance, audit, and health.
- The on-disk vault configuration advances from schema version 1 to version 2 with automatic forward migration and backward-incompatible-write protection.
- New environment variables configure the principal, permissions, encryption key, embedding provider, maintenance interval, and remote sync policy.
- The package remains local-first and Markdown/Git based; no database, hosted control plane, or web UI is introduced.
