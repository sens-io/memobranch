# Verification log

## First candidate (2026-09-09)

Candidate df5600c, based on a765ca7. The implementation commits were recovered onto the feature branch on 2026-09-10 as 6fa5b73, 5c0cf66 and cf73db3, with unchanged code content.

- macOS / Node 22.6.0: full build and 105/105 tests passed, no skips, under main default branch. The preceding master-default run passed 104/104 before the final unknown-commit-outcome regression was added.
- Linux / official node:20-bookworm container: fresh locked dependency install, build, 105/105 tests with master default, production audit (zero reported vulnerabilities), actual package install and real Harness capture all passed. Source was read-only mounted and copied into the disposable container.
- macOS actual tarball installation and compiled exports / Bundle patch / Harness permission visibility / evidence capture / CLI smoke passed; 68 package entries.
- Isolated read-only review independently ran 105/105 tests but REJECTED the candidate: a real Git index.lock could block reset after reconciliation metadata had been discarded, leaving no recoverable snapshot. Its package attempt was blocked by sandbox npm cache access, so independent package approval was not claimed.

## Precommit recovery review (2026-09-10)

An isolated read-only validator passed strict test typechecking and 17/17 targeted tests, but rejected the initial durable-intent patch. Its independent real bare-remote `pre-receive` rejection left a permanent `pushing` intent: restarted recovery, synchronization and capture were blocked even after the rejecting hook was removed. This was confirmed before the candidate was committed.

The revised implementation distinguishes a normally completed single-ref Git porcelain rejection, pre-dispatch cancellation and an uncertain transport outcome. The first two permit compensation; the last retains the attempted revision until sync-authorized remote confirmation. A real hook regression and a pre-dispatch cancellation regression verify exact state restoration and subsequent capture/push success. Public diagnostics now count the outer recovery intent.

## Committed candidate 727bdef (2026-09-10)

The following checks executed against the source and regression content committed as `727bdef`; no existing test assertion was relaxed to pass them.

| Check | Result |
| --- | --- |
| macOS / Node 22.6.0, normal main default: build, strict source/test types, full suite | 115/115 passed; zero skips; 30.00 s test duration |
| macOS / Node 22.6.0, explicit master default: same full gate | 115/115 passed; zero skips; 26.93 s test duration |
| Linux / official node:20-bookworm, explicit master default, fresh locked dependencies | build and strict types passed; 115/115 tests passed; zero skips; 9.92 s test duration |
| Linux production dependency audit | zero reported vulnerabilities |
| macOS actual tarball installation | 68 entries; compiled exports, bundle patch, real Harness capture, permission visibility and CLI smoke passed |
| Linux actual tarball installation | same installed-package gate passed, 68 entries |
| All OpenSpec changes and canonical specs, strict validation | 8/8 passed |

The Linux run mounted the source read-only and copied it without local dependencies or build artifacts into a disposable container. Neither installation test publishes a package. No GitHub push or hosted-CI rerun was performed.

Boundary coverage includes a real reset-blocking Git index lock; a fresh process facade restoring malformed, future-schema and changed-tenant remote configuration using original-tenant authorization; cleanup failure after reset; blocking the next writer; idempotent recovery; confirmed push with bookkeeping failure; unknown-push authorization and diagnostics; and confirmation by a later remote descendant. The existing cancellation, permission, encryption, provenance, lexical/semantic, CLI, MCP and Harness tests remain in the full retention suite.

### Isolated final review

Read-only review of committed candidate `727bdef` was initially interrupted by the platform's workspace-credit error. At that point no final verdict was delivered and no approval was claimed. Passing tests alone were not treated as final acceptance.

The review subsequently resumed and **RETURNED** `727bdef`. It independently passed 36 Git/sync/cancellation tests plus 14 authorization/provenance tests (50/50, no skips, macOS Node 26.8.2 / Apple Git 2.39.3), and reproduced another P1 using actual Git: a failed index reset during rejected remote configuration skipped volatile remote compensation; restarted recovery deleted the journal while the Git remote and index remained inconsistent. The failed child scope was completed locally by the isolated reviewer. The reviewer did not independently execute Linux or package gates.

## Committed candidate c3e049f (2026-09-10)

Five new regressions independently reproduced the uncorrected behavior: URL change, remote rename, remote removal under an actual index lock; and actual Git config-lock failure immediately after remote mutation or during commit rollback. Baseline: 0/5 passed. With the repair: 5/5 passed, and the combined Git transaction / sync boundary set passed 26/26. They assert exact original HEAD, configuration, log, Git remotes and unrelated staged/unstaged content after restart, a retained journal while compensation is blocked, and a successful subsequent operation.

Remote configuration changes are now journaled before Git mutation, with original/desired values. A durable index-cleanup marker survives the transition from ready to rollback. Rollback/recovery cannot retire the journal until file restoration, scoped index reset and remote compensation all succeed; ready replay uses the desired remote settings. Committed and uncertain outcomes retain their existing semantics.

