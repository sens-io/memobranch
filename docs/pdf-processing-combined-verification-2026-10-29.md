# Local PDF processing — combined verification checkpoint

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Product checkpoint: `2684945456f11229c30e88866ce6a062d72e48c9`.
This records working local import/save/read and its corrections. It does **not**
accept the complete batch: macOS minimum-runtime waiters and Windows ownership/
platform work remain open. No push, npm publication, deployment or real host change.

## Implemented and reviewed

- Explicit local page rendering/OCR with exact original and selected PNG bytes,
  bounded output, processor/font/language provenance and visible coverage.
- Immutable processed-original version 2 / evidence digest 5, in the existing
  encryption/transaction record. Existing text-only v1/digest 3 is preserved;
  old readers reject the new format. No migration or automatic Wiki approval.
- Local library/CLI preview/apply and authorized exclusive media exports;
  model/Agent DTOs omit the complete encoded media object.
- MCP/Harness refuse undeclared host fields before real vault callbacks. No
  server-selected local path, command, upload, grant or media endpoint was added.

Independent committed-candidate review covered import candidate `1df543e3` **19/19**
and server correction `26849454` **6/6**, zero skipped and no new confirmed P1/P2.
Earlier core review found two PNG P2 issues, corrected in `00af053f` and independently
closed. The Windows background-helper P2 remains open. Review of packaging candidate
`2547b776` covered **7/7 files**, zero skipped: the driver (1) and records (5) had
no confirmed new issue; the consumer (1) had one verification P2 described below.
Follow-up review of `b8be88ac` covered the strengthened consumer and updated record
**2/2**, zero skipped, closed that verification P2 and found no new confirmed P1/P2.
This does not close the separate macOS/Windows work below.

## Fresh complete checks

| Scope | Actual evidence |
| --- | --- |
| Full Node 22, implicit `main` | **1054 functional + 14 release + 10 evaluation = 1078**, zero failed/cancelled/skipped, exit 0. `.scratch/pdf-processing-full-main-2.log`. |
| Full Node 22, implicit `master` | Same **1078**, zero failed/cancelled/skipped, exit 0. `.scratch/pdf-processing-full-master-2.log`. |
| Strict OpenSpec | **32/32**, exit 0. `.scratch/pdf-processing-final-specs.log`. |
| Production dependencies | **0 known vulnerabilities** in `.scratch/pdf-processing-audit.json`; package/lock dependencies unchanged since that audit. |
| PDF-related runtime collection | **55/55 on Node 22 and compiled Node 20.0.0** for the import checkpoint. PDF/evidence/vault code is unchanged by the later server correction. Includes four actual SIGKILL boundaries and readiness/commit cancellation receipts. [Details](pdf-processing-import-verification-2026-10-29.md). |

Both full-check runs first created an implicit Git repository and asserted its
actual observed default equaled the requested value; they did not change host
global Git settings. These are fresh post-correction results, separate from the
older 1076-check runs. Build and test declarations passed as part of each check.

## Linux minimum runtime — retained complete collections

Official Linux arm64/v8 Node **20.0.0** image:
`sha256:4f132d4d529bab6cf3e063ceb6fb84ffc21808943e64f21968d18f5d1a4c814c`.
The local image reference was initially unavailable; resolving the exact same
digest restored it from available image data. The actual identity/platform is in
`.scratch/pdf-processing-linux20-image-inspect.log`. No host runtime upgrade.

The source snapshot at `26849454` has SHA-256
`3b629aa0ae5d8b1e5e5cf1c9f3b7536e21f356cf4538bbf01e6d4b6f92b0e347`.
The builder compared **168 tracked source/test/manifest inputs with Git** before
archiving. Separately, each container verified **735 archived-file hashes** against
the inventory, including compiled sources, the full built `dist`, fixtures and
test resources. The 735 count is not a claim of 735 Git comparisons.

The fixed runner SHA-256 is
`1e378ffa7627c6d8df401cb5eed6aca570e2bda990ed7623a7d3b36799a0679e`.
Each disposable container sets its own Git global default, probes an actual
implicit repository, and asserts Node 20.0.0/Linux/arm64. It runs the complete
current 38-case protocol collection, then the complete retained original 37-case
collection. The latter's four source test files are unchanged from `507a2181`.
No assertion/deadline was removed, shortened, extended or conditionally skipped.

| Observed Git default | Current protocol collection | Original retained collection |
| --- | --- | --- |
| `main` | **38/38**, zero failed/cancelled/skipped | **37/37**, zero failed/cancelled/skipped |
| `master` | **38/38**, zero failed/cancelled/skipped | **37/37**, zero failed/cancelled/skipped |

