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
of an installed consumer for that aggregate occurred. No Node Linux image is
currently installed locally, so no additional Linux result is claimed.

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
Corrected full checks and fixed-candidate re-review remain pending.

Database changes: none. Data migration: none. Configuration changes: none.
Only synthetic local grant/config files were used. No real access, push, npm
publication, deployment, external service or account was configured.
