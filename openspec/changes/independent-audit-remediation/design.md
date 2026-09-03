# Design: Independent audit remediation

## Safety invariants

1. At most one live process may enter a vault write critical section, including during stale-owner recovery.
2. A document whose canonical sensitivity requires encryption is invalid unless it is an authenticated envelope.
3. Evidence identity binds scope, sensitivity, source URI, and body; invalid evidence never reaches retrieval or derivation.
4. Confidential logical keys do not enter Git paths or commit subjects, and non-admin history does not return untrusted subjects.
5. A non-admin principal without the configured tenant identity has no vault access.
6. A completed mutation in another process invalidates an older process's trusted search snapshot before its next query.
7. Successful erasure commits a digest of the supplied reason without persisting its plaintext.

## Lock protocol

Each writer creates a unique contender file containing its PID, owner token, and system-monotonic ticket. Live contenders are ordered by ticket and only the earliest contender may create, recover, or remove the conventional lock file. Because contender paths are never reused, dead contenders can be removed without deleting a successor's ownership. The conventional lock remains owner-token protected for compatibility and diagnostics.

## Canonical validation

Document reads enforce encryption requirements before returning plaintext. Evidence reads additionally recompute the versioned digest before returning the document. Remote validation uses the same path, so invalid remote states trigger the existing synchronization rollback.

## Cross-process search trust

The persistent index remains the fast derived cache. A trusted in-memory instance records the index file identity (`device`, `inode`, `size`, and modification time); every lexical query compares the current identity before reusing memory. Another process writes the index by atomic replacement after a mutation, which changes the identity and forces health validation and reload.

## Compatibility

- Local administrators are explicitly trusted to bind to the selected vault without a tenant environment variable.
- Existing non-confidential paths remain readable. Newly promoted confidential memories use opaque ID filenames.
- Legacy erasure intents without a reason digest remain recoverable and produce `reasonRecorded: false`.
- Existing evidence created before sensitivity-bound hashing must be recaptured or migrated before subsequent mutation; silently accepting unverifiable authorization metadata is not allowed.
