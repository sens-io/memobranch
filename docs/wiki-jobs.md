# Durable local Wiki compilation

Development-source feature; not yet published to npm. Imports save evidence; these jobs turn **existing evidence IDs** into a persisted proposal. Running a worker never approves pages or writes canonical evidence/Wiki/Git. Review and apply remain separate.

## Submit, work, review

Set the existing `AMEM_MASTER_KEY` securely to the vault's correct 32-byte key. It is required for **all jobs**, even public inputs: a compiler may read private navigation and produce private text. Never put real keys in commands, source control, logs or plans. Model settings use the existing environment/configuration and are not saved in jobs.

```sh
memobranch wiki jobs enqueue ev-0123456789ab --root ./vault
# A separate process can run one job, drain one queued item, or wait for more.
memobranch wiki jobs run wj-00000000000000000000000000000000 --root ./vault
memobranch wiki jobs work --once --root ./vault
memobranch wiki jobs work --root ./vault

memobranch wiki jobs list --root ./vault
memobranch wiki jobs show wj-00000000000000000000000000000000 --root ./vault
memobranch wiki jobs preview wj-00000000000000000000000000000000 --root ./vault
# Explicit review permission is required; no --apply flag exists on workers.
memobranch wiki jobs apply wj-00000000000000000000000000000000 --root ./vault
```

Replace example IDs with returned real IDs. `work` stays in the foreground; an operator can run it in their process manager. This does not install a service, scheduler or automatic startup. `--once` claims at most one queued item. `run` on an unavailable-to-run terminal/live job returns `null`, not a fabricated new success; inspect its status separately. Missing/foreign job IDs fail. CLI failure/cancellation exits nonzero; Ctrl+C/SIGTERM stop the active attempt and waiting loop. Output is JSON (one result per completed attempt for the loop), without raw provider errors or source bodies. `plan <id>` explicitly returns the signed plan; handle it as sensitive plaintext if redirecting it to a file.

```ts
const submitted = await vault.wikiEnqueue({ evidenceIds: [evidenceId], maxPages: 20 });
const controller = new AbortController();
const completed = await vault.wikiRunJob({ id: submitted.id, signal: controller.signal, timeoutMs: 120000 });
const status = await vault.wikiJob(submitted.id);
const jobs = await vault.wikiJobs();
// Explicitly inspect, then separately authorize application.
const plan = await vault.wikiJobPlan(submitted.id);
const preview = await vault.wikiPreviewJob(submitted.id);
const review = await vault.wikiReviewJob(submitted.id); // plan + comparison from one locked read
// Inspect review.preview and apply only that displayed proposal:
// await vault.wikiApplyJob(submitted.id, review.plan.proof);
```

## State, cancellation and retry

Statuses: `queued`, `running`, `ready` (proposal saved), `duplicate` (the existing compiler verified completed canonical ingestion), `failed`, `cancelled`. Running stages distinguish `compiling` and `validating`; there is no invented percentage. `ready` records that compilation completed then, **not** that the plan is still current or approved. Plan retrieval/preview/apply reject changed configuration, knowledge or support lifecycle, and insufficient current authority, using existing signed-plan checks. Broader current authority does not broaden the job's original context. Enqueue a new job to recompile changed context; explicit retry is for failed/cancelled jobs.

## Web console (development source)

Open the existing authenticated console and choose **编译任务**. This page is not yet in the published npm release. The startup process still supplies the master key, model credentials, identity and tenant; the browser cannot set them.

- Submit 1–40 existing evidence IDs and a 1–40 page limit. Submission only saves a queued task. **执行一次** explicitly requests one attempt; **重新排队** does not execute it automatically.
- The server acknowledges accepted execution before compilation completes. Check persisted status; acknowledgement is not success or even proof that a competing CLI worker did not claim it first. One Web handle owns at most one attempt. It never drains the queue or installs a scheduler.
- Leaving, reloading or disconnecting the browser stops page polling, not an accepted compilation. Use **取消任务** to save a cancellation request. Normal Web shutdown cancels and awaits its own attempt, not independent CLI workers; abrupt termination follows the existing dead-worker detection rules.
- The page polls one metadata request at a time, normally every two seconds, and pauses while hidden. Opening a ready task reads its plan and before/after comparison consistently. Approval sends the displayed proof, refusing a different plan produced by cancel/retry. API users can obtain the same pair with `wikiReviewJob(id)` and pass its `plan.proof` to the optional second argument of `wikiApplyJob`.
- An apply response explicitly reports its Git commit. The stored job status remains compilation status (`ready`), not an approval ledger; after reload use Git history/current pages to check prior application. Reapplying a changed/stale plan is refused. If a request fails or its result is unknown, inspect task/history before retrying; repeated independent submissions are not automatically deduplicated.

