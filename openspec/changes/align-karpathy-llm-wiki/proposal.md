# Align the Wiki capability with the Karpathy pattern

## Why

The project owner has adopted Karpathy's LLM Wiki pattern as a core design constraint. Existing atomic memories, immutable evidence and retrieval are useful foundations but do not by themselves implement persistent cross-source Wiki compilation.

## What Changes

- Define persistent, interlinked source/entity/concept/synthesis/comparison/query pages.
- Add a rule-aware incremental ingest plan and an authorized atomic apply boundary.
- Navigate an authorized catalog before synthesizing cited query answers; support explicit, reviewable answer filing.
- Add semantic lint suggestions alongside existing deterministic structural checks.
- Preserve existing encryption, provenance, cancellation and Git recovery contracts.

## Impact

New capability: llm-wiki. The implementation has passed the documented local acceptance gates and isolated review; see `verification.md` for commit-bound evidence and limitations. It does not replace existing memory APIs or imply a production release. See docs/design/llm-wiki-core.md for source references and project-specific decisions.
