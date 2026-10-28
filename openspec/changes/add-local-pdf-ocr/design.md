# Design — optional local PDF page processing

Status: implementation design; no runtime feature is accepted by this document.
Keep all batch 5 tasks unchecked until their actual evidence exists.

## Preserve the existing default

`previewPdfImport` and `applyPdfImport` already provide a local-only preview and
evidence capture. Their default remains text-layer extraction with the existing
5 MB original, 100-page and 200000-character ceilings. Existing text-only previews,
original retrieval and digest version 3 remain readable and unchanged.

An operator may additionally select exact page numbers for rendering and optional
OCR. An omitted selection never launches a native processor. A textless document
may use the selected-page workflow; unselected pages stay visibly unprocessed,
rather than becoming an apparent complete extraction. Recognition never approves
Wiki knowledge. Existing separate ingestion/review/application remains required.

## Host configuration and fixed processing

Use an explicit host-owned configuration for absolute local `pdftoppm` and optional
`tesseract` entry points, a private temporary-work parent and selected installed
language-data directory. A local CLI host may provide its configuration file;
neither a saved plan nor a server request supplies executable paths, commands,
arguments, credentials or download locations. Local library callers supply the
trusted configuration separately from a selected-page request.

Resolve and validate regular executables/data, fingerprint exact executable and
selected language-data bytes, and record bounded version strings. Tool hashes,
fixed arguments, languages and processing dimensions form the profile in the
preview. Recheck identity after processing and before accepting a result; changed
configuration/data requires a new preview. A binary fingerprint is provenance for
the configured entry point, not proof of every dynamically loaded library.

Native tools receive only fixed argument arrays, no shell or PDF-provided options.
The renderer reads an owned copy of the already inspected exact original bytes,
emits one selected page to bounded stdout, and has no caller-selected output path.
Tesseract reads only that verified owned PNG and emits bounded plain UTF-8 text.
Use a minimal child environment and fixed locale/thread settings; never forward
model credentials. No model API, package manager, remote URL, automatic installation
or external command generated from document content is part of this workflow.

The configured native executables are trusted local dependencies. The application
does not claim to isolate an arbitrary malicious host executable. Source material
and all recognized text remain untrusted data.

## Bounds and ownership

Initial hard output limits: at most 5 distinct selected pages, maximum edge 1600
pixels, at most 10000000 cumulative decoded pixels, 2000000 PNG bytes per page and
4000000 cumulative image bytes. Recognized text also fits the existing complete
200000-character evidence ceiling; refuse complete oversized results without
truncation. Validate PNG structure/dimensions and bounded decoded size before
retaining or reading bytes. Strictly reject invalid page numbers, duplicates,
unsupported languages, options and non-UTF-8 OCR output.

Each invocation owns its child/process group and private temporary directory.
Use the existing cancellable lock implementation to serialize native processing
within one explicitly selected temporary-work parent. Never acquire a destination
vault lock while running tools. Enforce one processing deadline over owned tool
execution, including version probes, with the existing 1–120000 ms option range;
queue/filesystem work must be described separately from that execution deadline.
Cancellation/error/output overflow terminates and awaits the owned group before
returning, escalates termination within a fixed cleanup interval, and removes only
owned files. Another operation's lock, process or directory must survive.

Private work files contain source/image plaintext even when later evidence will
be encrypted. Use owner-only directories/files, bounded fixed filenames and
exclusive creation. Normal completion/cancellation cleans them. Abrupt parent
termination may leave its private directory: a later invocation may clean only a
verified owned directory whose owner process is no longer alive, preserving
unknown entries and live owners. Bound pending owned directories and reject excess
instead of broadly deleting temporary files.

Output, pixel, execution and work-file bounds are enforceable application limits.
They do not establish a hard native-process peak-memory limit on every operating
system; document that limit honestly and avoid a fabricated memory-safety claim.

## Evidence and compatibility

Retain the exact original PDF and selected PNG bytes inside the existing immutable
evidence/encrypted envelope, rather than introducing a separately permissioned
attachment store. Add an explicit processed-original discriminator and a new
evidence digest domain/version (next available version: 5). Existing text-only
original version 1/digest 3 and imported Wiki digest 4 remain unchanged. Older
programs reject processed evidence; no automatic migration is performed.

Bind original bytes/hash, original text-layer parser, selected page numbers,
image bytes/hash/dimensions, recognized text/hash/length, processor/config/language
identities and extraction coverage. A deterministic header in the identity-hashed
body binds the complete processing metadata as well as the original. Schema and
integrity checks reject stripped discriminators, altered images/text or downgrade
attempts. Explicit classification applies to the complete original and derived
record, including hidden PDF material, not merely to visible recognized text.

Preview exposes complete processing/coverage summaries and warnings; it does not
write canonical evidence. Application reprocesses the exact selected original
under the current host profile and compares the full preview before a normal
capture with extraction disabled. Changed output or profile refuses. Exact retry
uses the existing immutable identity and transaction/recovery behavior; preserve
the safely committed operation receipt when cancellation crosses readiness.

Retained recognized text is labeled as OCR and unverified. Keep text-layer content,
recognized content, empty selected pages and unselected pages distinguishable.
Rendering/OCR does not establish image semantics, faithful tables, visual order,
factual correctness or complete coverage of arbitrary PDFs.

## Read and adapter boundaries

Use authorized existing record reads for exact original/page retrieval through
local library/CLI operations. Bound media reads; explicit local output paths must
not silently overwrite existing operator files. No upload, server-selected path,
MCP/Harness filesystem reader, remote media endpoint or grant editor is added.

All model inputs and Agent/public DTOs continue omitting the complete encoded
original/processing object, including PNGs. A prior authorized local media read
does not weaken later ingestion redaction. Existing text/provenance may be used in
the normal separate Wiki workflow; neither a media read nor OCR auto-applies it.

## Required evidence

Use actual scanned and mixed-page synthetic PDFs, not a fixture model pretending
to recognize images. Run installed native tools on their selected synthetic pages
and compare retained original/page hashes; keep recognition limits explicit. Unit
fixtures may emulate process failures/limits, but cannot substitute for that run.
Test real cancellation/owned cleanup, configuration/language/output drift,
encryption/authorization and readiness/recovery. Verify shipped consumers on the
same archive with Node 20/22, both Git defaults, strict specs/audit and independent
committed-candidate review before acceptance.

Primary references: [Tesseract command-line usage](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)
and [Poppler's pdftoppm source](https://skia.googlesource.com/third_party/poppler/+/master/utils/pdftoppm.cc).
These describe processor interfaces; they do not authorize installation or prove
MemoBranch implementation/recognition quality.
