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
| Concurrent opposite-direction imports | Two real vaults import each other's fixed compiled version together within the unchanged bounded test deadline. Both complete one separate capture, preserve existing evidence/Wiki bytes, retain the complete opposite artifact, and make no model call. |

The ordinary-memory bypass regression now also invokes the public health check:
both forged candidate and memory support are reported invalid, without altering
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

Fixed-candidate independent review and the repository-wide checks after these
supplemental test edits remain pending. The earlier
[1033-check checkpoint](shared-wiki-package-verification-2026-10-28.md) is not
silently relabeled as a run of the additional tests.

Database changes: none. Data migration: none. Configuration changes: none.
Only synthetic local grant/config files were used. No real access, push, npm
publication, deployment, external service or account was configured.
