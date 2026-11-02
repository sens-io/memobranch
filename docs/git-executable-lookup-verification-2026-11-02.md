# Git executable lookup repair and final roadmap verification

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Final tested runtime: `9321a4cdb41e2a12765d9c8a670fcc09f4ddb112`.
All executable checks below have completed. Final independent review of this
acceptance record is pending; roadmap/task acceptance has not yet been changed.

## What changed and why a restart is unnecessary

The original application-launched macOS Node 20 collections failed when later
CLI processes waited before JavaScript. The
[native observation](macos-administrator-sampling-2026-11-02.md) showed an OS
execution-validation wait. It did not prove why the service delayed its response.
The authorized service restart was refused by macOS; the user declined rebooting.
Neither a reboot nor another system intervention is an acceptance prerequisite.

[Controlled comparisons](macos-git-path-diagnosis-2026-11-02.md) then observed
roughly 7.7-second starts with inherited executable search and 17 ms with the
same Git executable invoked directly, retaining its environment. A short search
path was diagnostic only. The final tests below use the original inherited
43-entry path, with no preload or altered original assertion, deadline or skip.
No reboot, service restart, security-setting change or runtime upgrade was used
to obtain these passing results. The daemon's internal cause is not claimed.

On macOS, `GitStore.run` now resolves the currently selected Git executable with
bounded filesystem checks before launching it. It preserves command arguments,
the child environment and `argv0`, does not cache the selection, and retains
native search when lookup is uncertain. Only a confirmed failed start can fall
back once; an executed operation is never retried. Discovery, first launch and
fallback share the original cancellation/deadline boundary. Other platforms keep
their existing executable search.

Source commits `aab9fdd1`, `2779e0f4`, `8b78e9bb` and `9321a4cd` implement the
repair and follow-up corrections. Review found that time spent starting the
process must count towards the same deadline; this was corrected at `8b78e9bb`.
A later regression found that a caller could modify its argument array during
asynchronous lookup; `9321a4cd` snapshots it before the first wait. The failing
test used a fake Git that only printed arguments, never a real push. The frozen
old module produced the original `--version` argument, supporting the correction.

Two independent read-only reviewers covered the complete source/test changes
(2/2 files), the deadline correction (1/1) and final argument correction (3/3
including the specification); zero files skipped. Both found no remaining
confirmed issue in the final source candidate and required fresh final checks.
The earlier successful `8b78e9bb` runs were retained and did not substitute for
the following `9321a4cd` runs.

## Final executed checks

| Check | Actual result | Scope |
| --- | --- | --- |
| Original application-launched macOS Node 20.0.0, implicit `main` | Current 38/38; original 37/37; both exit 0 | Complete collections in the inherited application environment |
| Same macOS protocol, implicit `master` | Current 38/38; original 37/37; both exit 0 | Same original tests and limits, no filtering/preload |
| macOS Node 20.0.0 related Git/PDF/supervisor collection | 79/79, exit 0 | Eight executable-lookup regressions plus the existing 71 cases |
| Node 22.17.0 `npm run check`, each implicit default | 1078 functional + 14 release + 10 evaluation = 1102; exit 0 | Actual `main` and `master` probed separately; no failed/cancelled/skipped case |
| Cached Linux arm64 Node 20.0.0, each implicit default | Related 70 passed / 9 skipped; current 38/38; original 37/37; exit 0 | Seven new and two existing Darwin-only cases skipped; the argument regression executes on Linux |
| Same installed npm archive | Both Node 22/`main` and Node 20/`master` consumers exit 0 | Two combinations, not all four; unchanged complete package verifier |
| Strict OpenSpec | 33 passed, 0 failed; exit 0 | Existing installed 1.0.2 validator |
| Current production advisory queries | Project 0; actual consumer lock 0 known vulnerabilities | Two queried dependency trees; no dependency upgrade or audit fix |

The first extra Node 20 related-test command exited 9 before tests because
20.0.0 does not support `--test-concurrency=1`. Its log is preserved. Removing
that unsupported runner option produced the full 79/79 result; assertions and
test selection were unchanged. Process-group guardians are stopped after their
successful commands; their recorded cleanup signals are not test failures.
The Linux job's final owned-container listing is empty.

