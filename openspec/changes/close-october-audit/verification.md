# October audit verification

Date: 2026-10-08. Baseline: `8331b55`. Final runtime candidate: `4c9ed57`.

Decision: bounded local acceptance. All confirmed findings in this audit have been repaired and the affected boundaries independently re-reviewed with no reported actionable remainder. No additional missing promised workflow was identified; this is not a guarantee about untested environments or unknown defects.

## Scope and decision protocol

The audit compares the documented local-first memory, Wiki, Web management, adapter and Git workflows with their implementations and executable boundaries. Hosted administration, arbitrary file editing, multi-tenant databases, distributed consensus and automatic semantic conflict resolution remain documented non-goals, not missing promised features.

Remediation was split into individually attributable local commits. Isolated read-only agents reviewed committed snapshots or committed runtime code, built independent temporary-vault diagnostics, and could not change the implementation, tests or gates. Three rounds were the review limit; findings had to be reproduced or supported by a concrete code boundary rather than speculation. Acceptance remains bounded to the evidence below and does not prove absence of unknown defects.

## Findings and disposition

| Finding | Resolution | Commits |
| --- | --- | --- |
| Duplicate/missing embedding indices could be accepted and associate vectors with the wrong inputs; invalid cache/vector geometry could suppress lexical results while reporting ready. | Require a complete unique index mapping, finite nonzero equal-dimension vectors, cache shape checks and numerically stable cosine scoring. Invalid semantic work falls back to lexical results. | `efd63eb` |
| A partially populated old-dimension cache remained permanently degraded after a provider dimension change. | Clear the incompatible derived cache and rebuild on the following call; preserve lexical results during transition. | `4c9ed57` |
| NUL-delimited source URI/content pairs had identical evidence hashes, silently discarding a distinct source. | Reject NUL source URIs at both current/legacy digest boundaries, including imported evidence; valid existing hashes and NUL content remain supported. | `20add41` |
| Candidate identity omitted sensitivity, conditions, expiry and other derivation metadata; NUL-delimited key/body pairs collided. | Encode the complete proposal as structured identity, retain authorized exact legacy retries, and do not expose hidden candidates as duplicate hits. | `d666c40`, `018ff05` |
| A low-clearance reviewer could replace a hidden canonical record with matching key/text; encrypted originals could instead acquire duplicate IDs. | Distinct derivations receive distinct canonical identities; occupied identity/path targets are checked before publication. Private records remain byte-for-byte unchanged. | `018ff05` |
| Web capture/proposal rejected 100,001 characters despite the core allowing them and the HTTP body fitting its budget. | Let the core enforce configured text length while retaining the independent HTTP byte limit. | `3660da2` |
| Concurrent Web reads could return active memory from a transaction that later rolled back. | Coordinate management reads/planning with the cross-process writer lock; pending recovery blocks content reads while session/diagnostics/recovery stay reachable. | `3660da2` |
| Git merge could materialize paths outside managed data before post-merge validation. | Inspect local and incoming tree names/modes before merge. Reject runtime paths, extra files, symlinks and submodules. Tests use inert temporary local repositories, not executable payloads. | `b733f0d` |

The Web lock is deliberately conservative: long planning calls can block other operations until the bounded lock wait expires. This is documented rather than hidden as a performance guarantee. Other adapters' optimistic read isolation is not covered by the Web snapshot acceptance.

## Feature inventory and retained boundaries

| Promised capability | Audit evidence |
| --- | --- |
| Evidence capture, candidates, approval/consolidation, conflicts, expiry/revocation and encryption | Identity counterexamples, hidden-record approval/consolidation diagnostics, vault/production/permission regressions |
| Persistent Wiki Ingest / Query / Lint, rules, sources and explicit approval | Existing import/erasure/governance suites and independent provenance/lifecycle inspection; no new missing promised Wiki workflow identified |
| Web management/configuration | Full Web tests plus independent external-writer rollback/success, pending recovery, request limits, disconnect/shutdown and lock-timeout diagnostics |
| Optional semantic retrieval | Malformed response/cache cases, permission retention and independent partial-cache dimension-transition recovery |
| Git synchronization and recovery | Pre-materialization path/mode checks plus retained fast-forward, merge, rollback, interrupted push and recovery tests |
| CLI / MCP / Harness and installed artifact | Full adapter retention suite and minimum-runtime installed-package gate (final result recorded below) |

## Review rounds

