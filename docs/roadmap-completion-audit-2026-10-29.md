# Scoped roadmap implementation and acceptance audit

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Runtime candidate: `e44c096e4479f465f16e61ccd5d47d1243023a41`.
Starting documentation candidate: `7ef1cdc4046061fa24e4e1f3a312c6ffe21b22ac`.
This maps the agreed scope to implementation and retained observations. It does
**not** accept batches 4–6 or assert that there are no unknown defects.

Windows platform execution and ACL verification are **skipped by explicit user
request**, not passed. The known Windows ownership source correction remains
implemented and independently reviewed. macOS and Linux were not waived.

## Scope and existing delivery records

| Roadmap deliverable | Implementation and acceptance evidence | Current boundary |
| --- | --- | --- |
| 1. Experience traces, validation and explicit skill export | `src/experience.ts`, `src/experience-tool.ts`, CLI/MCP/Harness and `src/web-experience-ui.ts`; [core](validated-experience-core-verification-2026-10-22.md), [agent](validated-experience-agent-verification-2026-10-23.md) and [Web](validated-experience-web-verification-2026-10-23.md) records | Accepted at those local checkpoints. No exported skill was installed; bounded test outcomes do not prove general procedure quality. |
| 2. As-known-at reconstruction | `src/knowledge-availability.ts`, `src/web-availability-ui.ts` and agent adapters; [core](knowledge-availability-verification-2026-10-24.md) and [adapter](knowledge-availability-adapters-verification-2026-10-24.md) records | Accepted locally. Explicit availability evidence, not mutable Git dates, controls reconstruction; unsupported legacy history stays unknown. |
| 3. Pinned local/Git sharing | `src/shared-wiki.ts`, `src/shared-wiki-git.ts` and adapters; [verification](pinned-shared-wiki-verification-2026-10-24.md) | Accepted locally. Fixed versions, current authority and read-only source access; removing access cannot erase another person's exported copy. |
| 3b. Both cloud modes requested later | `src/shared-wiki-cloud-{server,client,host,config,wire}.ts`, Git sharing and adapters; [combined host verification](cloud-host-verification-2026-10-26.md) | Accepted locally for the self-hosted service and Git remote modes. No hosted SaaS, real account, service, grant or deployment was created. |
| 4. Cross-vault copy and separate manual integration | `src/shared-wiki-import.ts`, `src/wiki-import-artifact.ts`, `src/wiki-integration.ts`, CLI/MCP/Harness and `src/web-wiki-import-ui.ts`; [recovery](shared-wiki-import-recovery-verification-2026-10-28.md), [package](shared-wiki-package-verification-2026-10-28.md) and [browser](shared-wiki-web-verification-2026-10-28.md) records | Operations and scoped scenarios implemented. Complete macOS minimum-runtime failure remains open; batch acceptance withheld. Another branch uses an explicitly configured checkout, not an automatic Git merge. |
| 5. Optional bounded local PDF pages/OCR | Public preview/apply/read operations, processing, evidence and CLI paths mapped below; [combined record](pdf-processing-combined-verification-2026-10-29.md) and [ownership correction](pdf-windows-host-verification-2026-10-29.md) | Implemented under verification. No automatic Wiki approval or general OCR quality claim. macOS/final acceptance remains open. |
| 6. Management, adapters, bilingual guides and final gates | Existing experience/availability/sharing/import Web screens and CLI/MCP/Harness operations above; bilingual guides and current package checks below | Adapter scope is implemented at its recorded checkpoints. Final combined acceptance and independent acceptance review remain pending. |

The [LLM Wiki core contract](design/llm-wiki-core.md) still requires immutable
evidence, persistent linked knowledge, explicit rules and distinct Ingest / Query /
Lint workflows. The original 44-scenario acceptance record is a historical
checkpoint, not a new cross-platform execution for this candidate. Ordinary
queries stay read-only; writing derived knowledge still requires separate approval.

## Remaining PDF task mapping

All twelve boxes in [the PDF task file](../openspec/changes/add-local-pdf-ocr/tasks.md)
remain unchecked under its whole-batch acceptance rule. The table records what
already exists, rather than treating every unchecked box as missing code or
checking it merely because a related test passed.

