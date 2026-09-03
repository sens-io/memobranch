# Production audit remediation tasks

## 1. Authorization and confidentiality

- [x] 1.1 Enforce tenant checks on all reads and build per-principal resident context.
- [x] 1.2 Constrain LLM-derived scope and sensitivity to evidence provenance.
- [x] 1.3 Rebuild global generated files from a complete safe projection.
- [x] 1.4 Add scope, sensitivity, tenant, and confidentiality-downgrade regressions.

## 2. Locks and cryptographic erasure

- [x] 2.1 Use owner tokens, live-PID checks, and owner-checked release; serialize initialization.
- [x] 2.2 Add durable erasure intents and idempotent recovery under the writer lock.
- [x] 2.3 Test old live locks, concurrent initialization, key-store failure, and interrupted erasure.

## 3. Canonical and derived integrity

- [x] 3.1 Strictly validate the index and authorize/return from canonical metadata and content.
- [x] 3.2 Verify evidence hashes and commit only transaction-declared paths.
- [x] 3.3 Exclude conflicts from ordinary search and restore state after rejection.
- [x] 3.4 Enforce procedure evidence independently of explicit confidence override.

## 4. Remote consistency

- [x] 4.1 Reject query, fragment, userinfo, and unsafe SCP credential forms.
- [x] 4.2 Compensate remote configuration failures.
- [x] 4.3 Restore pre-sync state after reconcile, validation, status, or push failure.

## 5. Operations and contracts

- [x] 5.1 Add provider timeout, response-size, retry, and cancellation bounds.
- [x] 5.2 Return unavailable health for unhealthy or unavailable snapshots.
- [x] 5.3 Correct MCP side-effect and destructive annotations.
- [x] 5.4 Avoid rewriting an unchanged index and add meaningful performance gates.

## 6. Release evidence

- [x] 6.1 Add CI release gates.
- [x] 6.2 Run build, full tests, coverage, dependency audit, package dry-run, and diff checks.
- [x] 6.3 Record current package identity, commit-bound verification evidence, and remaining non-goals.
