# Selected local PDF pages and OCR

Development source only; not published to npm. The import/save/read integration
is under verification. The batch is not accepted: Windows background-process
ownership and the remaining cross-platform/package/full checks are still open.
Use [the roadmap](remaining-roadmap.md) for acceptance status.

The existing [text-layer PDF import](pdf-import.md) remains the default. Optional
processing renders exact selected pages and can recognize text with locally
provisioned Poppler `pdftoppm` and Tesseract. No model service, upload, automatic
dependency/language download or Wiki approval is involved.

## Host setup and explicit selection

The operator supplies an existing private work directory (owner-only permissions
on POSIX), local processor executables and, for OCR, installed language data.
A separate host JSON file has this strict format:

```json
{
  "version": 1,
  "renderer": "/absolute/path/to/pdftoppm",
  "ocr": "/absolute/path/to/tesseract",
  "languageData": "/absolute/path/to/tessdata",
  "fontDirectory": "/absolute/path/to/selected-fallback-fonts",
  "workRoot": "/absolute/path/to/private-work-directory"
}
```

`ocr` and `languageData` are required when `--ocr-languages` is selected. Without
that flag, pages are rendered but OCR is not run. `fontDirectory` is optional; if
provided, it must be a flat directory containing 1–32 regular `.ttf`/`.otf` files,
up to 32 MB each / 128 MB total. Font names/hashes are retained. The processor uses
an owned Fontconfig file/cache instead of inheriting system font choices; a missing
or unsuitable font can change spacing or recognition. This cannot reconstruct
arbitrary original fonts. Prepare this configuration yourself; MemoBranch does not
create real host configuration or install dependencies automatically.

```sh
memobranch import pdf-preview ./source.pdf --processor-config ./host.json \
  --pages 2,4 --ocr-languages eng --timeout-ms 30000 > pdf-plan.json

# Review the selected pages, coverage, hashes, versions and warnings first.
memobranch import pdf-apply --plan pdf-plan.json --processor-config ./host.json \
  --scope project --sensitivity internal --timeout-ms 30000 --root ./vault
```

The plan contains summaries, hashes and text lengths; no original PDF, PNG bytes,
recognized page text, executable paths or language-data paths. Apply requires the
host file separately and uses the selection already reviewed in the plan. Changed
source bytes, selected output, processor/language/font profile or preview refuses
capture. The same exact result reuses its immutable identity without a new commit.
Classification covers the entire original and derived record, including hidden
PDF content. Processing never approves or applies Wiki knowledge.

## Read retained bytes locally

```sh
memobranch import pdf-original ev-EXAMPLE --output ./new-original.pdf --root ./vault
memobranch import pdf-page ev-EXAMPLE --page 2 --output ./new-page.png --root ./vault
```

Both commands require ordinary current record-read authority and decryption keys.
The output must be a new file: an existing file is refused, never overwritten.
Only selected retained pages can be read. Local library callers can use
`previewPdfImport(path, { processing, processor })`,
`applyPdfImport(vault, plan, { processor, scope, sensitivity })`,
`readPdfOriginal(vault, evidenceId)` and `readPdfPage(vault, evidenceId, pageNumber)`.
Signals and execution deadlines remain available. Do not expose these local path
options or the host configuration as server request fields.

Originals, page images, OCR text and processor provenance share the existing
immutable evidence record, encryption, transaction and recovery rules. All model
inputs and Agent/public DTOs continue omitting the complete encoded media object,
even if an operator previously read its bytes. No MCP/Harness/Web file reader,
executable selector, media endpoint or grant editor is added.

## Coverage, limits and compatibility

- Original: at most 5 MB and 100 pages; complete evidence text: 200000 characters.
- Select 1–5 distinct pages and optionally 1–2 installed language codes.
- PNG: 1600px maximum edge, 2 MB each / 4 MB total, 10 million cumulative pixels.
  CRCs, raw chunk names, complete compressed input, decoded size and filters are
  checked. Complete oversized output is refused, not truncated.
- OCR: 40000 characters per page, strict UTF-8. Empty recognition is reported.
  Text layers, rendered pages, OCR text and unprocessed pages remain distinct.
- `--timeout-ms` is 1–120000 ms (default 10000) for PDF parsing and, separately,
  one total native execution deadline including version probes. Queue waiting and
  bounded filesystem/profile checks are outside the native execution deadline.
- Work is serialized within one host work directory. Only verified owned dead
  work directories can be removed after a crash; unrelated/live files survive.
  Accepted font-cache bytes are checked after commands (4 MB each / 8 MB total),
  not enforced as an instantaneous disk quota. Native peak RAM is not guaranteed.
- Private work files temporarily contain plaintext even when the final record is
  encrypted. Native tools are trusted host dependencies, not a sandbox for hostile
  executables. Recognition may be wrong; no faithful tables, diagrams, reading
  order, visual semantics or complete document understanding is promised.

Processed originals use explicit version 2 and evidence digest version 5. Existing
text-only original version 1 / digest 3 remains readable and unchanged. There is no
automatic data migration; older programs reject processed evidence rather than
treating OCR as the old format. Keep compatible readers together when sharing.

The [core checkpoint](pdf-processing-core-verification-2026-10-28.md) retains real
native successes and recognition failures; [independent review](pdf-processing-review-2026-10-29.md)
retains corrections and open platform work. Neither record is full-batch acceptance.
