# Local PDF OCR — design checkpoint

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
At the reviewed design checkpoint, this was roadmap batch 5 preparation without
processing code, public API, CLI feature or evidence migration. The later
[internal processing checkpoint](../../../docs/pdf-processing-core-verification-2026-10-28.md)
records new code, actual native observations and retained failures. It does not
accept the integrated feature; all complete tasks in `tasks.md` remain unchecked.

## Specification review and correction

Independent read-only review of `e2a5c53b` inspected all 3 proposal/spec/tasks files,
zero skipped, and found one P2 specification conflict:

| Source branch | Finding | Correction and observed review |
| --- | --- | --- |
| `kevin/knowledge-expansion` | A media-read exception also modified model inputs, contradicting the existing prohibition on encoded PDF originals in model context. | `833a330c` restricts the exception to separately authorized local library/CLI reads. Agent/public DTOs and model inputs always omit original/page encodings. A new local-read-then-ingest scenario preserves that rule. Independent full-file re-review covered 1/1, zero skipped, and closed the P2 without a new P1/P2. |

The first complete strict OpenSpec attempt failed **31/32**:
`.scratch/wiki-import-ocr-specs.log`. The new disclosure requirement began with
`MAY`, and the validator reported that its requirement statement must contain
`SHALL` or `MUST`. The corrected first statement explicitly requires the existing
local/server boundary. The retained second attempt passed **32/32**, exit 0:
`.scratch/wiki-import-ocr-specs-2.log`. A passing specification check proves format
and requirement structure, not runtime functionality.

## Implementation evidence still required

`design.md` describes the intended local processor/configuration, bounds,
ownership, immutable evidence, compatibility and disclosure decisions. Independent
read-only review of `9ae54606` covered the complete design and this record (2/2,
zero skipped), compared the current PDF implementation and agreed scenarios, and
found no confirmed new P1/P2 in that design scope. Actual process, file, permission, encryption,
transaction, package/runtime/default-branch and recognition checks have not run
for an implementation of this batch. Existing PDF and Wiki-import checks cannot
substitute for those future results.

The initial read-only local availability checks found Tesseract 5.5.1 with `eng`, `osd` and
`snum`, and pdftoppm 26.05.0. They ran version/language queries only, not OCR of a
document. No language data or runtime was installed/downloaded. No real host
processor configuration, cloud account/grant, model request, push, publication,
deployment, database change or data migration occurred.