| Task, in file order | Implementation / observed evidence | Status within this batch |
| --- | --- | --- |
| I1. Host configuration, opt-in selection, provenance | `src/pdf-processing-schema.ts`, `src/pdf-processing.ts`, `src/pdf-windows.ts`; strict selection/profile/drift cases in `test/pdf-processing*.test.ts` | Implemented; bounded scenario evidence retained. |
| I2. Process ownership, cancellation, deadline, cleanup | `src/pdf-processing.ts`, `src/pdf-supervisor.ts`, operator-prebuilt Windows helper source; actual POSIX child, pipe, queue, deadline and uncertainty cases | Implemented and reviewed. Actual Windows execution skipped; no Windows runtime claim. |
| I3. Immutable original/page bytes, encryption, transaction, compatibility | `src/pdf-evidence.ts`, `src/evidence.ts`, `src/vault.ts`; processed original v2/digest 5, retained text-only v1/digest 3; exact-byte/encryption/recovery/old-reader checks | Implemented; no database or record migration. |
| I4. Library/CLI and authorized bounded reads | `src/pdf-import.ts`, `src/cli.ts`, public exports in `src/index.ts`; real CLI and installed-consumer save/exclusive-export checks | Implemented. No server local-file reader or host command selector, as designed. |
| I5. Bilingual setup, bounds, dependencies, compatibility | [English guide](local-pdf-processing.md), [Chinese guide](local-pdf-processing_CN.md), bilingual Windows setup and README notices | Written and previously reviewed; development-source status remains explicit. |
| V1. Actual scanned/mixed PDFs and coverage | Two fresh native runs described below; exact original/selected-page hashes, empty text-layer reporting and unselected coverage | Passed for those synthetic documents, not arbitrary PDFs. |
| V2. Real processors and negative/drift cases | Real Poppler/Tesseract controls below; unavailable language/tool, malformed image, profile/source/output drift and strict input cases in the related collection | Recorded native positive controls plus controlled negative cases; not a general recognition benchmark. |
| V3. Actual process cancellation, limits and other owners | Related PDF/Git/supervisor collection, including TERM-resistant child, inherited output pipes and retained uncertain files | Portable POSIX observations passed at their recorded runtimes. Windows actual ownership/ACL execution skipped. |
| V4. Classification, keys, authority, DTO/server fields | `test/pdf-processing-import.test.ts`, `test/server-tool-fields.test.ts`, installed consumer direct ciphertext/no-key checks and actual MCP/Harness field refusal | Scoped cases passed; media stays omitted from model/agent DTOs after authorized local reads. |
| V5. Readiness, recovery, retries, compatibility | Actual SIGKILL at evidence/log/ready/commit boundaries, durable cancellation receipts and exact duplicate capture in `test/pdf-processing-import.test.ts` | Scoped recovery cases passed; no evidence modification or automatic knowledge approval. |
| V6. Package/runtimes/defaults/spec/audit | Current 488-entry installed package, Node 22 full checks under both actual Git defaults, strict specs and audit below | Those individual checks passed; complete macOS Node 20 gate is still failed, so combined acceptance is open. |
| V7. Independent committed-candidate review | Source correction scopes 18/18, then 5/5; final checkpoint docs 9/9, zero skipped, in [the correction record](pdf-windows-host-verification-2026-10-29.md) | Confirmed source findings closed within their reviewed scopes. Final batch acceptance review remains pending. |

No PDF filesystem operation was omitted accidentally from MCP/Harness/Web:
the approved design limits host paths, executable selection and media retrieval
to trusted local library/CLI callers. Adding an arbitrary server file reader
would change that design rather than finish a missing adapter.

## Current runtime and package identity

Tracked `src`, `test`, `scripts`, `assets`, package/lock and TypeScript settings
remain unchanged from `e44c096e` through the starting documentation candidate.
The fresh Linux snapshot additionally compares **173 tracked inputs** with Git
`7ef1cdc`, and all **69 built runtime JavaScript files** with their fresh test
compilation. Counts and hashes are retained in the Linux evidence below.

The latest complete Node 22 checks at the same runtime each passed **1070
functional + 14 release + 10 evaluation = 1094**, zero failed/cancelled/skipped,
under separately probed implicit `main` and `master`. These overlapping runs are
not 2188 distinct cases. Related collections passed **71/71** on Node 22.17.0
and compiled Node 20.0.0. Strict OpenSpec passed **32/32**; production audit
reported **0 known vulnerabilities**. Exact logs and scripts are in
[the ownership correction record](pdf-windows-host-verification-2026-10-29.md).
This audit also reran strict OpenSpec: **32 passed, 0 failed**, exit 0,
`.scratch/roadmap-audit-specs-1.log`. The production audit is the retained
unchanged-dependency result, not a new online advisory lookup.

