# Wiki import recovery and concurrency verification

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Product code remains the installed-package checkpoint `e558e462`; this supplement
adds tests and evidence, without changing product permissions or runtime behavior.
It does not accept the whole batch or replace the retained minimum Node 20 adapter
failures in the [agent record](shared-wiki-agent-verification-2026-10-28.md).

## Coverage gaps found while checking the task list

The prior shared reader had an opposite-direction read test, and generic Wiki
approval had process-crash tests. Neither directly exercised a confirmed compiled
source import at its own evidence/commit boundaries. A new
`test/wiki-import-recovery.test.ts` uses actual vaults, real Git operations and
real child termination, rather than treating generic transaction tests as proof.

| Scenario | Observed assertions |
| --- | --- |
| SIGKILL after evidence or log write | A real `writing` journal survives; reopening rolls back the complete canonical files, HEAD/refs, staged diff and status. A later confirmation creates exactly one artifact and one capture commit. |
| SIGKILL after readiness or Git commit | A real `ready` journal survives; reopening replays to exactly one capture commit. Exact retry returns the retained artifact with no commit; further recovery and retry change no canonical bytes. |
| Cancellation at readiness and after commit | The safe section runs without the invocation signal; cancellation returns the actual capture commit hash. The confirmed artifact remains, exact retry creates nothing, and Wiki knowledge stays unchanged. |
| Cancellation in the actual destination writer queue | Only the importing contender is removed; the unrelated owner's lock/ticket survives. No canonical write occurs and cleanup leaves no journal or lock ticket. |
| Concurrent opposite-direction imports | Two real vaults import each other's fixed compiled version. A barrier requires both actual import operations to reach capture before either proceeds, within the unchanged bounded deadline. Both complete one separate capture, preserve existing evidence/Wiki bytes and retain the complete opposite artifact. This demonstrates this concurrent execution, without claiming a general proof about every lock schedule. |

The ordinary-memory bypass regression now also invokes the public health check:
both forged candidate and memory paths are individually reported invalid, without altering
the artifact or canonical state. Existing extraction/proposal/approval/
consolidation/read refusal assertions remain unchanged.

## Executed results

- Initial Node 22 dedicated recovery file: **8/8**, exit 0,
  `.scratch/wiki-import-recovery-node22.log`.
- Node 22 recovery + retained import + manual integration: **36/36**, exit 0,
  zero failures/cancellations/skips, `.scratch/wiki-import-recovery-related.log`.
- The initial supplemental TypeScript emission refused two accesses to the
  health check's optional `documents` result. Adding an explicit existence
  assertion corrected the test typing; no product or behavioral assertion was
  removed. Preserve `wiki-import-recovery-compile.log` as the failed attempt.
- Corrected compilation passed in `wiki-import-recovery-compile-2.log`. The same
  **36/36** tests then passed using compiled files on **Node 20.0.0**, exit 0,
  zero failures/cancellations/skips, `.scratch/wiki-import-recovery-node20.log`.
  Child crash workers import the corresponding compiled files on Node 20; this
  run does not replace real subprocess checks with a mocked runner.

The two previously failed Node 20 adapter startup checks are distinct and remain
failed. No test/runtime upgrade, deadline increase, fixture removal or substitution
of an installed consumer for that aggregate occurred. At that earlier core
checkpoint no Node Linux image was installed locally and no Linux result was
claimed. The later [Linux supplement](shared-wiki-import-linux-verification-2026-10-28.md)
records the separately downloaded test image and actual corrected runs.

Independent read-only review of `ed144b9b` covered 5/5 files, zero skipped, and
confirmed the real crash/recovery boundaries and receipts. It found a verification
gap: the parent fixture's source counter could not observe a model call in the
new child, which inherited the host environment. It also identified overbroad
concurrency wording and a health check assertion that counted errors without
matching each forged path. These are verification limitations, not confirmed
product-function defects.

The correction guards all four public model entry points in the parent and worker;
the worker clears inherited model credentials, synchronously records every attempt
and throws before transport. A marker must remain absent/empty after each actual
child exit, so a swallowed model error still fails. The original source fixture
counter remains. Health errors must now match both paths individually. The
opposite-direction test requires both calls to reach the capture barrier before
either continues, and its title/report no longer claim a universal lock proof.

The initial `ed144b9b` repository-wide rerun completed before these corrections:
each Git default passed **1017 functional + 14 release + 10 evaluation = 1041**,
zero failures/cancellations/skips (`wiki-import-full-{main,master}-3.log`). Those
results and the earlier
[1033-check checkpoint](shared-wiki-package-verification-2026-10-28.md) do not
silently stand in for corrected-candidate results. The corrected **36/36** related
checks passed on both Node 22 and compiled Node 20.0.0, zero failures,
cancellations or skips (`wiki-import-recovery-related-2.log` and
`wiki-import-recovery-node20-2.log`). Types and corrected compilation passed in
`wiki-import-recovery-types-2.log` and `wiki-import-recovery-compile-3.log`.
Corrected full checks and fixed-candidate re-review are recorded below.

Read-only re-review of `f5e5ad89` covered 4/4 files, zero skipped, and confirmed
the worker guard, per-path health assertions and capture barrier. It found one
narrow remaining observation gap: the opposite-direction fixture's own Wiki stub
bypasses prototype mocking, and its source counters were recorded after prepare.
The counter baselines now precede both preparations; no behavioral assertion or
deadline was removed. The final recovery file passed **8/8** on Node 22 and compiled
Node 20.0.0, with zero failures/cancellations/skips, in
`wiki-import-recovery-counter-{node22,node20}.log`. Corrected test compilation
passed (`wiki-import-recovery-counter-compile.log`). Final full/re-review is recorded below.

