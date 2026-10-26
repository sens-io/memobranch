# Git shared Wiki implementation candidate — 2026-10-26

Repository: `sens-io/memobranch`; branch: `kevin/knowledge-expansion`.
Base: `1bc2b1ba3c994f62d6a1dba1e61751cbf972b64b`.
This is a partial development checkpoint, **not batch acceptance or a release**.

## Implemented scope

Version 2 host bindings select `git` alongside retained local/cloud sources. The
host fixes remote, branch, full pin, source IDs, reader grants and ceilings.
Catalogs do not fetch; snapshots require the displayed pin and a fresh branch.
Offline failure, current withdrawal and history excluding the pin refuse.
Local-only service brokers reject remote bindings before transport.

The owned cache copies exact verified object bytes without checkout or source
execution, rejects unsafe trees, disables hooks/transformations and retains private
record keys. Interrupted replacements and known Git lock files can recover under
the refresh lock. Selected graph authority, expiry, opt-out and decryption checks
remain. Library imports fetch again and require separate confirmation/permissions;
they do not approve Wiki knowledge or call a model.

Cache quota monitoring is an application check, not an OS quota. Git cannot discover
an uncommunicated erasure of a separately distributed cache key. See the
[English setup](cloud-sharing.md), [Chinese setup](cloud-sharing_CN.md) and
[cache design](../openspec/changes/add-cloud-shared-wiki/git-cache.md).

## Evidence and outstanding checks

- `.scratch/shared-git-wiki-targeted-3.log`: earlier candidate 25/25 passed.
  Real bare remotes, current withdrawal, forced history, key provisioning/erasure,
  unsafe trees, byte preservation and partial-write recovery were exercised.
  Source/caller HEAD, refs, index, raw evidence sample and model counter were compared.
- `.scratch/shared-git-wiki-targeted-4.log`: 64/64 passed. A nonexistent cloud test
  filename was mistakenly supplied; **these 64 exclude cloud client/server tests**.
- `.scratch/shared-git-wiki-sha256-1.log`: one real SHA-256 check passed on Node
  22.17.0, comparing the 64-character pin and exact evidence bytes.
- `.scratch/shared-git-wiki-transport-5.log`: corrected cloud client/server plus Git
  run, 61 checks, 60 passed and one Git SSH helper readiness failure; not a green gate.
- Earlier compiled Node 20.0 runs had helper readiness failures. Isolated SHA-256
  and cancellation passed. Native SSH tests were moved, with every assertion
  retained, into their own test process, separate from filesystem/clock mocks.
  `.scratch/shared-git-wiki-node20-split.log` then passed **28/28** compiled checks
  on Node 20.0 (no loader, failures, cancellations or skips). It includes the
  queue-link refusal, SSH cancellation/deadline and actual in-flight quota checks.
- `.scratch/shared-git-wiki-targeted-6.log`: **100/100** Node 22 combined checks
  passed, zero failures/cancellations/skips. It checks all supplied paths exist
  and names the real cloud client/server files. This predates the staging fix below.
- Latest build passed in `.scratch/shared-git-wiki-build-4.log`; latest test
  compilation passed in `.scratch/shared-git-wiki-node20-split-build.log`.
  Strict OpenSpec previously passed 31/31 in
  `.scratch/shared-git-wiki-specs-1.log`.

The first independent document/test review checked all 8 assigned files at
`4a4debc0d29fbfc0a366ef2a8498939cc692dfd0`, skipped 0 and found no new confirmed
defect; it explicitly retained the then-failing SSH group as incomplete verification.
The subsequent independent test-isolation review checked 3/3 changed files at
`653e1d6e972a051d032f4fb99f1f675d921947b2`, skipped 0 and verified the three
transport tests and assertions were retained. Core review confirmed the issue below;
final review of its fix remains pending.

| Source branch | Confirmed issue | Correction and verification |
| --- | --- | --- |
| `kevin/knowledge-expansion` | P2: crashed `stage-*` files could leave a cache below its quota but unable to allocate another full stage; retry repeatedly failed `CONTENT_TOO_LARGE`. | Validate ownership/types, remove only reserved abandoned staging files before budgeting, retain keys/unknown private files. Parent regression failed before the fix (`shared-git-wiki-orphan-before.log`) and both new regressions passed after (`shared-git-wiki-orphan-after.log`, 2/2). The independent fixed-candidate reproduction measured baseline 71915, stage 57444 and valid limit 133455; the interrupted cache occupied 129661 yet could not rebuild until the old stage was removed. |

Latest staging-fix build and types passed (`shared-git-wiki-build-5.log`,
`shared-git-wiki-types-5.log`). The complete compiled staging-fix Node 20.0 suite
passed **30/30**, with zero failures/cancellations/skips, in
`.scratch/shared-git-wiki-node20-corrected.log`.
Review then found the small default fixture could fit two stages beneath the
64000-byte minimum: the product fix was present, but the below-quota regression
needed stronger data. It now publishes a larger valid managed file and explicitly
asserts that a second full stage cannot fit. Both focused checks passed on Node
22 (`shared-git-wiki-orphan-strengthened.log`, 2/2) and compiled Node 20.0
(`shared-git-wiki-node20-strengthened.log`, 2 passed, 25 deliberately filtered).
These focused results do not claim a new complete-suite run.

