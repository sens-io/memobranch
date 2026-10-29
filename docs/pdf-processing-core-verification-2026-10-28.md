# Local PDF processing core — implementation checkpoint

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
This implements the internal processing portion of roadmap batch 5. It does not
accept the batch or expose a new public library/CLI/server workflow. Processed
evidence storage, compatibility, retrieval, adapters, bilingual user instructions,
installed consumers and final full checks still require implementation/verification.

## Implemented core

`pdf-processing-schema.ts` defines strict separate host configuration and selected
page/language inputs, bounded complete output and PNG integrity checks. The local
`processPdfPages` engine uses fixed argument arrays, no shell or inherited model
credentials, exact source/executable/language/font hashes, bounded version tokens,
private work files and execution deadlines. It serializes owned work with the
existing cancellable lock and uses the existing owned-group termination function.
`git-store.ts` changes only that function's internal export; its implementation is
unchanged. No root-package export, JSON server path/command selector or endpoint
is added by this checkpoint.

Images are limited to 5 selected pages, 1600px maximum edge, 2 MB each / 4 MB total,
and 10 million cumulative pixels. PNG CRCs, dimensions, noninterlaced 8-bit data,
bounded inflation and row filters are checked. OCR output is strict UTF-8, at most
40000 characters per page / 200000 in total. Oversized complete outputs are refused.
Selected language files, executable files and an optional flat fallback-font set
are fingerprinted with explicit read bounds and checked again before returning.

Fontconfig uses an owned generated configuration and private cache; it does not
silently inherit a user's font setup. A chosen fallback set is at most 32 TTF/OTF
files, 32 MB each / 128 MB total. Accepted cache contents are checked after each
native command (4 MB each / 8 MB total); these checks are not an instantaneous
filesystem quota or a guarantee of native peak memory. Oversized regular owned
cache files can still be deleted during cleanup. Invalid ownership/links or unknown
work files refuse rather than authorizing broad deletion.

## Actual checks and retained failures

| Attempt | Actual result and next action |
| --- | --- |
| First build | Refused 3 calls passing binary buffers to the existing text-only hash utility. The new module now hashes bytes directly; the shared utility was not changed. `pdf-processing-build-1.log` retained. |
| Initial process/Git regression | Build/types and 17/17 passed. Additional ownership/profile/cache cases were then added; this is not the final count. |
| Real native attempt 1 | Refused excessive diagnostics when the bundled renderer could not find its default font configuration/cache. The 64 KiB diagnostics limit was retained. Explicit selected fallback fonts and owned Fontconfig/cache were implemented. `pdf-processing-native-1.log` retained. |
| Native attempts 2/3 | 12pt and 24pt synthetic controls with the bundled 31-font fallback set recognized `SYNTHETIK` instead of `SYNTHETIC`; exact expected-string assertions failed. Visual inspection showed overlapping final glyphs in the rendered control. Neither expected text nor assertions were changed to accept the error. |
| Native attempts 4/5 | With one explicitly provisioned DejaVu Sans fallback font, the same 24pt control string recognized exactly. This is a controlled font-selection comparison, not a claim that arbitrary PDF rendering/OCR is accurate. |
| First compiled Node 20 collection | 17/33 passed, 16 failed because staging omitted non-TypeScript shell/data fixtures and the dynamically referenced PDF worker. The missing files were copied unchanged from the original fixtures/build; failed output remains `pdf-processing-core-node20.log`. No assertion, deadline or runtime version changed. |
| Corrected related collection | 34/34 on both Node 22 and compiled Node 20.0.0, zero fail/cancel/skip; later dead/live-owner and actual queue cases were added. |
| Final related collection | **36/36 on Node 22.17.0 and compiled Node 20.0.0**, zero fail/cancel/skip, exit 0. Logs: `.scratch/pdf-processing-core-7.log`, `pdf-processing-core-node20-3.log`; final types/compilation: `pdf-processing-types-7.log`, `pdf-processing-compile-node20-3.log`. |

The final 36 checks comprise 16 new processor cases, 9 retained Git cancellation
cases and 11 retained PDF import cases. Actual TERM-ignoring processes, a background
helper after leader exit, output/cache overflow, malformed UTF-8, stale owner
metadata/symlinks, verified dead/live owners and real queue cancellation/next-call
completion are covered. Another process and unrelated files remain intact. The
POSIX executable fixtures do not establish Windows ACL/process behavior.

## Real image-only PDF observation

Tesseract **5.5.1**, Poppler **26.05.0** and existing English language data were used
locally; no model service, dependency or language-data download ran. The synthetic
control was rasterized and embedded as a valid image-only PDF. The existing
text-only importer correctly rejected that PDF as textless; the new internal
selected-page engine rendered and recognized `SYNTHETIC OCR ATLAS MEMORY`.
The exact expectation remained unchanged across failed and successful attempts.

Final native result: `.scratch/pdf-processing-native-result.json` and
`pdf-processing-native-5.log`. The original's SHA-256 remained
`6a5b0ac8b3e9b202418730c286590f0a59107a82983a26cc50913fb9ad7f3c13`.
The returned page is 1237×1600, 16703 PNG bytes; the owned work directory was empty
afterwards and the profile was revalidated. Input and rendered controls remain in
the synthetic fixture directories. No vault evidence was captured by this probe.

This proves one explicit local processing path. It does not prove faithful fonts,
tables, diagrams, reading order, multilingual recognition, mixed-document coverage,
semantic correctness or the future evidence-save workflow. The earlier character
error remains an observed limitation; no OCR output is independently verified fact.

Fixed-candidate independent code review is pending. Existing full 1041-check,
installed-package and Linux 37-check Wiki-import results predate this new code and
are not relabeled as OCR acceptance. The separate macOS Wiki-adapter 35/37 failure
also remains open. No new full-suite, package or dependency-audit result is claimed.

Database changes: none. Data migration: none. Configuration changes: new internal
optional processor configuration definition, including selected fallback fonts;
no real host configuration was changed. Only synthetic test configurations/files
were used. No push, npm publication, deployment, real account or grant change.
