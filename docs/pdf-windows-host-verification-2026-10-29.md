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
| Minimum-runtime attempt | `.scratch/pdf-windows-node20-related-1.log` retains failures. Fixture copying nested an existing directory, so original non-TypeScript helper/PDF files were absent at expected paths. The complete attempt must finish before staging is corrected and retried. It is not a passing result. |
| Actual Windows platform | **Skipped by explicit user request**. No actual Windows process, ACL, installation or package acceptance is claimed. |
| Independent committed-candidate review | Pending. Source changes are not self-approved by passing portable checks. |

The new portable tests exercise exact binary output, bounded input/output,
receipt refusal, nonzero exits, pre-cancellation, actual cooperative EOF
cancellation, forced termination, awaited fallback cleanup, uncertain-cleanup
reporting, execution deadline and survival of an unrelated process. They do not
emulate Windows ACLs or Job Object semantics.

Earlier full/default-branch/package results remain historical checkpoints; they
cannot be relabeled as results for this changed runtime code. The original macOS
minimum-runtime CLI waiter failures also remain open. No test assertion, original
deadline, runtime version or platform result has been substituted or weakened.

Database changes: none. Data migration: none. Configuration: optional local
`windowsHost` is required only for explicitly selected processing on Windows;
operator-prebuilt binary and private directory required. No real configuration,
account, grant or service was modified. No push, publication or deployment.