| Final-candidate check | Result |
| --- | --- |
| macOS / pinned Node 22.17.0, main default, full build / strict types / tests | 120/120 passed, no skips; 32.48 s test duration |
| macOS / pinned Node 22.17.0, master default, same full gate | 120/120 passed, no skips; 33.30 s test duration |
| Linux / official node:20-bookworm, fresh locked install, master default | full build / strict types passed; 120/120 tests, no skips; 12.11 s test duration |
| Linux / official node:22-bookworm (22.23.2), fresh locked install, main default | full build / strict types passed; 120/120 tests, no skips; 9.26 s test duration; strict OpenSpec 8/8 |
| Linux production dependency audit | zero reported vulnerabilities |
| Actual tarball installation on macOS Node 22 and Linux Node 20 | exports, bundle, real Harness capture / permission visibility and CLI smoke passed; 68 entries on each |
| Linux Node 22 production audit and actual tarball installation | zero reported vulnerabilities; same package/Harness/CLI gate passed, 68 entries |
| Strict OpenSpec validation | 8/8 passed |

The shell's default Node changed during the resumed session; the final macOS gates explicitly pinned the installed Node 22.17.0 runtime. The reviewer used its own reported runtime. All source/test content in these gates matches `c3e049f`.

The Node 22 container image resolved to `sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d`. Together the checks cover all four configured OS/runtime/default-branch combinations locally; this does not claim a hosted GitHub Actions rerun. The final follow-up changes only this verification record and completion checklist, not the reviewed source or tests.

### Final independent verdict

**APPROVE** the scoped audit repairs at `c3e049f148e3ea7d4fdfcb5376c269a473af12c6`. The isolated reviewer resumed after an additional capacity interruption and completed the outstanding checks. The previous P1 was closed, with no new confirmed actionable finding.

- Its original actual Git index-lock reproduction passed: compensation remained durable, an intervening writer was blocked, restarted recovery restored the exact configuration and unrelated staging, repeated recovery was a no-op, and subsequent capture succeeded.
- Its independent focused suite passed 55/55 tests, zero skips, including authorization/provenance and sync/cancellation retention.
- Additional probes checked accepted commits and uncertain outcomes before/after commit with actual Git and a real configuration lock. Recovery retained its journal while blocked, preserved existing commits, created exactly one commit when needed, and preserved unrelated edits. An interrupted two-remote replay using an in-memory Git adapter committed only after both remote changes completed.
- Strict test typechecking and diff whitespace checks passed. The source/test tree stayed unchanged during review. The reviewer did not edit the repository, tests, gates or Git state.

Reviewer environment: macOS, Node 26.8.2, Apple Git 2.39.3. Commit-result failures were injected; the two-remote partial replay probe used an in-memory adapter. Independent approval covers the scoped repairs, not an independently rerun full suite, Linux/minimum-runtime or package gate; those are separately evidenced above.

### Requirement-to-evidence audit

| Requirement / original finding | Durable implementation and executable evidence |
| --- | --- |
| Diagnostic authorization before body use | `src/vault.ts` authorized evidence scan; `test/diagnostic-provenance.test.ts` inaccessible-link and decryption checks |
| Authorized implicit and explicit embedding input | `src/search.ts` invocation filtering; `test/embedding-authorization.test.ts` cold/warm/model-change, maintain-only, encrypted and direct-entry coverage |
| Duplicate derivation restrictions | `src/vault.ts` merged classification / conditions / expiry / regenerated provenance; approve and consolidate cases in `test/diagnostic-provenance.test.ts` |
| Rejected sync never replays discarded state | outer intent in `src/git-store.ts`, original-tenant recovery in `src/vault.ts`; actual reset-lock, invalid config, cleanup failure and restart tests in `test/sync-recovery.test.ts` |
| Remote compensation cannot race or disappear | transaction-owned durable remote snapshots and index marker in `src/transaction.ts`; serialization and committed/unknown outcomes in `test/git-transaction-remediation.test.ts`, five actual-lock cases in `test/remote-config-recovery.test.ts` |
| No unrelated staging in operation commits | scoped `GitStore.commit`; staged/unstaged, additions/deletions, failed commit and retry cases in `test/git-transaction-remediation.test.ts` |
| Known rejection differs from uncertain push | real rejecting hook and pre-dispatch cancellation in `test/sync-push-rejection.test.ts`; accepted/uncertain/descendant recovery in `test/sync-recovery.test.ts` |
| Git cancellation and finite command timeout | `test/git-cancellation.test.ts`, `test/harness-cancellation.test.ts`, and `test/operation-boundaries.test.ts` retained in complete gates |
| CI default-branch independence | explicit main fixtures and both default-branch settings in `.github/workflows/ci.yml`; full main/master checks above |
| Actual installed plugin, not source-only import | `scripts/verify-package.mjs` creates and installs the tarball into an isolated consumer and executes the real Harness runtime and CLI |
| Local split commits and independent decision | repair / design / verification commits on `codex/deepseek-harness-plugin`, authored as sens-io; fixed-commit approval above; no push or publication |
| Added core Wiki design constraint | `AGENTS.md`, `docs/design/llm-wiki-core.md` and separately reviewed `align-karpathy-llm-wiki` proposal; runtime gaps explicitly retained, not included in this repair approval |

### Limits

Windows process-tree termination, real production credentials/remotes, power-loss durability and the future full Karpathy Wiki compiler are not established by these checks. Unknown push outcomes intentionally remain blocked when the remote cannot confirm the attempted revision; the runbook requires investigation rather than deleting recovery records or force-pushing. These finite checks do not prove the absence of unknown defects.

Final scoped disposition: all independently confirmed findings in this repair loop are addressed and regression-verified, and the fixed code has isolated approval. The separate full Wiki implementation remains explicitly pending in its own proposal. No push, package publication or production rollout was performed.
