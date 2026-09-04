# Design: Close final production gaps

## Safety invariants

1. A retrieval never returns authorization metadata, status, or snippets from a canonical version older than the current filesystem state.
2. A successful revocation followed by an index-write failure cannot leave revoked content retrievable.
3. Every managed Markdown type is fully validated before health or remote synchronization accepts it.
4. Every sensitivity named by `policy.requireEncryptionFor` is stored as an authenticated envelope and excluded from plaintext derivatives.
5. Legacy evidence is either explicitly migrated to the v2 authorization-bound digest or rejected; migration preserves stable IDs, paths, and references.
6. Only the owner token that acquired a maintenance lease can update or release it.
7. Concurrent audit rotation and metrics updates preserve accepted events and increments.

## Search trust

The persistent index stores a source identity for every canonical file. Before an in-memory snapshot is reused, the search path scans the public Wiki file set and compares device, inode, size, modification time, and change time. Any mismatch clears trust and forces full health validation plus rebuild. Returned hits are reread through the authorized canonical reader to close the check/use race. If the rebuild cannot be persisted, search fails instead of using stale data.

## Managed schemas

Central validators cover all required fields, enums, numeric bounds, timestamps, arrays, and status-specific metadata for candidates, memories, evidence, and erased-memory tombstones. Both normal reads and post-sync validation use the same validators. Unknown document types under managed directories are rejected.

## Configured encryption

Encryption decisions use the effective vault policy rather than a hard-coded classification pair. Encrypted documents at any configured level remain available only through the keyed canonical reader and are omitted from plaintext indexes and generated projections.

## Evidence migration

The migration preflight recognizes a cryptographically valid legacy digest without accepting it during ordinary operations. Migration recomputes the v2 digest, records the legacy digest, and keeps the existing evidence ID and path so candidate and memory references do not change. Subsequent reads validate both the v2 digest and the legacy-ID proof.

## Operations concurrency

Audit rotation/append and metrics read-modify-write operations use independent owner-protected file locks. Maintenance leases contain an owner token and are acquired, updated, and removed while holding a lease-management lock; an unrelated service instance has no release authority.
