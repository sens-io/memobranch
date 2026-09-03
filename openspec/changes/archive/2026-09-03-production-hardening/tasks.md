## 1. Configuration and domain boundaries

- [x] 1.1 Add typed domain errors, production limits, principal permissions, and authorization policy types.
- [x] 1.2 Implement version 1 to version 2 configuration migration with validation, backup, and future-version write refusal.
- [x] 1.3 Route CLI and MCP operations through effective principal and policy checks.

## 2. Confidential memory

- [x] 2.1 Implement master-key parsing, per-record data keys, AES-256-GCM envelope encryption, and atomic wrapped-key storage.
- [x] 2.2 Make Markdown document reads and writes transparently encrypt and decrypt sensitive and secret logical records.
- [x] 2.3 Implement administrator-only cryptographic erasure and verify plaintext absence from files, Git history, index, audit, and metrics.

## 3. Transactional durability

- [x] 3.1 Add write-ahead transaction manifests that capture original and desired managed-file states.
- [x] 3.2 Integrate mutation journaling with capture, propose, consolidate, review, forget, generated documents, logs, and configuration migration.
- [x] 3.3 Implement rollback/replay recovery, stale/live lock behavior, and Git/config/index integrity diagnostics.

## 4. Persistent hybrid retrieval

- [x] 4.1 Implement the versioned atomic search-index format and content-hash incremental refresh.
- [x] 4.2 Preserve deterministic English/CJK lexical ranking and authorization-safe one-hop graph expansion from the persistent corpus.
- [x] 4.3 Add optional OpenAI-compatible embeddings, content/model keyed vector cache, cosine hybrid ranking, and lexical fallback.
- [x] 4.4 Add reindex commands, index health reporting, corruption rebuild, and incremental/performance tests.

## 5. Remote Git synchronization

- [x] 5.1 Add validated remote/branch configuration that rejects credential-bearing URLs and redacts errors.
- [x] 5.2 Implement fetch and ahead/behind/divergence status using the shadow repository.
- [x] 5.3 Implement transaction-aware fast-forward, merge, conflict abort/reporting, post-merge validation, and guarded push.
- [x] 5.4 Add local bare-remote integration tests for clone-independent push, pull, divergence, and conflict preservation.

## 6. Maintenance and operations

- [x] 6.1 Implement structured redacted JSONL audit events and bounded counters/gauges.
- [x] 6.2 Implement an idempotent maintenance cycle for recovery, expiry, reindex, doctor, and configured sync.
- [x] 6.3 Implement daemon lease, debounced file watching, graceful signal handling, and loopback `/healthz` and `/metrics` endpoints.
- [x] 6.4 Add maintenance repeatability, daemon exclusivity, endpoint, and shutdown tests.

## 7. Production CLI and MCP contracts

- [x] 7.1 Add CLI version/config/policy/recover/reindex/remote/maintenance/serve/erase operations with JSON error envelopes and bounded validation.
- [x] 7.2 Remove caller-controlled MCP identity, enforce permissions, catch typed errors, and expose production operational tools.
- [x] 7.3 Verify MCP stays alive after denied/error calls and tool annotations match side effects.

## 8. Release gates and documentation

- [x] 8.1 Update README and environment reference with migration, key custody, remote sync, daemon deployment, threat model, and recovery runbook.
- [x] 8.2 Add security, recovery, synchronization, compatibility, and bounded performance suites; run build, tests, package dry-run, and npm audit.
- [x] 8.3 Run OpenSpec verification, resolve every critical issue, and prepare the change for archive.
