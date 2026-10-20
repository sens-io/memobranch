# MemoBranch memory evaluation

**OFFLINE PROTOCOL REGRESSION — NOT REAL LLM QUALITY.** The deterministic double reads structured synthetic facts and does not understand language.

Run: `run-2026-10-20T04-35-51.203Z-eacaeba2`; dataset: `memobranch-synthetic-memory-v1` (37 cases), SHA-256 `a6b488b8a47636041b855ed5985aaa6ed60c4c6a3911d11221db7744f31b724e`.
Code: `580f71865fc9a3d93831d37bc3fe50865b3552a1` (working directory has uncommitted changes); model: `deterministic-protocol-double-v1`.
The rows compare retrieval strategies in this code version. They are not independent “current” and “enhanced” implementations, and they do not establish an improvement over another revision.

| Strategy | Cases | Pass | Fail | Error | Budget skipped | Refusals passed / cases | Mean query ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| none | 37 | 12 | 25 | 0 | 0 | 12 / 17 | 30.08 |
| lexical | 37 | 32 | 5 | 0 | 0 | 12 / 17 | 43.6 |
| wiki | 37 | 37 | 0 | 0 | 0 | 17 / 17 | 48.24 |

Provider HTTP requests: 0; completed: 0; errors: 0. Actual tokens: unavailable (at least one response omitted usage, or no paid provider was used).
Cost (USD): unavailable; no fabricated zero or assumed provider price. Price source: not supplied.
Semantic review: **not reviewed**, 111 results require the documented human rubric. Human corrections: not collected (count unavailable). No confidence interval, statistical significance or production success claim is made.
Latency covers the query step and its Git read-only verification; setup and fixture compilation are reported separately per case. Cases run sequentially; no retries or best-of selection.

## Failures and incomplete cases

- preference-language / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- preference-format / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- preference-package / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- preference-timezone / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- preference-units / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- preference-tests / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- cross-backup / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- cross-deploy / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- cross-retention / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- cross-support / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- cross-build / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- cross-rollout / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- update-command / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- update-region / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- update-owner / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- update-timeout / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- update-cadence / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-region / none: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-region / lexical: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-owner / none: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-owner / lexical: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-port / none: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-port / lexical: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-limit / none: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-limit / lexical: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-policy / none: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- conflict-policy / lexical: fail; explicit answer or refusal status; all expected source evidence is cited; supported answers and conflict refusals include citations
- experience-rollback / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- experience-cache / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations
- experience-migration / none: fail; explicit answer or refusal status; exact typed requested facts; no unsupported extra facts; all expected source evidence is cited; supported answers and conflict refusals include citations

## Baseline comparison

No external baseline report supplied. A historical improvement claim cannot be made from this run.

The JSON report contains answers, canonical citation revisions/evidence, assertions, budgets, model/config identities and non-secret per-call usage. Only public synthetic data is included. See evaluation/README.md for limits and manual review.
