# Explicit knowledge availability (development source)

Library core candidate; CLI, agent tools and Web adapters are not yet implemented.
This is separate from Git-date revision views and fact-effective time queries.
No npm publication or real-world model knowledge measurement is implied.

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
