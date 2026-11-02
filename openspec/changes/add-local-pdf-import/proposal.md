# Preview-first local PDF sources

## Why
Local text imports cannot read PDF documents or preserve their original bytes and page provenance.

## What changes
- Add explicit local-library and CLI PDF preview/apply operations for bounded text-layer documents.
- Retain exact original bytes in a separate encoded metadata field of the same immutable evidence record, apart from the page-labelled extracted body. This deliberately reuses the existing encryption, transaction, Git backup and erasure boundaries instead of adding a binary path allowlist or unmanaged attachment store.
- Bind previews to the canonical local path, original hash, parser version and every page's extraction hash. Apply must reread/reparse and refuse drift or modified plans before writing.
- Run the pinned parser in a terminable, memory-limited worker. Preserve page numbers, empty-page warnings and extraction limitations; do not execute embedded instructions or fetch links.

## Not included
OCR, faithful table/image/layout reconstruction, password handling, directory auto-discovery, HTTP upload, remote PDF fetching, caller-controlled server filesystem reads, model approval, push or npm publication.
