# Reproducible memory evaluation

This first-phase evaluation asks whether a reading strategy returns the expected saved facts, with real authorized citations, after a new `MemoryVault` instance opens the saved vault. It does not measure an autonomous Agent or establish production quality.

The 37 cases in `cases.mjs` are hand-authored synthetic public data. They cover six cross-session preferences, six cross-source questions, five approved updates, five unresolved conflicts, four missing-evidence refusals, four withdrawals, four authorization boundaries and three approved incident notes with restrictions. No user dataset, production secret or competitor result is included. There is no training/test split because no training or prompt tuning is performed here; if prompts are tuned against these cases, create a separately held-out dataset before reporting generalization.

Run the default offline protocol regression from the repository:

```sh
npm run evaluate:memory
# Or without a package script:
node --import tsx scripts/evaluate-memory.mjs
node --import tsx scripts/evaluate-memory.mjs --cases preference-language,cross-backup --strategies lexical,wiki --output .scratch/evaluation-example
```

Every run writes `report.json` and `report.md` into a unique child directory of the supplied output directory (default `.scratch/evaluation`). Output must stay inside the repository. Temporary vaults live under `.scratch/evaluation-vaults` and are deleted in `finally`, including when a provider or assertion fails. A process killed without cleanup may leave synthetic temporary files; inspect and remove only the specific leftover `run-*` directory. The existing `.scratch/` ignore rule covers these files. Runs do not change production vaults or existing CI assertions.

## What is actually compared

| Strategy | Real implementation used | Limits |
| --- | --- | --- |
| `none` | Same answer client, empty memory context | Establishes the no-memory control; unsupported facts must be refused. |
| `lexical` | `MemoryVault.search` with `semantic:false`, `limit:20`, `expandLinks:false`, followed by actual authorized full-document reads | The existing search API includes ordinary approved memory and eligible Wiki pages. This is a lexical strategy, not a historical release. |
| `wiki` | `MemoryVault.wikiQuery`, real navigation, actual page reads, signed result and canonical citations; `maxPages:20` | Tests Wiki retrieval/query behavior, with exact revision/evidence binding checked against canonical documents. |

These are three reading strategies in the same code version. They must not be labeled “no memory / old MemoBranch / enhanced MemoBranch.” To compare code revisions, run the same evaluator and dataset in each revision and attach the earlier JSON with `--baseline-report path`. The report checks dataset, configuration and model/provider identity and refuses to present incompatible totals as a controlled comparison. It does not manufacture a baseline for revision `9e29c07` or any other commit.

The script first captures immutable raw evidence and proposes/applies Wiki compilation through the real core APIs, then proposes and approves ordinary memories from that independent corpus. Updates are applied after the original state; conflicts remain unresolved; withdrawals revoke both ordinary memory and relevant Wiki pages. Compiling the corpus before ordinary memory approval avoids attaching Wiki dependencies to an ordinary memory later superseded by approval. That mixed edit workflow is outside this fixed-corpus experiment. A restricted reader has only public/read access. Each query reopens the vault with a fresh instance and checks that Git HEAD and canonical working state remain unchanged. Each case has a new independent vault, and strategies query the same initial state sequentially.

## Offline mode is a protocol double

The default `fixture` mode uses no paid network service, irrespective of any `AMEM_*` or `OPENAI_API_KEY` environment variables. A deterministic `FixtureClient` implements compilation, navigation and answering. It reads only supplied documents and explicit public `EVAL_RECORD_JSON` fields: typed facts, source ID, sequence and approved-replacement flag. It does not read the expected answer. The same fields appear in both offline and live source data, and therefore this dataset is deliberately easier and more structured than ordinary prose.

Fixture results test persisted state, reopening, actual authorization filters, query interfaces, citation revisions/evidence, withdrawals, refusal handling, report calculation and repeatability. They are **not real LLM quality, language understanding, live ingestion quality, production reliability, or evidence of an accuracy/cost improvement**. A protocol pass never fills in the separate semantic review score.

## Opt-in live provider

Live mode requires an explicitly supplied endpoint, model, key and request/time/output budgets. It makes real OpenAI-compatible `/chat/completions` HTTP requests only for answer generation and Wiki navigation/query. **Compilation of the fixed approved initial knowledge still uses the deterministic fixture**. This keeps retrieval comparisons on the same approved state and does not evaluate live Wiki ingestion. The price flags are optional; cost is `null` when prices or provider usage are unavailable.

