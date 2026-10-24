# Design

## Three explicit operations
1. Import preparation requires current caller read/write access and an explicitly
   displayed full `expectedCommit`. Read the exact source with the accepted host
   binding and current checks. Build a bounded compiled-Wiki artifact, bind caller
   vault/tenant/config, selection, exact artifact and destination classification
   with the caller's existing local Wiki proof key. Return the full proposed
   artifact and classification; do not write evidence or call a model.
2. Import application requires a valid proof, `confirm: true`, and current caller
   read/write/review permissions. Read the source again under the current host
   binding, compare exact stable artifact content and fixed commit, and refuse
   changed/missing/withdrawn/expired support. Capture one immutable artifact with
   extraction disabled. It is a copy of compiled source material, not independent
   verification of its original raw sources. An exact retry creates no extra
   evidence or commit, but still checks current access and source availability.
3. Manual integration requires current read/write authority, an existing imported
   artifact, authored body/summary and expected current revision. It creates a
   normal signed Wiki proposal containing a grounded source summary and the new
   or updated target with full before/after comparison. Only the existing separate
   review operation writes Wiki pages. No automatic resolution of imported/local
   conflicts and no promotion of imported prose to independently confirmed facts.

## Origin and inherited restrictions
The reserved artifact includes source vault/tenant/full commit, selected keys,
complete page bodies/versions/classification/conditions/uncertainty/lifecycle,
original-source IDs/hashes and rule references. No source roots, credentials,
per-record/proof keys, PDF originals or original raw-source attachments are copied.
The URI is a deterministic reserved identity containing the source identity and
artifact hash, never a request-selected path. Existing evidence hashing binds URI,
classification and full content. Validate reserved bodies/URIs and their labels;
ordinary text/PDF evidence is unchanged. An artifact states that the original raw
sources were not copied or independently verified and plaintext cannot be recalled.

Destination scope must be equally or more restrictive in the project's existing
scope ordering; sensitivity cannot be lower than any source page. Effective start
is the latest start and expiry the earliest end, including ordinary-memory fact
intervals. Conditions and uncertainty are unions and conflict status is retained.
Wiki preparation and read validation enforce these from the immutable artifact,
even when a model or authored draft omits them. Query output and source DTOs identify
the imported compiled source. Expired artifact evidence stays inspectable as raw
retained history but cannot support currently usable Wiki knowledge. Copied
artifacts are not remotely revocable; origin changes after a completed import do
not automatically erase the caller's immutable copy.

## Concurrency, cancellation and proof
Never hold source and caller locks simultaneously. Initial/final source snapshot
guards remain live during later proof work and destination lock waits. Caller
approval rechecks current config, principal, binding file and selected key without
acquiring the source lock while holding the destination write lock. Recheck all
time/cancellation/authority constraints immediately before transaction readiness
and after asynchronous cleanup. A source withdrawal overlapping an already valid
consistent read may follow it; a new approval begun after withdrawal must refuse.
Host binding changes during the operation refuse before commit. Once ready, use
the existing safe commit/recovery and committed-cancellation reporting.

Snapshots, plan JSON and inputs are cloned/strictly parsed before asynchronous
work. Plans are bound to the destination vault/config; edited, foreign or stale
plans fail. Request bodies cannot provide roots, grants, identities, key variables,
callbacks, signals, model URLs or alternate source commits. Library cancellation
accepts a real signal, not JSON. A reader or writer alone cannot approve imports.

## Limits and adapters
Use existing sharing limits (25 requested/50 dependent pages) and destination
evidence limit, with at most 1,000,000 UTF-8 bytes per complete import plan/artifact
and no silent truncation. Authored integration body remains at most 100,000
characters and 40 affected Wiki pages. Existing lower protocol/envelope bounds
still apply. CLI input is a bounded regular UTF-8 local JSON file. MCP/Harness/Web
do not add a filesystem reader, grant editor or upload endpoint. Every UI edit,
source change, cancel, navigation or logout invalidates the review/confirmation.

No subprocess, shell, network, evaluator or model runs for import/manual merge.
Tests use synthetic vaults and existing fixture compilers only. No real host
binding is modified by development. Fixed-candidate independent review, both Git
defaults, same-package Node 20/22, native Web and bilingual records are required
before marking this batch accepted.
