# Explicit fact-effective time

Development-source increment, not included in the published npm 1.1.0. This annotates **ordinary approved memories**, not arbitrary Wiki pages or raw evidence, and returns retained records rather than a model-generated historical answer.

## Record time is not fact time

`createdAt` records when MemoBranch saved a memory. `validFrom` is an explicitly reviewed inclusive start; `validUntil` is an exclusive end. Neither is inferred from creation, validation, replacement or a source's recorded date. Missing bounds are unknown. `expiresAt` remains a current retrieval/retention restriction, not the fact's effective end.

First capture evidence, propose and approve through the existing workflow. Inspect the memory's current ID and revision, then annotate deliberately:

```sh
memobranch get mem-0123456789ab --root ./vault
memobranch memory validity mem-0123456789ab --root ./vault \
  --from 2026-09-01T00:00:00+08:00 --until 2026-10-01T00:00:00+08:00 \
  --expected-revision 1 --confirm
memobranch memory at 2026-09-15T12:00:00+08:00 --root ./vault --key 'Atlas retention'
```

Use a real ID and inspected revision. Both bounds are required on annotation; `--from unknown` or `--until unknown` explicitly clears that bound. Dates must be valid ISO timestamps with a timezone and at most three fractional-second digits. UTC normalization is returned. Equal/reversed intervals are rejected. Annotation requires current review permission, atomically checks the revision, preserves body/evidence/creation/validation/status, increments the revision only for a change and produces the usual Git audit. It does **not** revalidate the truth of the statement. Revoked/erased records cannot be reactivated this way.

```ts
const saved = await vault.setMemoryValidity(memoryId, {
  validFrom: '2026-09-01T00:00:00Z', validUntil: '2026-10-01T00:00:00Z', expectedRevision: 1,
});
const view = await vault.memoriesAt('2026-09-15T00:00:00Z', { key: 'Atlas retention', limit: 30 });
```

This is an explicit annotation of an existing record, not automatic temporal extraction from a proposal. Approving an identical statement through existing deduplication retains that memory's interval; use annotation explicitly to change it. Annotation does not close/split other intervals, repair supersession or automatically resolve conflicts. In particular, approving a future replacement still uses the existing whole-record supersession behavior; this increment does not schedule a future switchover.

## What a dated read means

`memoriesAt(at, options)` / `memory at` / `memory_at` returns the **latest retained revision and latest reviewer annotation**, with recorded/updated/validated times, current status, actual evidence paths and explicit uncertainty. It is not what the system knew at that date, a Git checkout or proof that the statement was true. Superseded and conflicted retained records are marked as such, not silently promoted to active facts.

- Both bounds absent: excluded by default. Request `includeUnknown: true` / `--include-unknown` to see them with unknown-time warnings. A single explicit bound can match, with the other endpoint marked unknown.
- Current tenant/read/scope/sensitivity and evidence access apply **before** counting and paging. Confidential records still require explicit selection and the correct key; Harness and Web dated reads do not opt into confidential selection.
- Current revocation, erasure and expiry still exclude content even if the requested date is earlier. There is no old-key recovery or old-permission replay. No model call or canonical write is performed.
- `key` matches an exact normalized ordinary-memory key, not arbitrary full-text search. Paging supports offset ≥0 and limit 1–100, additionally capped by the vault's result limit. All matching records must be authorized before total counts are returned.

MCP and DeepSeek Harness expose read-only `memory_at` with `at`, optional `key`, `includeUnknown`, `offset`, `limit`. MCP also permits explicit `includeSensitive`/`includeSecret`, subject to current policy and key checks. Time annotation is provided by the local library/CLI and confirmed authenticated HTTP, not a new model write tool.

HTTP POST `/api/memories-at` accepts the dated read fields without confidential opt-ins. `/api/memory-validity` requires `{id, validFrom, validUntil, expectedRevision, confirm:true}` with nullable bounds. Existing Host/Origin/token, JSON limits and permission checks remain. These are programmatic routes; this increment does not add browser date controls.

## Current use and Wiki dependencies

Current search, semantic scoring, complete-record recall and resident context exclude ordinary memories outside their interval. Complete records include dates and temporal conditions. Existing undated memories remain usable as before; a dated view is deliberately stricter about unknown time than ordinary current retrieval.

Wiki navigation represents ordinary memories as legacy pages. Those projections include temporal conditions and the earliest effective end/expiry. Outside the interval, both the legacy record and pages actually linked/dependent on it become unavailable through existing transitive checks. Changing its annotation invalidates older signed snapshots. An independently compiled Wiki page that merely shares raw evidence is **not** automatically assigned the ordinary memory's interval; raw evidence and Wiki pages have separate lifecycles. Historical Wiki answering and full temporal dependency modelling remain future work.

Generated `MEMORY.md` and public catalog files are last-write projections, not live clock-driven queries. Generated resident entries show explicit date conditions. Time passing alone does not rewrite Git or those files; use current APIs for current context, and do not treat a static resident file as an automatically refreshed answer.

## Compatibility and limits

No database/configuration schema change, bulk migration, new credentials, model inference or background scheduler. The derived search cache version changes from 5 to 6 and rebuilds through existing index validation. Annotation is an ordinary recoverable canonical transaction and uses existing encryption policy.

Do not mix old readers/writers with annotated memories: earlier versions do not enforce these fields. Stop old processes before using this feature. Do not downgrade with annotated records in use; clearing annotations explicitly removes their constraints and is a review decision, not a safe automatic migration. No push, npm publication or deployment is implied by this source feature.