Logs: `.scratch/pdf-processing-linux20-main.log`, `pdf-processing-linux20-master.log`.
These collections overlap; they are not 75 distinct tests or a complete Linux
repository run. Tar metadata warnings remain in the logs; all inventoried bytes
matched. The actual inspected container had no external network, no privileged
mode, 2 GiB RAM, 2 CPUs, 256 process limit, three read-only mounts and a disposable
work directory. No host `.git`, environment file, credential or SSH directory was
mounted. Both `--rm` containers ended; the final filtered container list is empty.

## Same installed archive

The same **477-entry** archive was installed independently for both consumers:
`.scratch/pdf-processing-package-2/memobranch-1.1.0.tgz`, SHA-256
`df22960531f640c805498a0eb5abeb91a041afb29c024635e5ce7c13ae142a77`.

| Consumer run | Actual result |
| --- | --- |
| Node 22.17.0, requested Git default `main` | Complete strengthened consumer verifier exit 0. `.scratch/pdf-processing-package-node22-main-4.log`. |
| Node 20.0.0, requested Git default `master` | Complete same-archive strengthened verifier exit 0. `.scratch/pdf-processing-package-node20-master-2.log`. |

These are two consumer combinations, not all four runtime/default combinations.
The driver records its requested Git override; actual implicit-default probes are
in the separate full/Linux checks above. Product imports resolve to the installed
archive, not source/tsx. Public processing declarations compile. The new consumer
checks exact media, direct ciphertext/classification/no-key assertions for both
secret CLI captures, both CLI aliases performing distinct first captures
and exclusive exports, actual MCP/Harness blob omission and unknown-field refusal,
no approved candidates/Wiki pages and synchronous zero-model-call markers. Native
fixtures here emulate processors; they do not prove OCR recognition quality.
The separately observed real mixed-PDF OCR save/read control is in the import record.

The first 476-entry archive's consumer failure remains recorded in
`pdf-processing-package-node22-main.log`; unsupported fields were wrongly accepted.
Neither that archive nor its partial successes are called a passing package run.
The later archive also includes the protocol correction. Source scripts used for
the latest two successful runs have SHA-256 `09ae9a4aec261e4881e09d64e75a68303dae5dcf75a0ac9e38aa99e420d76d88`
(`verify-package.mjs`) and `10b40aca345b57d7b5a7194ffb7885c88b001de3b3cecbc84f10c9a10c028aa0`
(`verify-installed-pdf-processing.mjs`). This after-the-run record is outside that
already verified archive; it does not alter its product bytes.

### Packaging review correction

| Source branch | Confirmed finding | Correction and actual evidence |
| --- | --- | --- |
| `kevin/knowledge-expansion` | P2: the first installed consumer claimed encrypted media but only passed `secret` and read with a key; plaintext storage could satisfy those assertions. This was a test gap, not an observed product encryption defect. | Both CLI results now have their actual `secret` classification and version checked, the disk record must have the AES-256-GCM envelope and `ENC` body without original/image/OCR plaintext, and a new keyless vault must refuse both original and page reads with `ENCRYPTION_KEY_UNAVAILABLE`. Complete consumer runs on both runtimes passed with the same archive. |

Earlier 477-entry runs (`package-node22-main-2.log`, `package-node20-master.log`)
remain retained as their original API/transport evidence; they are not relabeled
as direct encryption assertions. The first strengthening run failed because the
new assertion incorrectly expected a boolean encryption marker. The real existing
schema uses `encrypted: aes-256-gcm`; the assertion was corrected to that actual
format, without changing product code or dropping the disk/key assertions.
That failed complete run remains `pdf-processing-package-node22-main-3.log`.

## Open work and operational changes

macOS Node 20.0.0 still failed the complete protocol collection **36/38**, with the
original import-prepare/import-apply waiter observations failing before a useful
child diagnostic. The original separate collection's **35/37** failure is retained.
Linux green results and the limited 3/3 callback supplement do not fix or replace
those failures; their cause is still unestablished.

Windows normal-leader background-helper cleanup was an identified P2 at this
checkpoint. The later [ownership correction](pdf-windows-host-verification-2026-10-29.md)
records the implementation/review status. On 2026-10-29 the user explicitly
instructed that actual Windows platform verification be skipped. That check is
skipped by request, not passed; the POSIX fixture does not establish Windows
package acceptance. macOS/Linux work and fixing the known defect remain required.

Database changes: none. Data migration: none. Configuration: new optional
operator-supplied local processor JSON/selection flags, documented in the bilingual
guides; no real host configuration/account/grant/service was modified. Remaining
platform implementation/diagnosis and final batch acceptance are still required.
