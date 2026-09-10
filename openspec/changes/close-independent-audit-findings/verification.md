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

Read-only review of committed candidate `727bdef` was dispatched, but the reviewer and its isolated authorization-retention subtask terminated with the platform error: "Your workspace is out of credits. Ask your workspace owner to refill in order to continue." No final review verdict was delivered. Review must resume after the workspace owner restores capacity; this is not approval or an assertion of zero remaining findings. Passing tests alone are not final acceptance.

### Limits

Windows process-tree termination, real production credentials/remotes, power-loss durability and the future full Karpathy Wiki compiler are not established by these checks. Unknown push outcomes intentionally remain blocked when the remote cannot confirm the attempted revision; the runbook requires investigation rather than deleting recovery records or force-pushing. These finite checks do not prove the absence of unknown defects.