New authenticated POST routes: `jobs-list`, `jobs-show`, `jobs-enqueue`, `jobs-run`, `jobs-cancel`, `jobs-retry`, `jobs-remove`, `jobs-review`, `jobs-apply`. All mutations require `confirm:true`; apply also requires the displayed 64-character `proof`. Job-specific requests use `{id}`; enqueue accepts only evidence IDs and optional page limit. List/show disclose metadata only; review may return sensitive plaintext. Review responses are limited to the existing 16 MiB budget. Identity, permission, tenant, original ceiling, runtime recovery and source checks remain in the core; no generic wider-context plan is substituted.

`cancel <id>` persists a request; a live attempt checks every 100 ms and aborts only its own model operations. Cancellation before or after compilation prevents publishing a usable late plan. `retry <id>` explicitly returns failed/cancelled work to the queue; at most three attempts can enter compilation. A job-level deadline defaults to 120 seconds, configurable from 1–300000 ms. Existing per-request model time/byte limits and bounded model-client transport retries still apply; a worker does not automatically rerun a failed job.

After an actual process death, the next worker marks the abandoned attempt failed/cancelled but does not requeue it. Explicit retry can repeat paid model calls if the prior process died after a provider accepted them; exactly-once billing is not promised. A PID is never stolen while live. PID reuse and separate PID namespaces are not solved: use this on one local host, not a shared distributed filesystem. `remove <id>` deletes terminal/queued job state and its encryption key; a live job must settle first. Independent enqueues create independent jobs; use the returned job ID to retry/inspect existing work rather than repeatedly submitting.

## Authority, encryption and erasure

Jobs bind vault, tenant, submitting identity and the original scope/sensitivity ceiling. They store evidence IDs, not a second raw-source archive. Inspection requires current read authority covering the original ceiling; running/mutating additionally requires current write authority. Only the submitting identity can access its jobs. A later broader identity with the same ID still compiles under the original ceiling; the queue never replays old permissions as a grant. Job-specific preview/apply helpers preserve that ceiling, with **current** review permission required to apply. Manually exported plans retain their original snapshot context; using a differently scoped generic vault to preview/apply them may intentionally fail. Default workers skip queued jobs outside their current ceiling so they do not block eligible work; explicitly naming such a job still fails. Cancel/remove can clean up one's job after its context ceiling has narrowed, but still require current tenant/read/write authority and the correct master key. Cancellation does not revoke a signed plan previously exported and independently held by an authorized reviewer.

State and plans are authenticated-encrypted using per-job data keys under the existing vault key store. Runtime files are private and ignored by canonical Git. File/directory symlinks, oversized or malformed state fail safely. The queue shares the canonical writer lock only for short state/key changes and final validation; provider calls run outside it. Pending canonical recovery must be handled using the existing recovery workflow first.

Canonical cryptographic erasure invalidates **all** retained plans and running claims because a plan may have copied the erased page's title through navigation. Every retained job's old data key and ciphertext are removed **before** creating a replacement key: even a failed or queued record can have an unpublished temporary plan left by a killed process. Plans and active claims become content-free failed states; other records keep their existing status and metadata. A late worker cannot restore its plan, and old temporary ciphertext cannot be decrypted with the replacement keys. Interrupted cancellation/erasure may remove a cached job entirely; recovery accepts an absent cache or drops a keyless old file, never pairs old ciphertext with a replacement key. A removal interrupted after key destruction is skipped by listing/workers; an administrator can remove that opaque orphan by ID. This does not erase provider-side copies or independent backups; erasing a Wiki page is not erasing independent immutable evidence. Corrupt runtime state can require operator repair before erasure; do not bypass validation or restore erased keys.

## Bounds and remaining work

100 retained jobs per vault, 1–40 unique evidence IDs per job (every input needs a source page within the existing 40-draft limit), 1–40 maximum selected pages, 5 MB serialized plaintext state and 8 MB encrypted file. One live job per submitting identity; explicit test races remain covered. Remove terminal jobs to reclaim capacity. `work --poll-ms` accepts 100–10000 ms and defaults to 1000 ms for idle polling.

No new runtime configuration schema, database migration, model credentials, network source connector, MCP/Harness job endpoint or automatic approval is added. This is process-crash recovery, not a tested power-loss durability or distributed-job guarantee. Job scheduling, task-specific context ceiling options, automatic retention, PDF, article extraction and team knowledge merges remain separate work.

Before downgrading, stop workers and remove retained jobs using this version (each owner cleans up their jobs). Older application versions do not know how to invalidate these caches during canonical erasure; do not mix old canonical writers/erasers with new queue workers or retained plans.