Both installed consumers used the same **488-entry archive**, SHA-256
`b688bdb7703d50dc61642c3997a75ce8a5e03400e70f09b8d0a18b48f6b4936d`:
Node 22.17.0 with observed `main`, and Node 20.0.0 with observed `master`.
All **208 runtime entries** matched the current build. These are two tested
runtime/default combinations, not all four. Archive entries are not tests.
Later status-document changes are outside that frozen archive. No npm publish
or installation into the user's global environment was performed.

## Fresh real native PDF observations

These rerun the prior native scripts with separate output files at the current
runtime. Only result filenames changed; actual processors, assertions and source
documents were retained. Both scripts ended with exit 0:

- `.scratch/pdf-processing-audit-native-1.log`: a synthetic image-only PDF was
  refused by the default text-only path; explicitly selected local OCR read
  `SYNTHETIC OCR ATLAS MEMORY`. Source unchanged, zero owned directories left.
- `.scratch/pdf-processing-audit-import-native-1.log`: a synthetic two-page PDF
  retained one text layer and one image-only page. Only page 2 was rendered.
  Source SHA-256 `d2d53460d5d95ed7b2780ce0aae4d4d4c4e7b2b1b59c85fc2f7bb47bb7b8a8a9`
  (**16265 bytes**); selected PNG SHA-256
  `408ecf88a52b0febbbd4b231877da9f353cbb521dc2a1bdbb013b113575a3de2`
  (**16703 bytes**). Secret disk encryption, exact authorized original/page reads,
  duplicate retry, unchanged source and zero remaining owned directories passed.
  No candidate or Wiki page was approved and no model request was made.

A separate read-only check of that freshly saved native record explicitly found
the `secret` classification, AES-256-GCM envelope and `ENC` body. A new keyless
vault refused both original and page reads with `ENCRYPTION_KEY_UNAVAILABLE`;
the disk record stayed byte-for-byte unchanged and owned work directories stayed
empty. Source/log/result: `.scratch/pdf-native-audit-encryption-1.mjs`,
`pdf-native-audit-encryption-1.log`, `pdf-native-audit-encryption-result-1.json`.

The actual tools were existing Poppler **26.05.0** and Tesseract **5.5.1**, using
the retained English language data and explicit DejaVuSans fallback font. Full
tool/data/font hashes and actual outputs are in the two separate result JSONs.
The synthetic vault capture commit in the import result is not a project commit.
This establishes those local round trips, not arbitrary document fidelity or
recognition quality on other operating systems/languages.

The **six** source/log/result hashes are frozen in
`.scratch/roadmap-completion-audit-inventory-1.json`, SHA-256
`426fcd8d44903b93d4f6c52fd5f6a6adec5e130b02777657b5dd1c77c6249792`.
Six is an artifact count, not an added test count.

## Fresh Linux minimum-runtime checks

The actual cached image is Linux arm64 Node **20.0.0**,
`sha256:4f132d4d529bab6cf3e063ceb6fb84ffc21808943e64f21968d18f5d1a4c814c`.
No image/runtime/dependency upgrade was performed. The final input archive is
`.scratch/roadmap-linux20-input-2.tgz`, SHA-256
`0e0804419d8466aeecaad078e19711a15dab0b3d8010fb394f1b2d7acd211907`.
All **173 tracked inputs** matched Git `7ef1cdc`; both runtime snapshots have
unchanged product code from `e44c096e`. All **69** built runtime JavaScript files
matched the fresh test compilation. The archive has **763 inventoried files**,
each checked inside the container; this is not 763 Git comparisons or tests.
The full dependency tree is included in the archive whose overall hash is checked;
individual dependency files are not part of that 763-file inventory.

Two setup failures are retained rather than erased:

| Attempt | Actual outcome and diagnosis |
| --- | --- |
| First `main` run, input archive 1 | Related collection: **39 passed, 30 failed, 2 skipped, 0 cancelled**, exit 1. Docker's temporary `/work` mount defaulted to `noexec`, preventing the synthetic executable processors from starting. The minimal startup probe independently recorded `EACCES` and the actual `noexec` mount. Protocol collections did not run. `roadmap-linux20-main-1.log`, `roadmap-linux20-startup-probe-1.log`. |
| Second `main` run, same archive 1, executable temporary mount | Related collection: **69 passed, 0 failed, 2 skipped, 0 cancelled**. The next protocol run had **1 passed / 5 failed file entries** because the new compiled staging root lacked `package.json`; this is not a 38-case result. The original collection and `master` did not run. Missing metadata, complete `dist` and assets were then copied into the staging root and a new archive was created. No product/assertion/deadline change. `roadmap-linux20-main-2.log`. |

