# Processed PDF evidence — local import checkpoint

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
This adds local library/CLI save/read after the [processor core](pdf-processing-core-verification-2026-10-28.md)
and [PNG corrections](pdf-processing-review-2026-10-29.md). Batch 5 is still open:
Windows ownership/cleanup, installed consumers, complete gates and final review
have not been accepted. No push, publication, deployment or real host change.

## Implemented behavior

Explicit selected-page previews use version 2, bounded summaries and a complete
processing hash. Host executable/language/work paths are separate from the saved
plan. Unsupported plan/selection/profile fields refuse. Apply re-inspects and
reprocesses, compares the full preview, then rechecks source/profile/current
authority after the actual destination writer wait and before readiness.
Native execution does not hold the vault writer lock.

Processed originals use version 2 inside `pdfOriginal` and evidence digest 5 with
a separate identity domain. Exact PDF/PNG bytes, OCR text and processor/font/language
provenance share one immutable record and its encryption/transaction rules. A body
header binds the complete canonical processing object, including media encodings.
Text layers, rendered-only pages, recognized empty pages and unprocessed pages
remain distinct. OCR is unverified; capture does not approve Wiki knowledge.

Existing ordinary evidence, text-only original version 1 / digest 3, and imported
Wiki digest 4 remain supported without data migration. The original reader from
`eb9e6b0` rejected a current synthetic digest-5 record before accepting its PDF
metadata (`.scratch/pdf-processing-old-reader.log`). Stripping format/digest
versions cannot retain its original identity. This is a compatibility probe,
not a new run of the original installed package.

Authorized local `readPdfPage` / `readPdfOriginal` require current record authority,
integrity and keys. CLI `pdf-page` / `pdf-original` exclusively create bounded new
files and refuse existing files. All model/Agent DTOs keep omitting the complete
media object, even after a prior local read. No server field, media endpoint,
model call, grant editor or remote filesystem reader is added. Public declarations
expose the local API/types; installation acceptance has not yet been rerun.

## Actual related checks

| Collection | Actual result |
| --- | --- |
| Initial save/read | 49/49 on Node 22.17.0 and compiled Node 20.0.0, zero failed/cancelled/skipped. `.scratch/pdf-processing-import-related-1.log`, `pdf-processing-import-node20.log`. |
| Expanded crash/cancellation | **55/55 on Node 22.17.0 and compiled Node 20.0.0**, zero failed/cancelled/skipped, exit 0. `.scratch/pdf-processing-import-related-2.log`, `pdf-processing-import-node20-2.log`. |
| Build/test declarations | Passed: `pdf-processing-import-build-2.log`, `pdf-processing-import-types-3.log`, `pdf-processing-import-node20-compile-2.log`. The unchanged built worker and original non-TS fixtures are included in compiled staging. |
| Real mixed-document import | Passed: `pdf-processing-import-native-1.log`; exact hashes/versions and coverage: `pdf-processing-import-native-result.json`. |

The final 55 checks are 18 processed-import, 17 processor, 11 retained text-only
import and 9 retained Git cancellation cases. They cover strict host/plan separation;
source/output/executable/language drift; actual destination queue changes to source,
profile and permissions; exact media reads; secret encryption, tenant/scope/read
denial/key erasure; blob omission in actual Wiki preparation after local media reads;
and real CLI export with existing-file refusal.

Four children actually reach evidence write, log write, transaction-ready and
committed boundaries, then kill themselves with `SIGKILL`, bypassing cleanup.
Reopening rolls back writing journals or replays ready journals, preserves exact
encrypted media and one capture commit, then permits a no-commit exact retry.
Child guards cover all four model methods and synchronous call markers. Two more
cases cancel at readiness/commit and compare the durable receipt with actual Git
head. Existing assertions/deadlines were retained. POSIX-only fixtures do not
establish Windows behavior.

## Real installed tools and mixed pages

Existing Poppler 26.05.0, Tesseract 5.5.1, English data and one explicitly selected
existing DejaVu Sans font were used without installation/download. A synthetic
two-page PDF contains a text-layer control on page 1 and a rasterized control on
page 2. The default importer reports `[false, true]` for empty text layers. Only
page 2 is selected for OCR; page 1 is visibly unrendered. Recognition is exactly
`SYNTHETIC OCR ATLAS MEMORY`, the same unchanged expectation as earlier controls.
Earlier font/recognition failures remain recorded; this is not general OCR accuracy.

Original SHA-256:
`d2d53460d5d95ed7b2780ce0aae4d4d4c4e7b2b1b59c85fc2f7bb47bb7b8a8a9`
(16265 bytes). Retained page SHA-256:
`408ecf88a52b0febbbd4b231877da9f353cbb521dc2a1bdbb013b113575a3de2`
(16703 bytes). Secret capture, exact authorized PDF/PNG reads and a duplicate retry
succeeded. Source bytes were unchanged, plaintext media/text was absent from the
encrypted disk record, no candidates/Wiki pages were approved and the owned work
directory was clear afterwards. All data is synthetic and local.

## Remaining acceptance

Independent read-only review of candidate `1df543e3714c7035e3183a677fb9ca92a159f0b8`
covered **19/19 files, zero skipped**, in disjoint import/worker/tests (3), evidence/
types/vault (4), and CLI/exports/bilingual/status records (12) assignments. No new
confirmed P1/P2 was found in that integration. Reviewers read the retained logs;
they did not execute tests or change files. Windows background
helper ownership after normal leader exit remains P2; private ACL/platform execution
also need evidence. No new full-repository, installed-package, dual Git-default or
production-audit acceptance is claimed by these related runs. The older macOS
Wiki-adapter 35/37 failure remains open, not replaced by this collection or Linux.

Database changes: none. Data migration: none. Configuration: optional local
operator-provided processor JSON and explicit CLI flags; no real host configuration,
service, account or grant was created or edited.
