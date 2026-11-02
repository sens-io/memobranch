# Local PDF evidence imports

Development-source capability, not in the published npm 1.1.0. Uses an explicitly selected local PDF, not arbitrary uploads, remote URL fetching or server-side filesystem tools. Build the source first with `npm run build` so the compiled parser worker is available.

## Preview, inspect, import

```sh
memobranch import pdf-preview ./report.pdf > pdf-plan.json
memobranch import pdf-apply --plan pdf-plan.json --root ./vault --scope project --sensitivity internal
```

Preview does not initialize or change a vault, call a model or approve knowledge. It shows the canonical source path/URI, original hash/byte count, parser identity, per-page text hashes/counts, empty-page warnings and preview revision. It does not include page bodies or encoded PDF data. The plan contains local path information; treat it according to the source's confidentiality.

Apply first checks current tenant/write/scope/sensitivity, rereads and reparses the source, then compares the complete preview. Changed bytes, parser, page extraction or edited plans require a new preview. It also checks source identity while reading and after parsing. This is a checked snapshot, not a permanent lock on an external source file. An unchanged retry returns the existing evidence without a new commit; a changed source becomes another immutable version and appears in the existing source timeline.

One apply captures **evidence only**, with automatic model extraction disabled. Use the existing Wiki ingest → preview → explicit approval workflow separately. Text and instructions inside the PDF are untrusted source data, not permission to change files, reveal credentials or execute actions.

## What is preserved

The same immutable evidence record stores two separate representations:

- The body contains the original SHA-256, parser identity, page count, limitations and `## Page N` text sections. Empty pages keep their number and say that OCR was not run.
- `pdfOriginal` contains the exact original bytes as bounded base64, original SHA-256/byte count and extraction metadata. It is not placed in the model's source or evidence-context objects. Ordinary authorized record reads can still retrieve the full metadata.

PDF evidence uses `digestVersion: 3`, with a distinct identity domain and validation of the original against the body header, its byte hash and the complete extraction hash. Deleting the original field or changing its digest version fails validation. Ordinary text evidence and existing migration stay unchanged. Older processes reject this new evidence format; stop them before importing PDFs and do not mix old readers/writers with new ones. No vault configuration version or search-cache version is changed. MCP and Harness `memory_get` also omit `pdfOriginal`; the local library and CLI retain authorized full-record reads for deliberately inspecting originals.

This representation deliberately keeps originals separate from extracted text **inside one existing Markdown envelope**, rather than adding a second attachment store or allowing arbitrary binary files in remote Git trees. The original and text share the existing transaction, recovery, encryption policy and append-only Git history. Git backup includes both; encrypted sources also require the existing separately protected key store and master key. Original PDF bytes are not copied into generated resident files or the public catalog.

The local library exposes `previewPdfImport`, `applyPdfImport`, `readPdfImportPlan`, `serializePdfImportPlan` and `readPdfOriginal`. The last method returns a `Buffer` only after an existing authorized canonical record read. Import defaults to project/internal classification; choose stricter classification when needed. Private originals and text are encrypted together when the policy requires it. Evidence retains its existing immutable-source retention: withdrawing or cryptographically erasing a **derived memory** does not erase the raw evidence/PDF. This batch adds no source-deletion API. Destroying an encrypted evidence record's key with the existing key manager makes both representations unreadable, but does not delete the Git ciphertext or copies held elsewhere.

Classify the whole original, not just its visible text: PDFs may contain author metadata, hidden text, forms or embedded files that this extractor does not interpret. Keeping exact bytes also retains those bytes; the model-output filter does not sanitize the original file or revoke an authorized user's ability to retrieve it.

## Extraction limits

The pinned [unpdf 1.7.0](https://github.com/unjs/unpdf/tree/v1.7.0) package supplies PDF.js in a dedicated worker. Compatibility is checked with the exact supported Node20.0.0 and Node22 consumers; installing today's latest parser is not a substitute. No Python, Poppler, canvas or OCR executable is a production dependency.

Limits: **5,000,000 original bytes**, **100 pages**, **100,000 text items**, and **200,000 extracted characters including the evidence header**; the vault's smaller content limit still applies. The default parser deadline is 10 seconds; `--timeout-ms` or library `timeoutMs` permits 1–120,000 milliseconds. It starts when the parser worker starts, not as an overall deadline for filesystem access, authorization, lock waiting or Git commit. PDF workers are terminated and awaited on success, error, timeout or cancellation. Ctrl-C/SIGTERM cancel CLI work; an already-ready commit follows the existing safe completion and committed-operation error rules.

The worker processes pages sequentially, disables evaluation, XFA, font/image rendering and fetching, and never follows action URLs or embedded scripts. Its old-generation JavaScript heap is capped at 128 MB (young generation 16 MB, stack 4 MB). These are not an operating-system sandbox or a hard ceiling on native/ArrayBuffer allocations. Keep this feature limited to consciously selected local documents; do not expose it as an untrusted multi-tenant upload service.

Unreadable/password-encrypted PDFs and documents with no extractable text are rejected. A mixed document can preserve empty pages with warnings, but image-only/scanned pages are not read. Reading order, layout, tables, images, signatures, forms and factual accuracy are not verified or reconstructed. PDF text outside the visual page may not be returned by the parser. Successful extraction means available text was captured, not that the full visual document was understood. The original is retained for review.

No HTTP upload, MCP/Harness local-path tool, recursive PDF discovery, remote PDF import, unattended scraping or automatic approval is added. This source increment is not a published npm release or deployment approval.