The original core review agent's final fix-review execution was interrupted by
the platform; no final result was obtained or counted as approval. A second
reviewer statically checked the cleanup in `17666dfc4f4e20b6e318c8f0d4f8f14a1221a328`
and confirmed its ownership/type/key-preservation behavior and strengthened
below-quota assertion. That review covered 5 files with 0 skipped and requested
an actual imported-record check in the installed script and correction of an
outdated audit-pending statement; both have been corrected. Independent delivery
review at `5ad2b8dcbaa3b2be37d310192eb8160952610694` checked all 8 assigned files,
including both screenshots, skipped 0 and found no new confirmed issue. It verified
both requested corrections and retained helper assertions against the saved evidence.
Serialized full default-branch gates remain pending; this review did not execute
tests or turn the earlier failed gates into passing results.

Strict OpenSpec passed 31/31 in `shared-git-wiki-specs-final.log`; the production
audit has 0 vulnerabilities in `shared-git-wiki-audit.json`.
The new installed-consumer Git scenario passed directly against this build
(`shared-git-wiki-installed-direct.log`): public exports, real disposable bare
remote, old pin/current authority, byte comparison, unchanged source/client reads
and preparation, no stale offline fallback, separate derived copy/no Wiki write,
exact retry and current withdrawal. This direct build run is not a passing
installed-tarball gate. The package verifier now requires the Git JS/declarations
and runs that consumer scenario.

The same **441-entry** tarball subsequently passed the complete package verifier
on Node 22.17.0 and Node 20.0 (`shared-git-wiki-package-node22.log` and
`shared-git-wiki-package-node20.log`). The first Node 22 Git consumer did not yet
inspect its copied record; the stronger consumer separately passed on **both**
runtimes from an installation of the identical tarball (`shared-git-wiki-copy-node22.log`,
`shared-git-wiki-copy-node20.log`). It reads the actual evidence and checks its
immutable/digest-4 metadata, old body, source IDs, evidence ID and pin.
Archive: `.scratch/git-shared-package.mX5NQT/memobranch-1.1.0.tgz`;
SHA-256 before and after:
`6e5b7620a51c70ceef7b0cdf6723151a0a1bbca934ae4efe85e9912025a268bb`.
Its runtime matches `6371d433`, with draft verification text from `17666dfc`;
later report text/screenshots and test-only helpers are not in that archive.
It was not published.

## Full-suite failures and helper verification

Retain failed runs: initial `shared-git-wiki-full-main.log` had 942/944 functional
checks pass (two existing MCP request timeouts); `shared-git-wiki-full-master.log`
had 943/944 pass (Git quota helper startup timed out); `shared-git-wiki-full-main-recheck.log`
had 942/944 pass (two existing Git helper readiness failures). Release/evaluation
steps were not reached in these failed chains. The two MCP cases separately passed
unchanged in `shared-git-wiki-mcp-timeout-isolated.log` (2/2). These are not green
full-suite gates. Multiple verification processes were active; startup delay was
also observed in a simple Node process, but its underlying cause is not proven.

Unix synthetic transport helpers now use the installed system interpreter rather
than starting an additional Node runtime; the Windows Node fallback remains.
The original termination, TERM-resistant/closed-output descendant, delayed-write,
deadline, quota, unchanged-data and elapsed-time assertions are retained.
`shared-git-wiki-transport-system-combined.log`: 12/12 current Node 22 checks;
`shared-git-wiki-final-system-node20.log`: 39/39 compiled current Node 20.0 checks
(30 Git sharing plus 9 retained Git cancellation), no failures/cancellations/skips.
New complete runs must execute separately before recording both defaults as passed.

## Actual management browser

Native browser checks used a disposable Git fixture and a local read-only Web
session, not a real account or remote. It displayed the configured old page and
current revision 2, conditions, uncertainty and source links without current-body
text. During an actual cache refresh-lock wait, Stop cleared the old body and
retained input; only explicit retry caused a new successful read. Logout cleared
the view and returned an empty token input. The owned tab, viewport override and
synthetic service were closed/reset.

`git-shared-native-ui.json` records DOM dimensions 1280×720 (scroll width 1265) and
375×812 (scroll width 360), with no horizontal overflow. Native JPEG images are
1265×712 and 360×780: [desktop](assets/git-shared-web-desktop-2026-10-26.jpg),
[mobile](assets/git-shared-web-mobile-2026-10-26.jpg).
`git-shared-native-observations.json` records 3 reads, 2 completed, 1 cancelled,
0 other errors. Both vaults' HEAD/refs/index hashes and clean status, one named
source raw-evidence sample hash and model counter (3 before/after) are equal.

## Legacy compatibility

An archived old reader rejected an actual valid version 2 Git binding with
`CONFIG_INVALID` and the actual copied digest-4 artifact with `VALIDATION_FAILED`.
Source/client heads, refs, index hashes, a named raw sample and model count stayed
equal: `shared-git-wiki-compat.log` / `shared-git-wiki-compat-observations.json`.
Old archive SHA-256:
`f71ae58885aa6b3c8c8fa82a520f5aca12c0ba501ecd5232608584a5a9fe5e90`.
This used its extracted modules with the **workspace dependency tree**, not an
independent installation of the old package. Broader old/new-version combinations
are not proven. The overall roadmap goal remains active.

## Changes and authority

Database change: none. Data migration: none. Configuration change: optional version
2 Git binding and disposable private cache; older programs reject version 2.
No real grants, accounts, credentials, services, push, publication or deployment.
Test publications target disposable local bare fixtures only. Service CLI setup,
remaining cloud acceptance and roadmap batches 4–6 remain pending.