The original complete compiled Node 20 adapter collection was also rerun from the
current compilation, without substitutions: **35/37**, the same two actual CLI
source-wait observations failed at their original 10-second bounds, exit 1
(`wiki-import-adapters-node20-current-full.log`, 134722.676459 ms). The recorded
child outcomes were `code null`, `signal SIGTERM`, empty stderr. Earlier macOS
stack samples remain relevant diagnostics, not a new causal finding or a passed
gate. The stronger recovery tests do not turn this failed aggregate into success.

Independent final re-review of `833a330c` covered the counter correction and this
record (2/2, zero skipped); the last fixture observation gap was closed, with no
new confirmed issue in that scope. Its separate OCR specification correction was
reviewed independently (1/1); it is not an import-product change.

## Task verification mapping

These entries map the first eight functional tasks to actual scenarios. They do
not replace the still-failed final minimum-runtime aggregate or accept the batch.

| Task | Inspected executable evidence |
| --- | --- |
| Two vaults, fixed version, origin, no source writes/model calls, retry | `shared-wiki-import.test.ts` first capture/no-write and retry cases; installed consumer's five first captures, source/raw/model guards and persisted-field checks in the [package record](shared-wiki-package-verification-2026-10-28.md). |
| Current authority, keys/grants/pin/config and plan/classification refusal | `shared-wiki-import.test.ts` independent permissions, source change/withdrawal and current-secret floor cases; `shared-wiki.test.ts` key erasure/selection and changed binding guards; `wiki-integration.test.ts` stale/foreign/secret and classification cases. The related core checkpoint passed 236 checks. |
| Final waits, lifecycle, cancellation, rollback/recovery and two-way concurrency | Actual source-expiry destination wait in `shared-wiki-import.test.ts`; `wiki-integration.test.ts` destination waits and expiry; the eight real child/ready/cancel/dual-capture cases above, including final 8/8 under each runtime. |
| Restrictions through model/manual/apply/read/public paths | `shared-wiki-import.test.ts` restriction-dropping compiler, current conflict/expiry, public projection refusal; `wiki-integration.test.ts` stricter authored classification, local conflict and retained provenance. |
| Duplicate expiry/concurrent capture | `shared-wiki-import.test.ts` unrelated-memory expiry and concurrent identical confirmations; `wiki-integration.test.ts` post-approval expiry replay. Canonical bytes and generated content remain unchanged on retry. |
| Ordinary-memory support refusal | `shared-wiki-import.test.ts` extraction/proposal/approval/consolidation/get refusals plus public health validation matching both forged record paths. Raw artifact inspection remains authorized and unchanged. |
| Manual create/update, stale revisions and conflict/provenance | The 14 `wiki-integration.test.ts` cases, 36/36 related run, installed library/CLI/MCP/Web/Harness separately authored/applied targets and source summaries. |
| Complete strict adapter output and actual UI cleanup | 63 retained CLI/SDK checks in the [agent record](shared-wiki-agent-verification-2026-10-28.md); 90 HTTP/DOM checks and actual 1280px/375px review, invalidation/navigation/logout in the [Web record](shared-wiki-web-verification-2026-10-28.md). The minimum Node 20 aggregate remains separately failed. |

## Final corrected checkpoint

Both complete repository checks of the `833a330c` correction exited 0, serialized:
**1017 functional + 14 release + 10 evaluation = 1041 per Git default**, zero
failures, cancellations or skips. Build and all test types passed in both logs:
`.scratch/wiki-import-full-main-4.log` and `wiki-import-full-master-4.log`.
The later `9ae54606` commit changed only OCR design/verification documents.
Strict specs passed **32/32**, including the new pending OCR proposal.

Product code, dependency manifests and package verifiers have no changes relative
to the previously verified `982cb567` checkpoint. The same installed archive still
has SHA-256 `07d621aa54a5d6455f5b9a2d98014d1641acd38b8f9016f3dd8471e1d30b40af`;
its complete Node 20/22 consumers and strengthened public-entry-point checks
remain the [recorded installed results](shared-wiki-package-verification-2026-10-28.md).
No fresh package run or new audit is invented: the unchanged dependencies retain
the recorded production audit of 0 vulnerabilities. Fixed-candidate test/spec/
design reviews are recorded above and in the OCR design checkpoint.

The last combined task remains unchecked because the original full compiled
minimum Node 20 adapter collection on macOS still failed **35/37**. Passing full Node 22,
installed Node 20 consumers, or additional Node 20 recovery tests cannot substitute
for that failed result. Independent final record review of `8a4dd8a8` covered all
7/7 changed files in two disjoint scopes (3/3 and 4/4), zero skipped, and found no
confirmed new issue in those records. It confirmed that the failed minimum-runtime
gate remains open; no batch or complete-roadmap acceptance is claimed.

The [supplemental Linux check](shared-wiki-import-linux-verification-2026-10-28.md)
later ran that same complete collection under **Node 20.0.0** with unchanged
assertions/deadlines: **37/37 under each actually probed Git default**, no failures,
cancellations or skips. The initial environment-only default labels were found
insufficient and are not counted as both defaults; corrected runs first performed
actual implicit initialization. This is additional Debian arm64 evidence, not a
GitHub CI result or a claim that the retained macOS startup waits are fixed.

Database changes: none. Data migration: none. Configuration changes: none.
Only synthetic local grant/config files were used. No real access, push, npm
publication, deployment, external service or account was configured.