Set `EVALUATION_API_KEY` in your environment without placing it in a command-line argument or report. Then, after choosing your provider/model and budgets:

```sh
node --import tsx scripts/evaluate-memory.mjs \
  --mode live \
  --base-url https://YOUR_PROVIDER/v1 \
  --model YOUR_MODEL \
  --max-calls 180 \
  --max-run-ms 600000 \
  --timeout-ms 30000 \
  --max-output-tokens 700 \
  --output .scratch/evaluation-live
```

For a reported-cost stopping threshold, also supply all three `--input-usd-per-million`, `--output-usd-per-million`, and `--max-cost-usd` flags. Prices must be your chosen provider's current prices; the tool neither fetches nor assumes them. The threshold is checked before each request against actual reported usage. The final in-flight request may exceed it. It is **not a prepaid hard cap**. If usage is missing while a cost threshold is set, subsequent provider calls stop. A provider can bill failed requests or use a different tokenizer: request count, request deadline, total deadline, and output limit reduce exposure but cannot guarantee the invoice amount. No retries are made.

The report records actual attempted HTTP calls, operation, latency, success/error and the provider's `prompt_tokens` / `completion_tokens` when present. Aggregate tokens/cost are `null` if any attempted request lacks the necessary usage. Fixture calls are not counted as paid HTTP requests. Error bodies, credentials, endpoint paths and response headers are not retained. This measurement uses a dedicated answer/navigation prompt, not a claim that the production `LlmClient` prompt has changed. The prompt hash is recorded.

## Assertions and incomplete work

Correctness requires an explicit `answer`, `conflict` or `insufficient` status and exact equality of the requested fact object, including types and absence of extra unsupported facts. Matching an answer by substring does not pass it. Positive answers must have supporting citations covering all expected evidence sources. Conflict refusals also need evidence. All model-reported citations must come from actual read documents; Wiki citation paths, revision numbers and evidence lists must match approved canonical pages. Querying must not change canonical knowledge. Restriction and withdrawal cases also check that protected source records never reach answer context and do not disclose their values.

No-memory answers are assessed against the same truth as memory answers, so refusing a factual question whose answer existed only in memory is an expected measured failure for that control. Errors and budget-skipped cases remain separate from passed and failed answers and stay in the denominator. The Markdown gives counts, not a fabricated accuracy percentage or confidence statement. JSON retains per-case/category assertions to diagnose retrieval, provenance, process and answer problems. Exit status `2` means an incomplete environment/provider/budget run; mechanically failed strategy answers are measurements and do not change the existing package gate. A fixture pass must never be promoted automatically to a live rollout approval.

Run identity includes dataset ID/version/content SHA-256, selected cases, strategy and prompt configuration/hash, code commit/dirty state, Node version, model, provider origin and endpoint hash, budgets and explicit prices. A dirty tree is reported honestly. The evaluator and runtime TypeScript sources have content hashes; runtime changes during the run are flagged and prevent a compatible baseline comparison. Results are sequential, one attempt per strategy/case; no Pass@k, Pass^k, statistical significance or confidence intervals are estimated from these single synthetic attempts.

## Human review

`semanticReview.status` is always `not-reviewed` in automated reports. A reviewer should inspect the source text, actual retrieved pages, answer, citations and any refused assertion, then separately record:

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Facts and task completion | Wrong or unsupported conclusion | Partially useful but incomplete | Correct and complete for the actual question |
| Conditions and update handling | Drops a restriction or repeats superseded facts | Restriction/update mentioned unclearly | Preserves all relevant restrictions and the approved current value |
| Citation usefulness | Missing, invented or does not support the claim | Valid but incomplete or hard to verify | Directly supports every substantive claim, with current versions |
| Refusal communication | Guesses, leaks, or asserts a disputed value | Refuses but reason is vague | Clearly identifies missing support or unresolved disagreement without leaking protected data |

Record reviewer, date, case/strategy, source/page evidence and an explanation for each score in a separate review artifact. Any unauthorized disclosure, withdrawn material in context, forged citation, or silent canonical write blocks a broader trial regardless of the fact count. For ordinary factual misses, identify whether retrieval, navigation, compilation, response formatting or the answer caused the first error before changing prompts. No external model judge is enabled or implied.

The next useful experiment is a held-out set of consented real tasks, independently reviewed against the same rubric, followed by repeated critical-case runs. Do not use these 37 cases alone to choose a production model, claim a percentage gain, or compare a competitor's published benchmark.
