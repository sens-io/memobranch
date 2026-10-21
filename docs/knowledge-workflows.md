# Bounded context and document sources

These features are available in the development source, not yet in the published npm release. No model call is needed for context packing, importing evidence or inspecting source versions.

## Context budgets

```sh
memobranch context "Atlas backup policy" --root ./vault --max-chars 12000 --max-tokens 3000 --json
memobranch recall "Atlas backup policy" --root ./vault --max-tokens 3000
```

`context` combines ranked approved knowledge with resident preferences. A record appears once and is included whole: body, actual revision, evidence paths, conditions and uncertainty. If it cannot fit, it is omitted instead of cut in the middle. `--resident-share 0.25` reserves the initial quarter of the budget for resident records; unused capacity is reusable. `--json` reports selected record IDs, budget omissions, final character count and estimated tokens. Limits apply to the returned **text**, not the enclosing JSON/tool response or the model's entire prompt. Framing added by a host needs its own allowance.

The default `utf8-bytes` counter counts UTF-8 bytes. This deliberately conservative estimate is **not** a model-specific tokenizer, measured API usage or a billing prediction. A local library caller can supply a matching tokenizer without sending source content to another service:

```ts
const context = await vault.contextDetailed('Atlas backup policy', {
  maxCharacters: 12000,
  maxTokens: 3000,
  tokenCounter: { name: 'my-model-tokenizer', estimated: false, count: text => tokenizer.encode(text).length },
});
```

MCP and Harness `memory_context` / `memory_recall` accept optional `maxTokens` using the built-in estimator. Existing tool text output is preserved. Read authorization, opt-in confidential retrieval and current lifecycle checks happen before packing; excluded private records do not appear in omission reports. Raw evidence and pending candidates do not become context facts.

## Explicit directory imports

Use a dedicated source directory containing documents intended for the vault. Preview contains file paths, source URIs, SHA-256 fingerprints and byte sizes, not source bodies. It can still reveal document names: store it in a trusted location. Example from the repository checkout:

```sh
mkdir -p .scratch
memobranch import preview ./project-docs > .scratch/import-plan.json
# Inspect .scratch/import-plan.json before applying.
memobranch import apply --plan .scratch/import-plan.json --root ./vault --scope project --sensitivity internal --progress
```

The local library also exports `previewDirectoryImport(directory)` and `applyDirectoryImport(vault, plan, options)`. This operation is intentionally **not** an MCP/Web filesystem-reading endpoint.

- Supported files: regular UTF-8 `.md`, `.markdown` and `.txt`; no empty or NUL-containing text. Hidden entries and `node_modules`, `dist`, `build`, `coverage`, `vendor` are ignored. This is not a complete secret scanner or a `.gitignore` implementation: curate the directory first.
- Symlink entries inside the selected directory are refused. The explicitly selected root is first resolved to its real path, which is recorded in the plan. Limits: 100 documents, 1 MB each, 5 MB in total, a 1 MB preview including its final newline, bounded directory depth/entries, plus the vault's configured content-character limit.
- All source content is re-read and checked against the entire preview before the first capture. Added, removed or modified supported files require a new preview. Apply captures that verified in-memory snapshot; later filesystem changes are not silently substituted.
- Capture uses the existing immutable evidence identity, source URI, scope, sensitivity, encryption and transaction rules. File URIs are absolute, so relocating a source directory changes its source identities. Captured text uses the existing leading/trailing whitespace normalization; this is not a byte-for-byte binary archive.
- `--progress` prints completed progress on stderr and a final JSON result on stdout. Each file is a separate recoverable evidence transaction, not an all-or-nothing directory transaction. Cancel with Ctrl+C; completed evidence remains. Retry the unchanged preview to reuse saved evidence and finish missing documents. Changed files need a fresh preview.
- A cancelled/failed import exits nonzero and reports completed entries. Cancellation at a commit boundary can also report `interruptedCommits`; retry is authoritative for identifying deduplicated evidence. The library accepts `applyDirectoryImport(vault, plan, { signal: controller.signal })`; this combines with any parent operation's cancellation. Cancellation during preflight rejects without writing.
- No candidate extraction, model call or Wiki approval is automatic. Use returned evidence IDs with `wiki ingest`, inspect the resulting plan and approve separately. [Durable local Wiki jobs](wiki-jobs.md) now provide an explicit separate worker; imports do not automatically enqueue compilation.

## Source versions and update review

```sh
memobranch source timeline 'file:///absolute/project-docs/atlas.md' --root ./vault
memobranch source timeline 'file:///absolute/project-docs/atlas.md' --root ./vault \
  --from 2026-10-01T00:00:00Z --to 2026-10-31T23:59:59Z --limit 30
```

Changing and reimporting a document appends evidence under the same source URI. `sourceTimeline` (library), `memory_source_timeline` (MCP/Harness) and the CLI report authorized versions and the current ordinary/Wiki pages referencing each version. Scope/sensitivity classifications have independent latest versions; a secret update cannot mark a public version as old. `older-source-reference` means someone should review the relationship, **not** that a historical comparison page is necessarily incorrect. Versions outside the selected date window may still determine which version is latest. Paging applies after date filtering.

Dates require ISO timestamps with an explicit timezone and at most three fractional-second digits (millisecond precision). They filter **recorded time** only; these operations do not answer what was factually valid at a past date, reconstruct old Wiki revisions, reverse revocation, restore erased keys, or claim that a newer document is true. Current permissions and transitive source/lifecycle checks apply to every returned reference and count.

## Remaining roadmap

This increment does not complete the entire second/third roadmap phase. Separate development-source increments add [explicit public HTTPS imports](public-web-import.md), [durable local compilation jobs](wiki-jobs.md), [explicit ordinary-memory effective intervals and dated retained-record views](effective-time.md) and [preview-first local text-layer PDF imports](pdf-import.md), not general crawling or automatic approval. PDF OCR/visual reconstruction, as-known-at or historical Wiki reconstruction, fixed-version shared vaults, private knowledge merge review and validated experience/skill export still need separate implementation and verification. Nothing here enables unattended scraping, canonical approval, deployment, push or npm publication.
