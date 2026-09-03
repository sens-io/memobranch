## Context

Version 0.1 is a single-process TypeScript CLI/MCP service whose durable truth is Markdown and whose audit history is a shadow Git repository. It already separates evidence, candidates, and canonical memory, but caller identity is trusted, searches rescan files, confidential content is plaintext, mutations can stop between related writes, and Git has no remote lifecycle. The production target remains a local-first package used by one tenant per vault through CLI or stdio MCP; operators own the filesystem, Git credentials, LLM provider, and encryption master key.

## Goals / Non-Goals

**Goals:**

- Preserve Markdown/Git as authoritative, portable storage while making logical mutations recoverable.
- Enforce least privilege before content access and keep confidential plaintext out of Git, indexes, logs, and metrics.
- Make normal retrieval incremental, deterministic, hybrid when configured, and functional without a model provider.
- Support explicit, conflict-safe synchronization through standard Git transports.
- Provide an always-on maintenance mode with useful health and bounded operational telemetry.
- Keep CLI and MCP behavior testable, automation-safe, and backward-compatible through a version 1 to 2 migration.

**Non-Goals:**

- A browser/WYSIWYG editor, hosted control plane, or multi-tenant database.
- Distributed consensus or simultaneous writes across multiple hosts; Git remains the cross-host reconciliation layer.
- Automatic resolution of semantic or Git conflicts.
- Deleting copies controlled by remote hosts or backup systems; cryptographic erasure covers ciphertext whose data key is locally controlled.
- Making confidential Markdown human-readable without an authorized running process.

## Decisions

### Decision: Retain filesystem truth and use derived runtime state

Canonical evidence, candidates, memory, log, index page, and resident card remain Markdown tracked by the shadow repository. Runtime search indexes, encryption keys, transactions, service leases, metrics, and health snapshots live under `.amem/` and are never Git staged. Derived state carries schema and content hashes and can always be rebuilt.

Alternative considered: SQLite as the primary store. Rejected because it would make the human-readable Wiki a replica, reintroducing synchronization and lock-in problems the project is designed to avoid.

### Decision: Use a write-ahead mutation journal with rollback/replay recovery

Before the first managed write, a transaction manifest records actor, commit subject, phase, and for every path both original and desired content (base64, with absence represented explicitly). Each file replacement remains atomic. A transaction not marked `ready` is rolled back; a `ready` transaction is replayed and committed. Only one process may mutate at once. Runtime journals may contain confidential plaintext transiently, so confidential desired/original values are stored encrypted with the master key.

Alternative considered: rely on Git's index alone. Rejected because an index does not encode the intended complete multi-file state and cannot distinguish a valid partial edit from an interrupted transaction.

### Decision: Server-owned principal with an explicit permission lattice

The stdio server creates one immutable principal from environment configuration. Permissions are `read`, `write`, `review`, `sync`, `maintain`, and `admin`; scope is an allow-list; sensitivity is an ordered maximum. The CLI constructs a local principal from flags/environment but still passes through the same policy gate. MCP schemas no longer expose actor identity.

Alternative considered: accept identity per tool call. Rejected because the untrusted caller could self-assign reviewer or administrator identity.

### Decision: Envelope-encrypt the complete confidential logical document

For `sensitive` and `secret` records, the Git-tracked Markdown contains a minimal envelope: ID, type, scope, sensitivity, lifecycle status, cipher metadata, and ciphertext. The full logical metadata and body are JSON-encrypted with a random per-record AES-256-GCM data key. The data key is itself wrapped by an AES-256-GCM master key supplied as 32-byte base64 or 64-character hex and stored only in `.amem/keys.json`. Cryptographic erasure destroys the wrapped data key and writes a plaintext tombstone.

Alternative considered: encrypt only the body. Rejected because keys, tags, conditions, source URIs, and reasons can themselves be confidential.

### Decision: Persist a JSON search corpus and optional embeddings

`.amem/search-index.json` stores one bounded entry per non-confidential canonical document: identity, authorization metadata, content hash, term frequencies, length, outgoing links, and a short normalized search text. Incremental refresh compares file hashes. `.amem/embeddings.json` stores vectors keyed by model and content hash; confidential entries are never persisted or sent to an embedding provider. Authorized confidential reads use in-memory lexical parsing only. Ranking combines normalized lexical score, optional cosine similarity, and graph-neighbor boost.

Alternative considered: introduce a native vector database. Rejected for this release because it adds deployment and binary compatibility risk; the index abstraction leaves that option open.

### Decision: Synchronize the shadow repository with ordinary Git

Remote URL and branch are stored in version 2 config only after rejecting userinfo-bearing URLs. Git credential helpers and SSH agents handle authentication. Sync recovers transactions, commits any consistent managed change, fetches, computes ahead/behind, fast-forwards or attempts a standard merge, rebuilds derived state, runs health checks, and pushes only a healthy result. Merge conflict paths are captured and `git merge --abort` restores the pre-sync state.

Alternative considered: application-level document synchronization. Rejected because Git already provides content-addressed history, transport, ancestry, and conflict representation.

### Decision: One maintenance loop, no implicit knowledge promotion

The daemon runs recovery, expiry handling, index refresh, doctor, and optional Git sync. It watches managed paths only and debounces events. It does not automatically approve candidates; consolidation may merge duplicates or promote only entries already eligible under existing policy. Loopback `/healthz` and `/metrics` use Node's HTTP server without adding a web framework.

Alternative considered: automatic LLM curation on every change. Rejected because it introduces unpredictable cost and could promote incorrect memory without an explicit operator policy.

### Decision: Typed domain errors cross CLI and MCP boundaries

Core code throws `AgentMemoryError` with stable codes and safe details. CLI `--json` emits an error envelope and meaningful exit code. MCP catches domain and unknown errors and returns `isError: true` without stack traces or secrets. Limits are enforced at the boundary and again in core services.

## Risks / Trade-offs

- [JSON indexes eventually become too large] → Use atomic writes, configurable document/vector limits, performance gates, and an index interface that can later gain a SQLite adapter.
- [Master key loss makes confidential history unrecoverable] → Fail closed, expose key fingerprint/availability in health, document external key custody and backup before first confidential write.
- [A malicious local administrator can read process memory] → State that the threat model protects Git/disk artifacts and unauthorized callers, not a fully compromised host.
- [Git hooks can reject recovery or sync commits] → Surface typed errors, retain the ready journal, and never claim completion until the commit exists.
- [Remote merge mixes independently valid semantic changes] → Run doctor after merge; semantic conflicts remain visible and block automatic push when health policy requires it.
- [Filesystem watchers differ across operating systems] → Treat watch events only as hints, debounce them, and always verify through content hashes.

## Migration Plan

1. On first writable open, validate version 1 config and save `agent-memory.json.v1.bak` if absent.
2. Add version 2 policy, index, encryption, remote, maintenance, and limits defaults without changing existing Markdown.
3. Initialize derived index and runtime health state; leave existing public/internal documents plaintext.
4. Require a master key only when accessing or creating confidential envelopes.
5. Deploy MCP configuration with server-owned identity and permissions; remove actor fields from clients.
6. Configure and test a remote with `remote status` before enabling push or daemon sync.

Rollback uses the pre-migration configuration backup and Git commit prior to migration. Version 1 software MUST NOT be used to write a migrated vault.

## Open Questions

None for the production-v1 scope. A native database index, external KMS adapter, HTTP MCP transport, and browser UI are intentionally deferred capabilities.
