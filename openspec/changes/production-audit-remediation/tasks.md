# Production audit remediation tasks

## 1. Authorization and confidentiality

- [ ] 1.1 Enforce tenant checks on all reads and build per-principal resident context.
- [ ] 1.2 Constrain LLM-derived scope and sensitivity to evidence provenance.
- [ ] 1.3 Rebuild global generated files from a complete safe projection.
- [ ] 1.4 Add scope, sensitivity, tenant, and confidentiality-downgrade regressions.

## 2. Locks and cryptographic erasure

- [ ] 2.1 Use owner tokens, live-PID checks, and owner-checked release; serialize initialization.
- [ ] 2.2 Add durable erasure intents and idempotent recovery under the writer lock.
- [ ] 2.3 Test old live locks, concurrent initialization, key-store failure, and interrupted erasure.

## 3. Canonical and derived integrity

- [ ] 3.1 Strictly validate the index and authorize/return from canonical metadata and content.
- [ ] 3.2 Verify evidence hashes and commit only transaction-declared paths.
- [ ] 3.3 Exclude conflicts from ordinary search and restore state after rejection.
- [ ] 3.4 Enforce procedure evidence independently of explicit confidence override.

## 4. Remote consistency

- [ ] 4.1 Reject query, fragment, userinfo, and unsafe SCP credential forms.
- [ ] 4.2 Compensate remote configuration failures.
- [ ] 4.3 Restore pre-sync state after reconcile, validation, status, or push failure.

## 5. Operations and contracts

- [ ] 5.1 Add provider timeout, response-size, retry, and cancellation bounds.
- [ ] 5.2 Return unavailable health for unhealthy or unavailable snapshots.
- [ ] 5.3 Correct MCP side-effect and destructive annotations.
- [ ] 5.4 Avoid rewriting an unchanged index and add meaningful performance gates.

## 6. Release evidence

- [ ] 6.1 Add CI release gates.
- [ ] 6.2 Run build, full tests, coverage, dependency audit, package dry-run, and diff checks.
- [ ] 6.3 Record current package identity, commit-bound verification evidence, and remaining non-goals.
