# Wiki copy and human integration in the management UI — candidate

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Baseline: `6e820526000c4b23b3b178405605ce1cdbb4b659` (CLI/agent candidate).
This is ongoing batch 4 work, not full acceptance, publication or deployment.

## Behavior

The management UI has a separate “知识导入” page. Existing shared browsing remains
read-only. The new page lists host-configured names/pins, prepares a complete copy
proposal and requires an explicit checked review and confirmation before capture.
Capture only retains evidence and fills its ID; it never starts integration or
approves knowledge. The author separately enters a retained artifact ID, target
key/revision, title/summary/body and optional tighter restrictions. Preparation
shows complete imported material, the current target and all proposed/affected
pages. A second checked review and explicit ordinary Wiki approval writes knowledge.

Previously retained evidence can be integrated without remote sharing setup.
No path, network, identity, grant or key editor is added. All bodies and titles
render as literal text. Drafts and full plans stay only in page memory and clear
on navigation/logout. Input/source changes and cancellation invalidate old
approval controls and suppress late responses. Saving disables input editing;
stop/disconnect still cancels owned waits. A potentially completed write is not
described as rolled back: inspect records/history first, and only explicitly
retry the exact retained signed proposal. No automatic retry or fallback source.

HTTP uses strict schemas, the existing local bearer/origin/host checks and owned
operation signals. Copy/integration reviews and resubmittable approval envelopes
must fit the existing 16 MiB Web review allowance; canonical signed plans still
have the lower 1,000,000-byte limit. A post-copy failure exposes only validated
`completedImport` evidence ID/commit/duplicate, never artifact text or credentials.
No new source, model call, canonical preparation write or automatic approval.

## Checks so far

- Build/test types passed: `.scratch/wiki-import-web-build-1.log` and
  `.scratch/wiki-import-web-types-2.log`.
- `.scratch/wiki-import-web-2.log`: **90/90** related HTTP and shipped-handler DOM
  checks, zero failures/cancellations/skips. Includes all retained shared browsing,
  merge and management-handler checks in the selected files.
- New HTTP cases use two real synthetic vaults, full native HTTP requests,
  independent source/destination keys, separate copy and Wiki confirmation, source
  grant removal, retained-copy integration, exact retries, source/raw state,
  strict permissions/fields, forged plans, bearer/origin rejection, actual waits
  cancelled through disconnect, complete-result bounds and safe completion IDs.
- New DOM cases execute the shipped script and fetch wrapper. They cover both
  checked confirmations; literal full material and affected pages; source and
  authored/classification edits; eight late-response/cancel/navigation/logout
  combinations; no-host retained integration; read-only denial; exact explicit
  uncertain retry; mismatched pins and post-copy completion messages.

Retain `.scratch/wiki-import-web-1.log`: 85 passed, 1 failed and 4 cancelled.
One new test incorrectly expected 401, while existing bearer rejection is 403;
the product authorization behavior was unchanged. The pending-response UI test
awaited its unresolved simulated submit before performing cancellation; the
fixture now starts the handler, cancels/changes the page, then resolves and joins
the same handler. No product deadline or assertion was weakened.

Actual browser/wide and 375px checks, minimum runtime, installed package, both
Git defaults, strict OpenSpec/audit and independent fixed-candidate review are
pending. The CLI/agent minimum-runtime cancellation failures recorded in the
[adapter checkpoint](shared-wiki-agent-verification-2026-10-28.md) remain under
investigation; these passing Web checks do not close that gate.

Database changes: none. Data migration: none. Configuration format changes: none.
Reuse optional host sharing configuration; no real grants/accounts/service edits,
push, npm publication, deployment or exported-skill installation occurred.
