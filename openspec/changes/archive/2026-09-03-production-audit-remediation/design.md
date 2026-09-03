# Design: Production audit remediation

## Security invariants

1. Vault tenant authorization is checked before any managed document, history, resident view, snippet, or prompt is returned.
2. Derived knowledge never has a broader scope or lower sensitivity than its evidence. Model output is advisory and cannot weaken this invariant.
3. The search index is an untrusted, rebuildable cache. Authorization metadata and returned content are verified against canonical Markdown.
4. Evidence identity is bound to its scope, source URI, and body hash; mutations and synchronization fail closed when evidence has changed.

## Consistency invariants

1. A live local writer lock is never reclaimed because of age alone. Lock release is conditional on owner identity.
2. Erasure uses a durable intent: record intent, destroy the wrapped key under the writer lock, commit the tombstone, then clear intent. Recovery completes interrupted intents idempotently.
3. Remote synchronization snapshots the pre-sync revision and restores it after reconcile, validation, status, or push failure.
4. Git remote configuration changes happen inside the writer boundary and are compensated if the matching vault-config transaction fails.

## Retrieval and conflict behavior

- Resident context is generated for the current principal from authorized canonical records; global `MEMORY.md` is never used as an authorization source.
- Global generated Markdown is rebuilt from the complete non-confidential projection, independent of the caller's scope.
- Conflicted memories are excluded from ordinary retrieval. Rejecting the last conflicting candidate restores the prior canonical memory to active.
- Procedures always require the configured evidence count; explicit input may bypass confidence review but not the procedure-evidence invariant.

## Operational boundaries

- LLM and embedding calls have total timeouts, response-size limits, bounded retries, and cancellation on daemon shutdown.
- `/healthz` returns an unavailable status when the latest doctor result is unhealthy or no completed result exists.
- MCP annotations describe possible writes and destructive recovery/maintenance behavior.
- CI executes build, tests, dependency audit, package dry-run, and OpenSpec validation when available.

## Verification strategy

Each independent-review reproduction becomes an automated regression. Boundary tests cover the behavior that must change; retention tests preserve capture, consolidation, lexical/CJK search, encryption, migration, remote happy paths, and MCP availability.