1. **Initial `8331b55`: returned.** Independent Web reviewer reproduced both content-limit and transient-read defects. Independent Wiki reviewer reproduced evidence identity ambiguity; a follow-up traced candidate and canonical identities as the same defect family. Main-agent response fixtures reproduced malformed embedding acceptance. The initial broader runtime reviewer did not complete; that incomplete review is not approval.
2. **`d666c40`: partially returned.** Web reviewer accepted the fix after independent rollback/success, 100,001-character content, configured lower-limit, pending recovery, cancellation/queue cleanup and approximately five-second lock-timeout checks; the committed Web suite passed 18/18. Wiki reviewer found hidden canonical overwrite/duplicate identities. A separate isolated integrity reviewer found partial embedding-cache dimension recovery still failed. The latter used only inert local Git fixtures: 3/3 path cases passed, with the symlink fixture excluded from that reviewer's scope.
3. **`018ff05` / `4c9ed57`: bounded acceptance.** Wiki reviewer passed all eight evidence/candidate identity regressions and independently ran internal/secret × approve/consolidate scenarios: hidden bytes unchanged, IDs distinct, no private conditions in public results, health clean, exact retries idempotent. Integrity reviewer reproduced partial 2-D cache → 3-D provider behavior: first call degrades with lexical hits and clears cache; second and third calls return ready with rebuilt 3-D vectors. Both embedding integrity tests passed. No remaining actionable finding was reported in these reviewed boundaries. Web and Git fixes did not change after their accepted reviews.

These are independently contextualized agent reviews with additional executable evidence, not an external human security audit or certification.

## Executed checks

Local host: macOS arm64. Source checks use Node 22.17.0. The independent integrity reviewer used Node 26.8.2 and Git 2.39.3 in an isolated committed snapshot.

| Check | Observed result |
| --- | --- |
| Baseline `8331b55`, local Node 22, Git default `main` | Build/type checks, 470 functional tests and 14 release-script tests passed |
| Baseline GitHub-hosted CI | All five jobs passed: Ubuntu Node 20/master and Node 22/main; macOS Node 22/main and master; exact Node 20.0.0 installed runtime floor. [Run 36511431812](https://github.com/sens-io/memobranch/actions/runs/36511431812) is tied to the baseline, not new commits. |
| Embedding/provider/permission targeted tests | 8/8 passed, including the final cache recovery revision |
| Evidence/import/governance targeted tests | 23/23 passed |
| Web and Git boundary/recovery targeted tests | 43/43 passed, including the main agent's symlink rejection fixture |
| Candidate/vault/production initial tests | 22/22 passed |
| Canonical/permission/production follow-up | 26/26 passed; final identity suite 6/6 passed after the regular-file guard |
| Intermediate `d666c40`, full `main` checks | 486/486 functional tests and 14/14 release-script tests passed |
| Parallel full checks of `018ff05` | Both runs passed 487/488 functional tests; only the existing hot-query performance assertion failed (6.94 s / 7.56 s). Release-script stage was not reached. Sequential final-candidate runs use the unchanged gate. |
| Final `4c9ed57`, Node 22.17.0, Git default `main`, sequential full checks | Build/type checks passed; 488/488 functional tests and 14/14 release-script tests passed, no skips |
| Final `4c9ed57`, Node 22.17.0, Git default `master`, sequential full checks | Build/type checks passed; 488/488 functional tests and 14/14 release-script tests passed, no skips |
| Final runtime `4c9ed57`, Node 20.0.0, Git default `master`, installed tarball | Passed, 187 packed entries; authenticated Web/assets, exports, actual Harness capture, and provider-backed API/CLI/MCP/Harness Wiki planning/apply/query/filing/repair and least-privilege refusal |
| Production dependency audit, 2026-10-08 | 0 reported vulnerabilities |
| OpenSpec 1.0.2 strict validation | 12/12 items passed, including the closeout record and added scenarios |

No earlier candidate's success is substituted for a changed runtime. The installed check includes the closeout documents before their final result-only updates; the following commit changes documentation/task status only. Temporary local logs include `memobranch-oct08-4c9ed57-main.log`, `memobranch-oct08-4c9ed57-master.log` and `memobranch-oct08-4c9ed57-package.log` under `/private/tmp`; these may be cleaned by the OS, so the durable results are recorded here.

Reproduce source gates with the stated Node version on `PATH`, running these sequentially to avoid contention between full suites:

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=main npm run check
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=master npm run check
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=master npm exec --yes --package=node@20.0.0 -- node scripts/verify-package.mjs
OPENSPEC_TELEMETRY=0 npx --yes @fission-ai/openspec@1.0.2 validate --all --strict
npm audit --omit=dev
```

## Limitations and rollback

- GitHub CI evidence applies only to the already-pushed baseline. New local commits have not been pushed or tested by hosted CI; no npm publication or production deployment is part of this audit.
- No fresh browser visual/accessibility review, real commercial-model semantic-quality assessment, Windows execution, production soak test or external human security assessment was performed. HTTP and model fixtures demonstrate protocol behavior, not real-model answer quality.
- Performance failures under simultaneous full suites are retained above; no thresholds, assertions or test selectors were loosened to turn them into passes.
- Existing valid evidence hashes and exact legacy candidate IDs remain compatible. Already-corrupt ambiguous source URIs fail closed rather than being silently rewritten. Runtime/key files are not synchronized, and legitimate remotes with extra unsupported files require explicit cleanup before sync.
- These fixes do not rewrite user raw evidence or publish changes externally. Each commit is attributable; revert with dependent identity/cache revisions considered together, then rerun safety and retention gates. Do not promote a failing candidate or delete recovery state to force acceptance.