The positive minimal startup control with an executable temporary mount completed
with status 0 and `READY`: `roadmap-linux20-startup-probe-2.log`. This changes
only the disposable container mount; no host security setting was changed.
The original failed archive, inventories, drivers and logs remain retained.

The third run used the corrected complete staging and explicitly executable
container work mount. Each container first checked the input archive, all 763
inventoried hashes, Node version/platform/architecture and an actual implicit
Git initialization. No original assertion/deadline/source was changed.

| Actual Git default | Related PDF/Git collection | Current protocol collection | Original retained protocol collection | Terminal result |
| --- | --- | --- | --- | --- |
| `main` | **69 passed, 0 failed, 2 skipped**, 0 cancelled | **38/38**, 0 failed/cancelled/skipped | **37/37**, 0 failed/cancelled/skipped | exit 0 |
| `master` | **69 passed, 0 failed, 2 skipped**, 0 cancelled | **38/38**, 0 failed/cancelled/skipped | **37/37**, 0 failed/cancelled/skipped | exit 0 |

The two existing skips are Darwin-only Git `EPERM` tests; their original skip
conditions remain unchanged. They passed in the recorded macOS related runs.
The 38/37 protocol collections overlap; these are not 75 distinct cases, a full
Linux repository check, or real Linux Poppler/Tesseract quality tests. The related
collection uses actual synthetic executable processors and POSIX process behavior;
the separate real native-tool observations above ran on macOS.

Final logs: `.scratch/roadmap-linux20-{main,master}-3.log`. Driver terminal results:
`roadmap-linux20-results-3.json`. Both actual container inspections record no
network, no privileged mode, 2 GiB memory, 2 CPUs, 256 process limit, three
read-only input mounts and automatic removal. No host Git directory, credential
or environment file was mounted. The final filtered project-container list is
empty. Tar metadata warnings remain visible; all recorded byte hashes matched.

The **34** supporting source/log/result hashes, including failed attempts,
direct native encryption checks and fresh strict OpenSpec, are frozen in
`.scratch/roadmap-completion-audit-inventory-2.json`, SHA-256
`846c399646aea629e87b09081a74b6301cfedd2fa8cff984b076854c78c59aef`.
Both earlier Linux snapshot inventories still match their recorded files.

## Independent review of the audit candidate

Fixed documentation candidate `9e85c608351ac303e3b4d8261a1859835caa9d74`, source
branch `kevin/knowledge-expansion`, received independent read-only Agent review.
The integration review covered this audit and the roadmap **2/2**; the native
review covered the entire macOS diagnosis **1/1**, plus the designated native
PDF/encryption passages here. Thus all **three unique changed documents** were
reviewed, zero skipped. Neither review confirmed a new P1/P2 in those scopes.

The native review checked the 12 new controls, 6 native artifacts, 3 encryption
artifacts and unchanged original 26+27 hashes. The integration review checked the
34 supporting artifacts, both Linux snapshot inventories, actual terminal
results, count meanings and package claims. OCR excluded Markdown by extension;
it did not automatically review or approve these files. The independent Agents
explicitly reviewed them. No test, Docker run or network action was performed by
the reviewers. This record does not turn document review into runtime acceptance.

## Acceptance still withheld

| Source branch | Open item | Required evidence |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Complete macOS Node 20 protocol gate remains **36/38**, and the original four-file collection **35/37**. A version-only child after SDK activity was directly observed unstarted/suspended. | Determine the cause/correction or obtain another actual macOS comparison, then pass the unchanged complete collections under both actual Git defaults. [Diagnosis and retained controls](macos-minimum-runtime-diagnosis-2026-10-29.md). Passing subsets, Linux or installed consumers do not replace this failure. |
| `kevin/knowledge-expansion` | Batches 4–6 final combined acceptance/review remains open. | Close the remaining complete-runtime failure and review the exact final acceptance candidate. Existing source reviews do not approve a future or incomplete gate. |

Another macOS environment is currently unavailable, as confirmed by the user.
That limits the proposed cross-machine comparison; it does not waive the failed
macOS gate or authorize changing the host runtime or its security settings.

No additional public operation is designated missing by this requirement map;
that is a bounded implementation audit, not proof that all functionality is
defect-free. No task box or whole-goal completion status changed on that basis.

Database changes: none. Data migration: none. Real configuration changes: none.
Optional source-level processor setup remains documented; no real host setting,
service, account or grant was modified. No push, npm publication or deployment.
