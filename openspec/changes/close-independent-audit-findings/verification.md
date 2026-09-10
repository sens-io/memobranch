# Verification log

## First candidate (2026-09-09)

Candidate df5600c, based on a765ca7. The implementation commits were recovered onto the feature branch on 2026-09-10 as 6fa5b73, 5c0cf66 and cf73db3, with unchanged code content.

- macOS / Node 22.6.0: full build and 105/105 tests passed, no skips, under main default branch. The preceding master-default run passed 104/104 before the final unknown-commit-outcome regression was added.
- Linux / official node:20-bookworm container: fresh locked dependency install, build, 105/105 tests with master default, production audit (zero reported vulnerabilities), actual package install and real Harness capture all passed. Source was read-only mounted and copied into the disposable container.
- macOS actual tarball installation and compiled exports / Bundle patch / Harness permission visibility / evidence capture / CLI smoke passed; 68 package entries.
- Isolated read-only review independently ran 105/105 tests but REJECTED the candidate: a real Git index.lock could block reset after reconciliation metadata had been discarded, leaving no recoverable snapshot. Its package attempt was blocked by sandbox npm cache access, so independent package approval was not claimed.

## Second candidate

Pending durable snapshot repair, regression verification and another independent review. No final acceptance is claimed here. Windows process-tree termination, real production credentials/remotes and full future Karpathy Wiki compilation are not covered by the first candidate's passing tests.
