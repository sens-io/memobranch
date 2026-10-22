# Wiki views selected by recorded Git time

Development-source capability, not yet published to npm. This adds a date selector to the existing local committed Wiki reader. It is **not** fact-effective history, “what the agent knew then,” a model-generated historical answer or a claim that old prose was true.

```sh
memobranch wiki snapshot entity:atlas --at 2026-01-15T12:00:00+08:00 --root ./vault
```

```ts
import type { WikiDatedSnapshotOptions } from 'memobranch';
const options: WikiDatedSnapshotOptions = {
  at: '2026-01-15T12:00:00+08:00', pageKeys: ['entity:atlas'],
  signal: new AbortController().signal,
};
const view = await vault.wikiSnapshot(options);
```

Use **exactly one** selector: existing `commit` or new `at` (CLI `--commit` or `--at`). Both/neither are errors. `at` requires a valid ISO timestamp with timezone and at most three fractional-second digits; it normalizes to UTC. A date without time/timezone is rejected rather than guessed as local midnight. Old explicit-hash calls retain their result shape and do not acquire a `selection` field.

MCP and Harness use the existing `memory_wiki_snapshot` with `{ "at": "2026-01-15T12:00:00+08:00", "pageKeys": ["entity:atlas"] }`. The authenticated HTTP route is still POST `/api/wiki-snapshot` with the same body, existing token and Origin checks. There is no new automatic tool, date control in the Web interface or server-side filesystem reader. `signal` belongs to the local library or enclosing host request, never JSON tool/HTTP arguments. The existing Web merge workbench still reads explicit hashes.

## Exact selection rule

Starting at current local HEAD, follow only its **first parent** at each commit. Examine at most 2000 entries, choosing the **first** whose Git **committer** timestamp is at or before `at`, inclusively. Equal timestamps choose the newest entry in that ancestry order. This is not a global “nearest timestamp” sort: parent clocks may go backwards. Author dates, source creation time, page update time and fact-effective intervals do not select the version. Git commits typically have second-level time resolution; requesting fractional seconds does not create more precise historical information.

A side branch's commits are not independently selected. Its knowledge can appear in the selected merge tree when that merge's entry matches the rule. A future requested date selects an eligible existing commit, never predicted future content. These choices are deterministic for the currently observed history, not guaranteed historical chronology.

The program reads up to 2001 metadata entries to detect the bound; only the first 2000 are eligible. If none matches and an older entry remains, it returns `CONTENT_TOO_LARGE` and asks for an explicit full hash. If no local entry matches, it returns unavailable. It never fetches missing history. Local shallow/incomplete history cannot establish that no earlier version existed elsewhere. If the selected commit lacks a requested page, has unsupported configuration/schema or has unavailable required support, the whole read fails; it does not fall back to another commit or substitute today's body.

## Interpreting the result

`commit` is the actual selected content hash. `authorityHead` is the current revision used for authorization. `checkedAt` is the read's check time. The added `selection` contains:

- `kind: "git-committer-time"`;
- normalized `at` and selected `committedAt`;
- `traversal: "first-parent"` and `scannedCommits` (examined entries through the selected one).

Complete pages retain their actual historical metadata, bodies, conditions, uncertainty, provenance and separate `currentRevision`. Find the requested page by key, not by array position. Use the returned full `commit` for repeatable subsequent reads or explicit manual-merge preparation; do not pass the date as a hash or infer approval from a successful read.

**Git timestamps can be backdated or rewritten.** This selector is a convenience for navigating retained local history, not an authenticated record of when information was imported, approved, available to a model or known to an agent. A rewrite or later backdated commit can change what the same `at` selects. Pin the returned hash when repeatability matters. The result includes an explicit warning about these limits.

## Current restrictions remain

All [committed revision restrictions](wiki-revision-views.md) apply, including tenant/read/scope/sensitivity, explicit confidential selection, historical and current source/lifecycle validation, destroyed-key refusal, supported local ancestry, clean managed state, pending recovery and complete dependency checks. Historical ordinary memories must still be effective **now**, not merely at `at`; this date does not change their lifecycle evaluation clock. Current withdrawal cannot be reversed by an earlier date.

Resolution and body reading share the existing settled read; cancellation, HEAD/managed drift and real post-lock cleanup checks remain in force. Git replacement objects are ignored, grafts/promisor configurations are refused before traversal, and notes/signatures/display additions are excluded from the history parser. No checkout, ref/index change, source rewrite, model request, old-key recovery or approval occurs. Arbitrary external writers are not prevented by an operating-system lease; observed changes cause refusal.

Existing limits still apply: 1–25 selected keys, 50 dependency pages, 200 records, per-blob/aggregate stored-byte limits, MCP/Harness 9 MiB escaped-result allowance and HTTP's own review allowance. Oversized results fail rather than truncate. Existing per-command Git deadlines and parent cancellation remain; no new whole-operation deadline or OS memory sandbox. Returned authorized confidential text is plaintext and cannot be recalled after copying.

No database, configuration, dependency, cache or vault-format migration. No push, release or deployment. Full as-known-at answering, historical truth assessment, shared-vault grants and cross-branch/private-vault merging remain separate capabilities.
