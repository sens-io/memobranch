# Owned Git cache implementation

The version 2 `git` binding fixes `remote`, a short branch name, full `commit`,
expected source IDs, local reader tuples, ceilings and optional `masterKeyEnv`.
Normal transports are credential-free HTTPS or SSH (including `git@host:path`).
Local absolute paths and `file:` URLs require host-only `allowLocalFile: true`;
they are for explicitly trusted local repositories and synthetic fixtures. Do not
accept arbitrary remote helpers, HTTP credentials, insecure HTTP, query/fragment,
request-selected branches or commands. Native host credential/SSH configuration
remains trusted operator configuration, not source-provided instructions.

Each source ID owns one private slot under the caller's runtime
`.amem/shared-cache/<id>/`. Its strict owner file binds caller/source identities,
remote hash, branch and Git object format. A foreign or missing owner in an
existing slot refuses. Rebinding the same ID to a different remote/branch/source
requires an operator reset or a new alias, not silent reuse of old keys. A refresh
lock is outside the cache vault. It serializes refresh and selected snapshot reads;
the caller's canonical writer lock is never held at the same time.

Initialize an empty Git store with an empty template. Disable hooks and attribute
transformations (using a controlled highest-priority `info/attributes` file),
filesystem monitors, automatic newline conversion and automatic maintenance in
the owned store. Fetch only the configured branch into a fixed tracking ref,
without tags, submodules or a worktree checkout. Require full non-shallow history
and the pinned commit to remain an ancestor of the refreshed tip. A failed fetch
refuses even when an earlier cache exists. No push or merge is performed.

Before materialization, validate all current tree entries: regular Markdown in
managed directories or existing managed root files only, no symlink/submodule,
runtime path, `.gitattributes`, unsafe/ambiguous portable path or case/Unicode
collision. Bound the current tree to 5000 files, 10 MB/file and 100 MB total.
Read exact object bytes without Git filters, verify each object's hash and size,
and stage them inside the cache runtime. No input source is executed. File modes
in the working cache are non-executable; the index preserves source tree modes.
Then replace only validated managed files, reset the index without checkout and
advance the cache HEAD to that existing source commit.

A private pending marker precedes replacing managed files. A cancelled/crashed
partial replacement is never returned. The next explicit read fetches again and
reconstructs only the disposable managed tree before reading it. Ownership,
unsafe/unexpected files and observed directory replacement still refuse. This is
recovery of a derived cache, not rollback or modification of the original source.
Do not use the cache as a user working checkout.
The exclusive refresh lock also permits removing known transient Git lock files
left by a terminated helper; it does not remove the private key store.
Before allocating a new stage, remove abandoned reserved `stage-<UUID>` directories
whose entries are only regular, singly linked, 64-hex staging files. Unexpected
files or links refuse rather than being deleted. This cleanup happens before the
cache budget check so a crashed partial stage cannot permanently consume the
space required to reconstruct a valid managed tree.

Never delete or fetch the private `.amem/keys.json`. For confidential reads the
operator must separately provision the cache's wrapped record keys and select its
master key through `masterKeyEnv`. Missing/erased keys refuse new reads. Git
repository access alone does not grant plaintext. Refreshes preserve these keys;
secrets and cache paths never appear in normal catalog/snapshot results.

Bound the complete operation with `timeoutMs` (100–120000, default 30000), retained
Git command/output limits and cache size (`maxCacheBytes`, 64000–1073741824,
default 536870912). Check disk usage before/after and monitor during fetch. These
are application checks, not an operating-system disk quota; a large pack can
overshoot between checks, and host volume/resource limits are still needed.
After materialization release the cache writer lock, take the existing read
snapshot under the refresh lock, verify source IDs and exact refreshed authority
head, then release all source locks before final caller checks. Keep the existing
lifecycle/cancellation guards live for import proof work and destination waits.
Every import confirmation refreshes again; no stale cache fallback or automatic
pin advance is introduced.

References checked while designing the controlled commands:
[Git fetch](https://git-scm.com/docs/git-fetch),
[Git object reads](https://git-scm.com/docs/git-cat-file),
[Git configuration](https://git-scm.com/docs/git-config).
The implementation uses object reads and an index-only reset, rather than a
checkout or `--filters` transformation.
