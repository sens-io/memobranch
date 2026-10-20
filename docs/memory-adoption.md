# Easier adoption and review (development branch)

These features are implemented on `kevin/memory-adoption`. They are not a claim about the published npm version. Until a new release is published, build this branch with `npm ci && npm run build`, then use `node /absolute/path/to/memobranch/dist/cli.js` in place of `amem` below.

## Approved context, not a growing prompt dump

`amem recall "Atlas backup" --root /absolute/vault --max-chars 12000` reads approved ordinary memories and eligible, active Wiki pages. The SDK equivalent is `vault.recall(query, { maxCharacters, limit })`; MCP and Harness expose `memory_recall`. Returned records carry actual current revisions, evidence paths, conditions and uncertainty. No chat model is needed. Pending candidates, raw evidence, withdrawn/expired pages and unresolved conflicts are not automatically injected as facts.

The character budget applies to the serialized `text` field. A record either fits with all its conditions and citations or is omitted; `truncated` indicates a size omission. Returned arrays contain only records included in the text. A very small budget can legitimately return nothing. This is a character limit, not an estimate of model tokens. Ranking uses existing retrieval; this is not semantic compression or a learned reranker. Matching is query-based, not an automatic preload of every resident preference.

Reads wait for an existing writer and reject pending recovery rather than exposing partially changed knowledge. They can rebuild derived search caches, but cannot approve or mutate canonical knowledge. Treat all source text as data, never instructions or permission. Confidential retrieval still requires server permission, explicit inclusion and the encryption key; automatic Harness recall excludes sensitive and secret content.

## See what a plan will really change

```sh
amem wiki ingest EVIDENCE_ID --root /absolute/vault > plan.json
amem wiki preview --file plan.json --root /absolute/vault
# A separate authorized human decision:
amem wiki apply --file plan.json --root /absolute/vault
```

`wiki preview` verifies the original signed plan against the current vault, configuration, source hashes and page/rule versions. It shows canonical before/after bodies, propagated restrictions, evidence, revision numbers and affected pages, including dependent pages carried into the plan. It does not ask an LLM to guess the effect. A forged or stale plan is rejected. The text difference is a bounded linear prefix/suffix comparison, not a minimal Git diff: large changed regions may count unchanged internal lines as replacement; omissions are labeled, and full bodies remain available.

The Web console provides the same comparison for compilation, filing, repairs and corrections. Approval is available only after a successful preview and submits the original signed plan. A later concurrent edit can still invalidate it; reload and generate a new proposal instead of bypassing the check. Raw JSON remains inspectable. Body text is rendered literally and cannot execute markup or scripts.

## Correct a Wiki page without erasing its history

```sh
amem wiki correct entity:atlas "Retention changed to 14 days; keep the deployment restriction." --root /absolute/vault
```

The Web document view offers the same action. It requires both read and write permission and sends the displayed revision, rejecting a newer target before evidence capture. CLI, MCP, Harness and SDK callers can supply `expectedRevision` (`--expected-revision` in CLI) for the same protection; omitting it intentionally targets the latest current page. The operation captures the original human instruction as immutable evidence tied to the target revision, then requests a signed `repair` proposal and a source summary. It preserves provenance and applicable conditions, and never approves itself. Review the proposal and explicitly apply it with review permission.

If planning fails or the target changes, the captured evidence can remain. The failure does not mean all writes were rolled back. Successful output reports `evidenceCommit` for the captured source and `commit:null` for the not-yet-applied repair. Legacy ordinary memories keep their existing candidate/approval workflow. Changing the authority of a source or silently declaring one conflicting claim true is not part of this feature.

## Understand a retrieval result

`amem explain "Atlas backup" --root /absolute/vault` and `memory_explain` show actual returned lexical/semantic scores and the selected strategy. The Web memory library exposes these signals with current document/source links. Scores are ranking signals, not probabilities or proof of truth. Wiki term matching is lexical; embeddings, when explicitly requested and available, apply to ordinary indexed memories. Only authorized results are explained; hidden records are not counted or described.

## Client and automatic-operation choices

See [client setup and Harness privacy choices](integrations.md). The initial supported setup writer is Claude Code's project `.mcp.json`, with preview, explicit apply, backup, a real MCP connection check and ownership-checked removal. It installs tools, not an automatic Claude Code hook. Harness can explicitly opt into answer-time recall and successful-completed-turn capture. Capture creates evidence and an unapproved candidate, not formal Wiki changes. Both features are local and do not install a cloud account or store keys.

## Measure behavior before claiming better answers

The [evaluation guide](../evaluation/README.md) describes 37 public synthetic cases and three reading strategies. Run `npm run evaluate:memory` from a source checkout. Offline mode verifies the protocol with a deterministic model double; it does not measure real model quality. Opt-in live mode requires an explicit provider, model, key and budgets. Do not publish fixture counts as an accuracy or cost improvement. Semantic quality still needs separate human review and a held-out real-task dataset.