The original environment fingerprint is
`278d58fdf5a3eae265a4f9725c92797170095ba147a4857c4b3da87b510a702b`
(43 entries); `NODE_OPTIONS` was absent. The existing Node 20.0.0 executable SHA-256
is `ddd82d5e23efa1ac08ecae9c6abd7b4459da903d1946b9c9a2568df010a9f534`.
The Linux image remains
`sha256:4f132d4d529bab6cf3e063ceb6fb84ffc21808943e64f21968d18f5d1a4c814c`;
no image pull, network access inside containers or privileged container was used.

## Input, package and retained evidence identity

The fresh input manifest verifies 578 source/build inputs and all 98 original
test inputs unchanged. The Linux archive verifies 762 inputs, 174 against the
tested Git candidate and all 69 runtime JavaScript modules against compilation.
Against `e44c096e`, the only changed runtime/test paths are `src/git-store.ts`
and the new `test/git-path.test.ts`; package/lock, assets, existing tests, adapters,
PDF processing and LLM Wiki implementation are unchanged.

The tested archive is `memobranch-1.1.0.tgz`, 502 packed entries, SHA-256
`6f38ccfa82c5b1c0581e8201202a7a5723f9a3498d12c2e8eb05d4b905e63f27`.
All 208 runtime entries match the tested build and both installed copies. This
is a local archive, not an npm publication. Later acceptance-document edits are
outside this frozen archive and do not alter its runtime.

Both actual consumer locks are identical (46 entries), SHA-256
`273e6610f0f86b07671660611cab86881c2f0633ccfd6d81e4a9ba3fadd0cdb3`.
Ordinary declared ranges resolved cached consumer versions that differ from the
project lock: schemastery 3.18.5 vs 3.18.2, MCP server 2.4.0 vs 2.3.0 and yaml
2.9.1 vs 2.9.0. The root lock was not changed. Both actual trees were audited;
the consumer is not described as the exact root dependency tree.

Locally retained evidence:

- Final macOS/build/full-check logs and input manifest:
  `.scratch/git-path-verification-a4873361-7432-4e0d-8fdc-47402f0f6ea1/`.
- The four original complete macOS logs:
  `.scratch/macos-git-path-full-525086d7-1b6f-47b2-b84d-e482bf3e07d7-*`.
- Linux inputs, commands, container metadata, logs and cleanup:
  `.scratch/git-path-linux20-a23ad209-02f0-4b8d-a805-a8f02813714f/`.
- The single archive, runtime hashes, actual installed locks and consumer logs:
  `.scratch/git-path-package-cf773ae3-c5fc-4de9-b627-4d5c51c28904/`.
- Final summary and 96-regular-file evidence inventory:
  `.scratch/git-path-final-verification-7980aeec-f92f-4705-8919-709becf1580d/`.
  Inventory SHA-256: `2222c6500c4d8c803a5cbf6c005cea3453336ba19304d364ff1d54f3b37726c2`;
  summary SHA-256: `985c6b2d1f1dd601153451e2d4b286b401b9207f17b4881b68fe6a863c1266c6`.

The freezer rechecked all 763 preserved baseline copies, the 38 metadata-control
artifacts, 81 path-control artifacts and six native-PDF evidence artifacts.
Original failures and the argument regression's red/green logs remain intact.
Only regular files were hashed; no filesystem FIFO was read. Counts of artifacts,
archive entries, repeated test runs and distinct tests are not interchangeable.
Ignored scratch evidence is retained locally, not included in Git or npm.

## Roadmap scope and remaining acceptance action

The [scoped requirement mapping](roadmap-completion-audit-2026-10-29.md) already
maps batches 1–6 and every PDF task to implementation, native observations,
adapters and previous fixed-candidate review. Its old macOS failures are history;
the exact missing complete gate is now passed above. The retained actual browser
and native scanned/mixed-PDF observations keep their original component scope;
those components are unchanged, and the fresh complete/package checks cover
their integration with this Git repair. This does not claim new browser/native
tool executions or general OCR/model quality.

Final record review must confirm that this evidence supports closing the 12 PDF
tasks, the one combined import gate, the eight Git-lookup tasks and batches 4–6.
Until that review, their open status remains explicit. Batches 1–3b keep their
previous local acceptance. No agreed implementation item has been identified as
missing; that statement is limited to the agreed roadmap and reviewed scenarios.

Actual Windows execution/ACL verification is **skipped by the user's request**,
never passed. There is no new GitHub CI, external model quality, amd64 or arbitrary
PDF fidelity claim. No push, publish, deployment, real service/account/grant,
exported-skill installation, database change, data migration or persistent
configuration change was performed.
