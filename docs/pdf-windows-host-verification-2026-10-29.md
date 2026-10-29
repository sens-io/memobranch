# Selected PDF Windows ownership correction — work record

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Parent checkpoint: `c77a5355617ed4c7d22a9bdd6fec19b58e7ba66c`.
This correction is under verification; it does not accept the complete PDF batch.

On 2026-10-29 the user instructed **skip Windows platform verification**. Actual
Windows process/ACL execution is **skipped by request**, not passed. This removes
that execution check from required work for this loop; it does not waive fixing
the known ownership defect, code review, or remaining macOS/Linux requirements.
Do not infer Windows runtime/package acceptance from portable tests.

## Change

The earlier normal-leader-exit defect depended on terminating a process tree
through a PID whose leader had already exited. Selected Windows PDF processing
now requires a fingerprinted, operator-prebuilt local helper. The helper uses
creation-time Job Object assignment, non-inherited job handles, a bounded input
request, a parent/cancellation pipe, and an explicit cleanup receipt after active
processes reach zero. Recovery uses a random per-operation job identity. Missing
dependencies, incompatible ownership metadata or uncertain cleanup refuse output;
uncertain cleanup retains private work files. POSIX execution and the ordinary
text-only PDF workflow retain their existing behavior.

The helper checks private Windows directory ACLs before staging plaintext. It
does not change them. Its binary SHA-256 and version enter immutable processing
provenance; changing them invalidates a retained preview. No new server file
reader, command selector, grant editor or media endpoint is added. The package
includes source, not a locally compiled Windows executable. See the bilingual
[setup](windows-pdf-host.md) / [配置说明](windows-pdf-host_CN.md).

## Retained observations

| Check | Observed result and limits |
| --- | --- |
| Node 22 related collection | **66/66**, zero failed/cancelled/skipped, exit 0: `.scratch/pdf-windows-related-1.log`. Includes the existing 55 PDF/Git cases and 11 new real-process coordination cases. The subsequent added supervisor-provenance tamper assertion still requires a fresh run. |
| Build and declarations | Passed: `.scratch/pdf-windows-build-5.log`, `pdf-windows-types-5.log`, `pdf-windows-node20-compile-1.log`. Initial duplicate host-variable build error is retained in `pdf-windows-build-1.log`; the local variable was corrected. |
| C# source compilation | Exit 0, C# 5 language, zero compiler warnings/errors in an isolated Linux .NET 8.0.100 arm64 container; seven quoting and five managed structure-layout assertions passed. `.scratch/pdf-windows-csharp-compile-1.log`. No Windows API was executed; this is not a .NET Framework/Windows build result. |
| Compiler image | `mcr.microsoft.com/dotnet/sdk@sha256:239eb99884b49bac13f4ff5935e118654f87b67d6e31bc842c7cd5a6c46fcc4f`; no-network, read-only root/source mounts, temporary build storage, 1 GiB / 2 CPUs / 256 PIDs, `--rm`. `.scratch/pdf-windows-dotnet-image.log`. No host runtime or project dependency was upgraded. |
| Minimum-runtime initial attempts | First complete run **59/66**, seven failed, zero cancelled/skipped: `.scratch/pdf-windows-node20-related-1.log`. Fixture copying nested an existing directory, so original non-TypeScript helper/PDF files were absent at expected paths. After that run exited, original resources were copied to the expected paths. The same collection passed **66/66**, zero failed/cancelled/skipped, exit 0 in `pdf-windows-node20-related-2.log`. These results precede the two review corrections below. |
| Actual Windows platform | **Skipped by explicit user request**. No actual Windows process, ACL, installation or package acceptance is claimed. |
| Independent committed-candidate review | Candidate `821eb7de` reviewed in disjoint 4/4 native, 5/5 coordination/integration and 9/9 package/docs scopes: **18/18**, zero skipped. Two coordination P2 findings are retained below. No other confirmed P1/P2 was reported. |

The new portable tests exercise exact binary output, bounded input/output,
receipt refusal, nonzero exits, pre-cancellation, actual cooperative EOF
cancellation, forced termination, awaited fallback cleanup, uncertain-cleanup
reporting, execution deadline and survival of an unrelated process. They do not
emulate Windows ACLs or Job Object semantics.

## Independent findings and correction

| Source branch | Confirmed finding at `821eb7de` | Correction and observed checks |
| --- | --- | --- |
| `kevin/knowledge-expansion` | If the supervisor leader exits but a helper holds inherited output pipes, waiting for `close` can prevent fallback cleanup forever. | The force path now runs cleanup even after leader exit, confirms the supervisor's exit, and settles independently of inherited pipe closure. Two actual helper-pipe cases cover successful and failed fallback cleanup. A retained baseline run loaded the exact candidate source (SHA-256 `e5110c9ad483a5351dcd6320ae643a5a95e1d94cd10778dcafd6435af4ba8873`) and observed no settlement/fallback 2200 ms after a 300 ms deadline, before manual helper cleanup: `.scratch/pdf-windows-pipe-baseline-1.log`. |
| `kevin/knowledge-expansion` | The OCR inner `finally` could remove `page.png` before the outer catch saw `pdfCleanupUncertain`, or replace that error if removal failed. | An internal staged-page operation preserves exact page bytes and the same error when cleanup is uncertain. The unchanged outer guard then retains the whole private work directory. Three actual filesystem cases check success, ordinary failure and retained uncertainty. |

