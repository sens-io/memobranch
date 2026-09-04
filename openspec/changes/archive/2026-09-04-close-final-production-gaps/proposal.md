# Change: Close final production gaps

## Why

An independent boundary review reproduced six failures that the existing green suite did not cover: stale authorization data after canonical changes, unenforced configurable encryption, incomplete canonical schemas, blocked legacy-evidence migration, ownerless maintenance leases, and lost concurrent metrics updates. Adjacent-path review then found the same invariants missing from transaction journals, erasure tombstones, embeddings after policy changes, cross-document references, managed symlinks, daemon startup cleanup, and the post-push failure window. These are release blockers for a production memory service.

## What changes

- Bind every cached search snapshot to the current canonical Wiki file identities, verify returned hits against canonical documents, and fail closed after refresh errors.
- Validate complete evidence, candidate, memory, and erasure-tombstone schemas at every canonical read and synchronization boundary.
- Enforce every sensitivity listed in `policy.requireEncryptionFor` for writes, reads, indexing, generated projections, and migration.
- Add an explicit, reference-preserving migration from legacy evidence digests to the sensitivity-bound v2 digest.
- Give maintenance leases unique ownership and only allow the owner to update or release its lease.
- Serialize audit rotation and metrics updates across processes so observability does not lose events or increments.
- Keep encrypted plaintext out of transaction journals and embedding requests across policy changes, and make configured-level erasure preserve destruction of the original key.
- Reject managed symlinks, duplicate identities, and invalid evidence or lifecycle references.
- Preserve the locally pushed revision after an externally successful push and clean up partial maintenance startup.
- Keep `.amem/` runtime keys, journals, indexes, and telemetry out of any enclosing Git repository.
- Add boundary, near-neighbor, retention, and safety regressions for each reproduced failure.

## Impact

Affected code includes `src/search.ts`, `src/vault.ts`, `src/evidence.ts`, `src/config.ts`, `src/maintenance.ts`, `src/audit.ts`, document types, tests, and operator documentation. The search hot path performs a bounded filesystem identity scan before trusting an in-memory index. Legacy evidence IDs and paths remain stable during migration.
