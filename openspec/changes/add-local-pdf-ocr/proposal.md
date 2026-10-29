# Optional local PDF OCR and page images

## Why
The accepted text-layer PDF importer explicitly refuses image-only documents and
does not retain rendered pages. Roadmap batch 5 adds an optional local workflow
without changing the default importer or sending documents to a model service.

## What changes
- Add explicit page selection for bounded local page rendering and optional OCR.
- Preserve the exact original PDF, selected page images, recognized text and
  processor/model-data provenance in immutable evidence under existing encryption.
- Show extraction coverage and limitations; a rendered page or OCR result is not
  independent verification, table reconstruction or factual understanding.
- Add local library/CLI controls, public declarations, installed consumers and
  bilingual instructions. No server-side request-selected file paths or uploads.

## Boundaries
No automatic OCR, dependency/model download, remote vision/model request, password
handling, automatic Wiki approval, cloud grant change, push, publication or
deployment. The host explicitly provisions local processors and language data.
All named verification and independent-review tasks below remain required.

Status: an [internal processing core](../../../docs/pdf-processing-core-verification-2026-10-28.md)
is implemented and under verification. Integrated evidence/save/read/CLI work
remains pending; this change directory does not claim batch acceptance.
