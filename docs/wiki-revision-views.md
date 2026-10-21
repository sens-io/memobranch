# Local committed Wiki revision views

Development-source capability, not in published npm 1.1.0. This is an explicit local read of committed knowledge, not a shared-vault service, access token, offline export, backup or automatic historical answer.

```sh
memobranch history --root ./vault
# Copy a complete commit hash from the vault history, not this software repository.
memobranch wiki snapshot entity:atlas --commit FULL_COMMIT_HASH --root ./vault
```

The local library exposes `vault.wikiSnapshot({ commit, pageKeys, includeSensitive?, includeSecret?, signal? })`, with public `WikiSnapshotOptions` and `WikiSnapshot` types. Select 1–25 distinct keys, including ordinary memories as `legacy:<memory-id>`. Use a full lowercase 40/64-character hash for a local commit in current HEAD ancestry; symbolic refs, tags as names, abbreviations, tree/blob objects, unreachable and foreign-vault/tenant commits are rejected. Git replacement objects are ignored; grafts (including `GIT_GRAFT_FILE`) and partial-clone/promisor configurations are refused. It does not fetch missing history.

## What a result means

`commit` identifies the historical content. `authorityHead` identifies the current local commit used while checking access; `checkedAt` is this read's time, not a claim that the information was true then. Each complete page keeps its actual historical metadata, body, revision, conditions, uncertainty and conflict status, with a separate `currentRevision`. Historical links and dependencies are included once, including cycles. All required pages must be available; unavailable dependencies or exceeded limits fail the whole read rather than silently dropping context.

Sources are listed only by identity, path and evidence hash. Rule identities/revisions include the built-in rule when used; page metadata records which rule versions compiled that page, while the result's rule list identifies rule documents read at the selected commit. Raw source bodies, PDF original encodings, rule instructions, configuration and credentials are not included. This is a provenance view, not a self-contained archive or new independent evidence.

Reading uses Git objects directly and reuses the Wiki's source/link/rule validation. It does not checkout, reset, merge, change refs/index, make a second worktree, recreate keys, call a model, approve changes or alter canonical files. It uses the existing temporary writer lock so a concurrent writer waits for the settled read. Pending transactions, synchronization or erasure require explicit recovery first. Dirty managed configuration, Wiki or evidence must be committed/recovered before reading; an external HEAD or managed-file change detected before return also rejects the result. Normal runtime lock files are not a snapshot store.

Other programs must not edit the vault concurrently: the lock coordinates MemoBranch writers, not arbitrary Git or filesystem writers. Head/status checks reject changes they observe; they are not an operating-system lease preventing outside edits.

## Current access still applies

Every requested page and every **historical** dependency must remain currently accessible. Checks include current tenant, operation permission, scope/sensitivity, transitive provenance, status, expiration and ordinary-memory effective dates. A dependency that is no longer linked by today's root page is still checked if the historical page uses it. Historical records also have to pass validation, authorization and current encryption requirements; a historical expired/withdrawn page does not become valid because its current revision was extended or reactivated.

For ordinary memories, both the historical and current intervals must permit use at read time. This is not a request to evaluate their truth at the commit date; use the separate dated retained-record view for its documented date-filtering behavior.

Sensitive/secret material requires both sufficient principal permission and explicit `includeSensitive` / `includeSecret` (CLI `--include-sensitive` / `--include-secret`). Opting out avoids decrypting those records. Missing or destroyed keys are not recovered from Git. Current withdrawal, erasure or inaccessible sources cannot be bypassed by an old revision.

These guarantees apply to each live read. Once a caller copies the returned text, later withdrawal cannot recall that copy. The JSON is not an authorization token and there is no import/apply endpoint for it. Do not share a private repository, key store or returned confidential text under the assumption that this API creates team permissions.

The selected commit must already have vault configuration schema v2 and records accepted by the current canonical validators. Historical schema migration is not performed, even if an older representation has since been migrated in the current vault.

## Bounds and remaining work

Maximum 25 requested keys, 50 dependency pages, 200 stored records (including configuration), 10,000,000 bytes per stored blob and 20,000,000 aggregate stored bytes. Limits count stored encrypted/base64 envelopes, not just extracted characters. Current Wiki authorization scanning keeps its existing behavior; these bounds do not create an operating-system memory sandbox or a server upload feature.

`signal` combines with any enclosing operation cancellation. Git object reads keep the existing per-command deadlines; there is no separate overall deadline, and lock waiting retains its existing bounded behavior. A cancelled read returns no partial view and releases its owned lock so later operations can proceed.

This does not infer fact-effective dates, answer “what did the agent know on a particular date,” reconstruct erased information, or establish historical model-answer quality. Version-pinned cross-account shared vaults, grants/revocation, cross-branch/private-vault import and validated experience/skill export remain separate work. The [Web manual-merge workflow](web-manual-merge.md) exposes this bounded reader for authorized historical/current comparison; no MCP/Harness snapshot endpoint is added. No schema, cache, database or configuration migration is required.
