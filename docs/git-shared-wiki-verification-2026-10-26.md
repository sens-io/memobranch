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
`shared-git-wiki-types-5.log`). Both runtime whole-run gates must be repeated after
the fix; the earlier 28/100 counts do not prove these additional two tests.
Both Git-default full checks, production audit,
the same installed package on both runtimes, actual browser checks and compatibility
verification remain pending for this Git checkpoint. Earlier cloud verification
does not prove the new Git gates. The overall goal remains active.

## Changes and authority

Database change: none. Data migration: none. Configuration change: optional version
2 Git binding and disposable private cache; older programs reject version 2.
No real grants, accounts, credentials, services, push, publication or deployment.
Test publications target disposable local bare fixtures only. Service CLI setup,
remaining cloud acceptance and roadmap batches 4–6 remain pending.