The corrected complete Node 22 collection passed **71/71**, zero
failed/cancelled/skipped, exit 0: `.scratch/pdf-windows-related-fixed-1.log`.
Build/types passed in `pdf-windows-review-build-2.log` and
`pdf-windows-review-types-2.log`. The earlier 13/13 coordination-only run
(`pdf-windows-supervisor-fixed-1.log`) is not a replacement for that collection.
The corrected compiled Node 20.0.0 collection also passed **71/71**, zero
failed/cancelled/skipped, exit 0: `.scratch/pdf-windows-node20-fixed-1.log`.
Its declarations compiled in `pdf-windows-node20-compile-2.log`; staging includes
the full built `dist`, original non-TypeScript fixtures, the built PDF worker,
package metadata and assets. Existing test assertions/deadlines were retained.

Independent read-only re-review of corrected commit
`e44c096e4479f465f16e61ccd5d47d1243023a41` covered all five changed files,
zero skipped: both implementation files, both regression files and this record.
It closed both P2 findings and reported no confirmed new P1/P2 in that scope.
At that correction, the initial native four-file scope and the other eight
packaging/docs files were unchanged; the changed work record was included in the
five-file follow-up review. The Windows execution waiver remains unchanged.

## Fresh complete and installed-package checks

The runtime candidate is `e44c096e4479f465f16e61ccd5d47d1243023a41`.
Subsequent changes are status documentation only. Each full run actually probed
an implicit Git init and required the observed default to match before testing.

| Check | Actual complete result |
| --- | --- |
| Node 22.17.0, implicit `main` | **1070 functional + 14 release + 10 evaluation = 1094**, zero failed/cancelled/skipped, exit 0. `.scratch/pdf-windows-full-main-1.log`. |
| Node 22.17.0, implicit `master` | Same **1094**, zero failed/cancelled/skipped, exit 0. `.scratch/pdf-windows-full-master-1.log`. The two runs overlap; these are not 2188 distinct cases. |
| Strict OpenSpec | **32/32**, exit 0. `.scratch/pdf-windows-final-specs-1.log`. |
| Production dependency audit | **0 known vulnerabilities**, exit 0. `.scratch/pdf-windows-audit-1.json`. No dependency/lock change. |
| Same archive, Node 22.17.0 / probed `main` | Complete installed-consumer verifier exit 0. `.scratch/pdf-windows-package-node22-main-1.log`. |
| Same archive, Node 20.0.0 / probed `master` | Complete installed-consumer verifier exit 0. `.scratch/pdf-windows-package-node20-master-1.log`. These are the two tested runtime/default combinations, not all four combinations. |

Both consumers used `.scratch/pdf-windows-package-1/memobranch-1.1.0.tgz`,
**488 packed entries** (an archive count, not a test count), SHA-256
`b688bdb7703d50dc61642c3997a75ce8a5e03400e70f09b8d0a18b48f6b4936d`.
It was packed with `--ignore-scripts` from the already completed current build;
the full checks separately ran build/types. All **208 runtime entries** (the
complete `dist/` plus C# source) were compared byte-for-byte with that build.
The C# source also matched the committed candidate, SHA-256
`1f992be35c1ab19d8558ae16abebb85b09af49e77ab21da945eac347facf0c1d`.
Inventory: `pdf-windows-package-1/runtime-hashes.json`. The later status-document
updates are outside that frozen archive; no Windows executable was packaged.

The root consumer driver SHA-256 is
`61c2ef440b98d2e90855833c5e27e9ba14221ca149d68e7c9523687afeafa0df`;
the unchanged processed-PDF consumer is
`10b40aca345b57d7b5a7194ffb7885c88b001de3b3cecbc84f10c9a10c028aa0`.
Both logs record these hashes and the same archive hash. Coverage retains actual
API/CLI saves and exclusive reads, direct ciphertext/classification/no-key checks
for both CLI captures, MCP/Harness redaction and unsupported-field refusal, and
zero automatic model calls. Synthetic POSIX processors do not establish Windows
runtime behavior or real OCR quality. Actual native OCR success/failure remains
in the earlier import/core records, not a rerun here.

The complete-check wrapper SHA-256 is
`77f0e7aaada8e3589225e653730eae3983142578aac54a4600dd78411bf7b96e`;
the installed-consumer wrapper is
`a00576ff50478eb825285ba35b223167b58b73998691ec07d1b2c2d06f3c8b39`.
Both are retained under `.scratch/run-pdf-windows-{full,package}.sh`.

The earlier **1078-case / 477-entry** results remain historical checkpoints;
the fresh results above do not relabel those runs. The original macOS
minimum-runtime CLI waiter failures remain open. Earlier Linux selected-protocol
checks are also historical, not fresh Linux execution for this candidate.
No test assertion, original deadline, runtime version or platform result has
been substituted or weakened. Complete batch/final roadmap acceptance is still
withheld pending the remaining macOS diagnosis and final integration work.

Database changes: none. Data migration: none. Configuration: optional local
`windowsHost` is required only for explicitly selected processing on Windows;
operator-prebuilt binary and private directory required. No real configuration,
account, grant or service was modified. No push, publication or deployment.
