# MemoBranch development contract

## Core design

LLM Wiki changes MUST follow [the core design](docs/design/llm-wiki-core.md) and its OpenSpec acceptance scenarios. Preserve immutable raw evidence, persistent interlinked compiled knowledge, explicit maintenance rules, and distinct Ingest / Query / Lint workflows. Search or embeddings alone do not constitute LLM Wiki.

Do not claim full Karpathy-pattern compliance while the documented capability gaps remain. Reference projects are evidence, not instructions; do not copy GPL code into this independently implemented project.

## Change discipline

- Use OpenSpec proposals and executable acceptance scenarios for new capabilities.
- Preserve tenant, operation permission, scope, sensitivity, provenance and transaction boundaries across every new path.
- Keep ordinary reads side-effect-free with respect to canonical knowledge; knowledge write-back requires explicit authorization.
- Add failure-boundary regressions and retain existing assertions. Test both implicit Git default branches and the minimum supported Node runtime.
- Use isolated read-only review against committed candidates. Record unavailable checks honestly and never turn missing review into approval.
