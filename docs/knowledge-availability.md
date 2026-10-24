# Explicit knowledge availability (development source)

Library core accepted locally; CLI/MCP/Harness adapters are implemented in development
source, with their final retained/installed review pending. Web management is also
implemented in development source and undergoing verification.
This is separate from Git-date revision views and fact-effective time queries.
No npm publication or real-world model knowledge measurement is implied.
See the [core verification and limits](knowledge-availability-verification-2026-10-24.md).

```ts
const recorded = await vault.wikiObserveAvailability({
  pageKeys: ['concept:deployment'], confirm: true,
});
const view = await vault.wikiAsKnownAt({
  pageKeys: ['concept:deployment'], at: recorded.observedAt,
});
```

Observation explicitly requires read/write access. It reads selected pages at
current clean HEAD and records a signed immutable manifest of exact committed
pages, sources and rules. It does not approve, modify or execute their contents.
Mixed nonpublic scopes must be observed separately. Record classification cannot
be lower than its dependencies; sensitive/secret data additionally requires
`includeSensitive`/`includeSecret` before decryption. Source/config/HEAD and current
authority checks repeat before persistence, including a synchronous final check.

`observedAt` is a host-generated local clock timestamp, not a Git author/committer
date. The local clock and proof key are trusted operational inputs, not external
timestamp certification. Observing an existing page does not establish its first
availability or that an agent read, understood or believed it. This supplies only
partial explicit observations. Legacy history and unverifiable/forged markers
remain unknown. Losing the local proof key does not create replacement trust.

Query selects each key's latest verifiable observation not later than `at`.
Different versions of a key's required documents or rules at the same latest
recorded instant are unknown, not chosen by filename order. The result includes
`coverage.mode` and separate `observed` or
`unknown` items. Only observed items contain exact committed snapshots. It calls
no model and creates no observation or canonical write. It is not future advice.

Current tenant, operation/classification access, source integrity, decryption keys,
lifecycle and expiry still apply. A selected old version that is no longer readable
fails rather than falling back to older knowledge to evade withdrawal. History
does not recover erased keys. Sources/rules and exact historical document hashes
are checked through the existing local snapshot mechanism; local proof keys are
not Git-shared or exported. Offline plaintext copies cannot be recalled.
The active built-in rule implementation is also hashed; a changed implementation
cannot silently substitute for the observed one.
Each requested key binds only its own complete dependencies; unrelated companion
pages, request order and their built-in rules cannot manufacture a conflict.
Reads use one consistent locked snapshot. An already-started read overlapping a
later withdrawal can complete from that snapshot; a subsequent read must honor
the withdrawal. This is not a promise to recall plaintext already read or copied.

Bounds: 1–25 selected keys, existing snapshot dependency limits, at most 200 manifest
documents and 160,000 manifest characters, and at most 20 MB of complete query
output. A default query scans up to 2,000 currently readable/selected evidence
records or 20 MB. Exceeding a limit is an error, not truncation. For a bounded
explicit subset, supply 1–40 distinct `observationIds`. The result then clearly says
newer/conflicting observations outside that set were not searched. Opting into
private scans can require unrelated selected records' keys; an unavailable key is
an error, not a silently omitted count. Existing snapshot integrity checks remain.

Both library methods accept an actual optional `AbortSignal` as `signal`; JSON
signal/executable/identity overrides are not accepted. Stop requests cannot undo a
ready transaction already settling. Post-save authority failures carry only
`completedAvailability` (saved evidence ID/commit), without manifest plaintext;
ordinary committed-cancellation metadata remains available. Inspect current records
and history before retrying. No database, migration or required configuration.

## CLI and agent tools (development source)

```sh
memobranch wiki observe concept:deployment --confirm --root /path/to/vault
memobranch wiki as-known-at concept:deployment --at 2026-10-24T12:00:00Z --root /path/to/vault
# Restrict coverage explicitly; this does not rule out outside observations:
memobranch wiki as-known-at concept:deployment --at 2026-10-24T12:00:00Z --observations ev-0123456789ab --root /path/to/vault
```

Both commands support `--include-sensitive` / `--include-secret` with current
authorization and keys. `observe` requires `--confirm`; it cannot accept an `--at`
or `--observed-at` override. `as-known-at` requires `--at` and does not accept a
commit/apply/confirmation flag. Stop signals cancel the command's own operation;
completed transactions remain distinguishable from failed, uncommitted work.

MCP and DeepSeek Harness expose `memory_wiki_observe` (`pageKeys`, `confirm:true`,
optional private flags) and `memory_wiki_as_known_at` (`pageKeys`, `at`, optional
`observationIds` and private flags). Identity, tenant, root, clock and cancellation
are host-owned. Harness registers observation only with both read/write grants and
the historical reader only with read; MCP still rejects unauthorized execution.
Agent results must fit 9 MiB including escaping; over-budget complete results fail,
never silently truncate. No automatic observation, model evaluation or approval.

## Local Web management (development source)

Open **知识可用时间** (Knowledge availability) in the authenticated local console.
Enter 1–25 keys, one per line, and select authorized confidential material explicitly.
Recording current content requires a separate cancel-first confirmation dialog and
current read/write access. The receipt shows the saved evidence ID, host-generated
observation time and observed content commit. Recording does not automatically query.

To read, enter an ISO timestamp with timezone; optionally restrict observation IDs
one per line. The explicit “only this observation” receipt action selects that ID
and time and then performs a read. Results distinguish observed/unknown, display the
actual commit, complete page/source/rule JSON and coverage warnings. Source content
is plain text, never executed HTML. Web output must fit 16 MiB including its JSON
envelope; over-budget complete results fail rather than truncate.

Edits clear old results. Stop cancels this page's operation without automatic retry;
an already-decided save may still complete, so inspect evidence/history first.
Valid post-save errors show only saved evidence/commit IDs. Navigation/disconnect
closes an unconfirmed dialog, aborts pending reads and clears the page's form/results;
late responses cannot restore them. No browser persistence, new credentials, model
call, automatic knowledge approval or permission changes are introduced.
