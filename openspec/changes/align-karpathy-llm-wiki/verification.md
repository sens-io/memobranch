# Design verification (2026-09-10)

Candidate: `715050d`. An isolated, read-only reviewer assessed the adopted design against the complete [Karpathy source](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), the repository documents and the pinned [nashsu/llm_wiki reference](https://github.com/nashsu/llm_wiki/tree/e8082119649e6a8e1cf85eaf289adcabfdf39d4e).

## Verdict

Design approved; no actionable design-fidelity or implementation-status misrepresentation was identified in that review. This is not approval of a completed Wiki runtime.

- The raw evidence / maintained Wiki / rules separation, incremental linked synthesis and Ingest / Query / Lint workflows reflect the primary source. Optional directories and tools were not presented as mandatory author requirements.
- The core design explicitly identifies stricter authorization, transaction, provenance and read-only query guarantees as MemoBranch's engineering decisions.
- The reviewer checked the four named reference files and their roles at the pinned revision, and confirmed its GPLv3 license. This was a behavior-reference review, not a repository-wide copyright audit; no reference source was incorporated by this design change.
- Source spot checks found atomic evidence extraction and an atomic-memory catalog, not a full cross-source Wiki compiler. The README, gap matrix and unchecked implementation tasks correctly retain that distinction.

## Historical pending runtime acceptance (2026-09-10)

The compiler, multi-type pages, operational rules, catalog-first navigation, cited-answer filing, semantic lint and multi-page transaction integration remain unimplemented or unaccepted as listed in `tasks.md`. Their proposed OpenSpec scenarios have not been reported as executed tests. They require implementation, executable boundary and retention tests, installed-package checks and another isolated review before a full-compliance claim.

## Runtime candidate (2026-09-21)

Current runtime candidate: `73d6b73c9221507fb83c7e40f4ef02eaa5c6c3c6` (`codex/deepseek-harness-plugin`), following `3216198`. Documentation candidate `91969dbb5a42e3f81c05fcc58b15f0377c3b3c01` has identical runtime, tests, scripts and package inputs. **Acceptance pending**: the isolated review found no remaining confirmed code defect in its reviewed scope, but the required Linux environment gates remain incomplete. No push or release is part of this acceptance run.

The isolated review of `090859d` returned four confirmed defects: inconsistent query/filing limits; retries resetting the total provider timeout; imported conflicted support leaving active dependent claims; and missing reviewable version/source manifests. It also found missing E1→E2→E4 provider-protocol evidence. The candidate addresses these in local commits `a8b30a2`, `4a2517a`, `dd55775` and `3216198`; the next independent review must verify closure rather than trusting this description.

The isolated read-only review of `3216198` subsequently reproduced references to nonexistent future page/rule revisions remaining active and remotely importable. It did not finish or approve the candidate: the reviewer stopped with a workspace-credit error. Commit `881e9cf` adds future-reference rejection at authenticated/public/doctor/sync boundaries while retaining older valid references. The focused pre-fix run failed four cases; the complete updated Wiki import/incremental/governance/recovery selection then passed 44/44, zero skips, with strict build and test typing (27,734.335875 ms).

The first exact-candidate macOS/main full suite on `3216198` failed: 439 tests, 438 passed, one Git SSH timeout cleanup failure (79,184.225250 ms). This result is retained, not relabeled as a pass. A diagnostic-only signal observer reproduced `kill(-pgid, 0)` returning `EPERM`. [Apple's process-group implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c) excludes zombies and can return that errno when no eligible member remains. Commit `73d6b73` uses a bounded process-state check on Darwin; a real permission failure is not ignored. The deterministic zombie-probe regression failed before the change, and the live-group denial control passed. After the change, Git/transaction/sync/Harness cancellation tests passed 33/33 (12,428.101959 ms); all nine Git cancellation tests passed in five consecutive runs (14,058.215084 / 12,281.199625 / 12,129.335167 / 12,172.890458 / 11,877.969709 ms). Final full gates are still required.

Executed development evidence before the candidate was committed:

- The four new manifest/filing tests failed on the previous implementation, then passed after the changes. `wiki-review-regressions` plus the original `wiki-schema-boundaries` passed 125/125, no skips, on macOS arm64 / Node 22.17.0 (43,058.989250 ms).
- Provider, Wiki provider and operation-boundary suites passed 113/113; the new delayed HTTP/network/body deadline cases were repeated three times. The old implementation consumed 422–456 ms for a 100 ms request budget; the corrected delayed-error cases completed near 101–117 ms. Timing observations are not hard real-time guarantees.
- The combined Wiki/governance/review/import/incremental suites passed 38/38, no skips (9,880.438375 ms), with strict build and test typing. A later run with the additional malformed manifest and dependency-only assertions passed test typing and all selected schema/import/incremental tests (exit 0). These development runs do not substitute for the exact-candidate gates below.

### Acceptance-to-evidence index

Paths below are repository-relative. This is an index into executable assertions, **not a claim that every criterion has passed final independent acceptance**. `D`, `P`, `A` and `R` retain the definitions in `acceptance-matrix.md`. The whole file is run unless a test name is quoted; named tests contain the relevant positive and negative assertions. Final gate results and reviewer findings take precedence over this index.

| ID | Executable evidence and observable assertion |
| --- | --- |
| W01 | D: `test/wiki.test.ts` “six page purposes”; `test/wiki-incremental-provider.test.ts` reads source/entity/concept/synthesis/comparison bodies through fresh processes; `test/wiki-adapters.test.ts` and installed workflows persist query pages. |
| W02 | D/R: `test/wiki-governance.test.ts` version 1/2 atomic migration and legacy evidence migration; `test/production.test.ts` config migration; `test/audit-regressions.test.ts` legacy evidence upgrade. IDs, paths, bytes, lifecycle, settings and history are checked. |
| W03 | D: `test/wiki-schema-boundaries.test.ts` malformed/future/imported schema and provenance cases; `test/wiki-review-regressions.test.ts` source identity and invalid body links; `test/wiki-import-lifecycle.test.ts` invalid dependency lifecycle and future page/stored-rule/built-in-rule revisions; `test/wiki-recovery.test.ts` invalid remote inputs. |
| W04 | D/P: `test/wiki-governance.test.ts` “operational rule changes”; `test/wiki-review-regressions.test.ts` built-in rules; `test/wiki-provider.test.ts` actual rule-bearing protocol requests; `test/wiki-incremental-provider.test.ts` actual rule versions in compile requests and manifests. |
| W05 | D/P/A: `test/wiki-provider.test.ts` untrusted-data separation; `test/wiki-schema-boundaries.test.ts` unknown destination/deletion/instruction fields; `test/wiki.test.ts` restricted provider input; `test/wiki-governance.test.ts` hidden-target refusal; adapter identity/credential argument rejection. |
| W06 | D/P: `test/wiki.test.ts` classified authorized catalog; `test/wiki-governance.test.ts` public legacy navigation; `test/wiki-review-regressions.test.ts` exported search parity; `test/wiki-incremental-provider.test.ts` catalog-before-full-body requests and resolvable persisted links. |
| W07 | D: `test/wiki-governance.test.ts` parsed `wiki-event` and actual parent commit; `test/wiki-incremental-provider.test.ts` preserved log prefix, author, changed paths and no-op replay; `test/wiki-erasure.test.ts` and security retention scan protected artifacts/history. |
| I01 | D/P: `test/wiki-incremental-provider.test.ts` E1→fresh process→E2, HTTP input containing real prior revisions, preserved raw bytes/metadata, shared entity revision and synthesis readback. |
| I02 | D/P: the same test ingests E4 only after E1/E2, creates BeaconDB/RPO/comparison, preserves earlier Atlas facts/dates/conditions, and resolves all actual page links. |
| I03 | D: `test/wiki-governance.test.ts` conflicting cadence sources, unapproved read-only plan, explicit apply, retained competing claims and uncertainty; `test/wiki-import-lifecycle.test.ts` conflicted read/query/file retention. |
| I04 | D/P: `test/wiki-review-regressions.test.ts` serialized signed `expectedRevisions`, `relevantPageVersions`, `ruleVersions`, `sourceHashes`; `test/wiki-incremental-provider.test.ts` matches these against captured HTTP inputs and fresh canonical readback, then separately applies. |
| I05 | D/P: `test/wiki-schema-boundaries.test.ts` provider/serialized-plan boundary tables and real symlink destination; `test/wiki-review-regressions.test.ts` duplicate targets and CommonMark destinations; `test/wiki-provider.test.ts` input/response/collection limits. |
| I06 | D: `test/wiki.test.ts` stale rules; `test/wiki-review-regressions.test.ts` paused navigation/config changes and expiry; `test/wiki-recovery.test.ts` coordinated process writers; actual apply rechecks under the existing writer lock. |
| I07 | D/P: `test/wiki-incremental-provider.test.ts` fresh-process completed-plan and ingest replay with zero HTTP requests or canonical changes; `test/wiki-recovery.test.ts` invalid signed receipt/cache; `test/wiki.test.ts` durable no-op. |
| I08 | D/P: `test/wiki-governance.test.ts` changed runtime rules invalidate completed ingest; incremental HTTP corpus carries current revisions; `test/wiki-review-regressions.test.ts` unconsulted raw capture does not invalidate a completed ingest. Dedup scope is documented in `docs/wiki.md`. |
| I09 | D: `test/wiki-governance.test.ts` current role/tenant/permission withdrawal and hidden target; `test/wiki.test.ts` forged signed plans; `test/wiki-schema-boundaries.test.ts` malformed manifests; `test/wiki-proof.test.ts` cross-vault and changed-payload refusal. |
| I10 | D/P/R: Wiki corpus explicitly disables embeddings; `test/wiki.test.ts` model-free structural lint; `test/provider.test.ts`, `test/vault.test.ts`, `test/production.test.ts` preserve capture/review/lexical workflows without chat or vector configuration. |
| Q01 | D/P: actual CLI/MCP/Harness query requests in `test/wiki-adapters.test.ts` and `scripts/verify-installed-wiki.mjs`; catalog/selected-page protocol in `test/wiki-provider.test.ts`; `test/wiki.test.ts` citation revision readback; import conflict/expiry regressions preserve caveats. |
| Q02 | D/P/A: `test/wiki.test.ts` successful and empty authorized query snapshots; `test/wiki-adapters.test.ts` read-only and cancelled queries; `test/wiki-review-regressions.test.ts` rejected/expired/over-budget answers leave HEAD/log/files unchanged; provider failure cases never call a writer. |
| Q03 | D/A: all three adapters in `test/wiki-adapters.test.ts` and independent installed API/CLI/MCP/Harness workflows file and reread generated analysis; `test/wiki-review-regressions.test.ts` long questions, 100 uncertainties, literal metadata and combined budgets. No new evidence is created. |
| Q04 | D: signed result tampering and stale citations in `test/wiki.test.ts`/`test/wiki-proof.test.ts`; config/expiry and filing boundaries in review regressions; conflict-preserving import/query/file; encrypted provenance/lifecycle suites. |
| Q05 | D/A: `test/wiki.test.ts` idempotent filing and apply replay; `test/wiki-adapters.test.ts` write/review denials and invocation cancellation; installed workflows verify least-privilege refusal. |
| L01 | D: `test/wiki.test.ts` no-provider structural lint; `test/wiki-schema-boundaries.test.ts` invalid canonical neighbors; `test/wiki-review-regressions.test.ts` body links and missing/altered catalog; `test/wiki-import-lifecycle.test.ts` structural invalid restrictions. |
| L02 | D/P: `test/wiki-governance.test.ts` four suggestion categories and actual page/evidence versions; `test/wiki.test.ts` coherent empty suggestion control; provider/adapter/installed semantic lint traverses real HTTP and parser. |
| L03 | D/P: `test/wiki-provider.test.ts` malformed JSON, network/HTTP errors, byte limits, deadlines and cancellation for the Wiki provider; `test/wiki-review-regressions.test.ts` invalid later suggestion clears all semantic output but preserves structure; `test/wiki-schema-boundaries.test.ts` invalid canonical state reports failed semantic work without dispatch. |
| L04 | D/A: `test/wiki.test.ts` read-only suggestion then explicit repair; all adapter/installed workflows inspect plans, apply authorized repair, reread canonical pages and reject unauthorized apply. |
| L05 | D: signed repair plans use the same `wikiApply` validation boundary exercised by stale/tampered/config/authority/provenance tests; `test/wiki-schema-boundaries.test.ts` invented references and revisions; `test/wiki-review-regressions.test.ts` actual lint page versions and unsupported suggestions. |
| S01 | D/P/A: `test/wiki-governance.test.ts` ten Wiki workflows with wrong/unbound tenants and hidden-page decryption probes; `test/wiki.test.ts` secret provider/catalog/search exclusion; `test/wiki-erasure.test.ts` clearance-before-decryption; retained authorization/embedding suites. |
| S02 | D/A/R: operation-only Wiki roles in governance; `test/permission-operations.test.ts` operation-local access and concurrent external read denial; actual adapter tool visibility and error cases. |
| S03 | D/R: dependency/link fixed-point compilation and canonical source assertions in Wiki/incremental suites; `test/wiki-import-lifecycle.test.ts` direct/transitive/link-only/dependency-only restrictions; `test/diagnostic-provenance.test.ts` strongest labels, earliest expiry and conditions. |
| S04 | D/P/R: `test/wiki-erasure.test.ts` encrypted logical keys, policy relaxation, admin/key identity boundaries, durable erasure; `test/wiki.test.ts` encrypted Wiki envelopes; retained encryption/embedding/migration tests inspect actual artifacts and provider batches. |
| S05 | D/R: `test/wiki-import-lifecycle.test.ts` warm/fresh readers after manual canonical changes; `test/wiki-review-regressions.test.ts` expiry during query; `test/wiki-erasure.test.ts` dependent withdrawal; `test/audit-regressions.test.ts` other-process revocation and failed index refresh. |
| S06 | D/P/A: `test/wiki-recovery.test.ts` real writer-lock cancellation; `test/wiki.test.ts` first-page pre-ready cancellation; `test/wiki-provider.test.ts` pre-dispatch/retry/body cancellation; Harness adapter and retained cancellation suites. |
| S07 | D/A/R: `test/wiki-recovery.test.ts` ready/commit barriers and truthful commit receipt; `test/wiki-erasure.test.ts` cancellation during key destruction; `test/harness-cancellation.test.ts`, `test/operation-boundaries.test.ts` owned-call unload and completion boundaries. |
| S08 | D/R: `test/wiki-recovery.test.ts` real child SIGKILL at ten page/receipt/log/catalog/ready/commit/index points, restart rollback/replay, failed recovery blocking later writers; existing transaction and erasure recovery suites retained. |
| S09 | D/P/R: coordinated two-process writers and unrelated staged/unstaged bytes in `test/wiki-recovery.test.ts`; signed bookkeeping and derived-cache tampering; actual fresh-process HTTP no-op replay; retained Git isolation tests. |
| S10 | D/R: Wiki recovery suite syncs valid multi-page/rules state through a real local bare remote and rejects malformed schema, plaintext secrets, evidence rewrites and symlinks; import lifecycle suite verifies rollback for conflicted support and future page/rule versions. Existing push/rejection/unknown-push/credential-redaction assertions remain retained. |
| G01 | P/A: `test/wiki-provider.test.ts` all four real transport operations; incremental corpus inspects actual vault-generated compile requests; adapter and installed workflows execute real compile/query/lint transport into persistent artifacts. |
| G02 | P/D/R: Wiki provider bounded retry/total deadline/header/body/cancellation cases, provider schema/collection cases, retained `test/provider.test.ts` and cancellation suites. |
| G03 | A: `test/wiki-adapters.test.ts` table-driven CLI/MCP/official-Harness compile→apply→query→file→lint→repair→revoke with persistent readback, plus permissions, annotations and cancellation. |
| G04 | A/R: Wiki adapter rejection/subsequent-call tests plus `test/deepseek-harness.test.ts`, `test/mcp.test.ts`, `test/cli.test.ts`, `test/harness-package.test.ts`; deployment owns identity and credentials. |
| G05 | A: `scripts/verify-package.mjs` packs and installs into a new consumer, checks shipped Wiki code/types/guide, compiles external TypeScript and executes `scripts/verify-installed-wiki.mjs` API/CLI/MCP/official-Harness persistent workflows and least-privilege refusal. Completed macOS gates and pending Linux gates are recorded below. |
| G06 | R: exact-candidate full `npm run check`, audit, strict OpenSpec, pack and installed consumer gates across supported Node/default-branch combinations. Final results pending below; the 1,000-document corpus is in `test/production.test.ts`. |
| G07 | R: isolated `91969db` review found no remaining confirmed code defect in the reviewed scope and independently reran the original future-reference reproductions plus 30 regressions. It explicitly withheld full acceptance because Linux G06 evidence is missing. See the dated review record below. |

### Isolated review of `91969db` (2026-09-21)

The existing isolated, read-only reviewer resumed successfully after its earlier workspace-credit failure. It independently verified the clean commit and the unchanged runtime/test/script/package inputs, inspected the original requirements and raw macOS gate logs, and reported **no remaining confirmed code defect in the reviewed scope**. This is a bounded code-review verdict, not full acceptance or proof that unknown defects cannot exist. The reviewer explicitly left G06 open for Linux Node 20/master and Node 22/main.

Executed by the reviewer in `/Users/imac/code/memobranch`:

```sh
/Users/imac/.nvm/versions/node/v22.17.0/bin/node --import tsx --test --test-concurrency=1 test/wiki-import-lifecycle.test.ts test/wiki-review-regressions.test.ts
/Users/imac/.nvm/versions/node/v22.17.0/bin/node --import tsx /private/tmp/memobranch-wiki-independent-3216198.mts dependency
/Users/imac/.nvm/versions/node/v22.17.0/bin/node --import tsx /private/tmp/memobranch-wiki-independent-3216198.mts rule
```

The test command passed 30/30, with zero failures/cancellations/skips, in 19,160.912458 ms (exit 0). Both original independent reproductions now stop at sync validation with `REMOTE_CONFLICT: Synchronized vault failed health validation`. The original scripts do not catch that newly expected rejection, so **both reproduction processes exit 1**, not 0; their observed rejection demonstrates closure of the earlier acceptance defect. Their exact durations were not recorded. Raw reviewer TAP/reproduction output remains in the task's tool records; no separate log file was saved. The reviewer changed no repository files, tests, permissions or release gates.

### Exact-candidate release gates

Current full-gate logs: `/private/tmp/memobranch-wiki-gates-73d6b73-GRWmjw`. Earlier failed and focused diagnostic logs: `/private/tmp/memobranch-wiki-gates-3216198-TFHuRL`. Each completed row below ran `npm run check`, `npm audit --omit=dev`, `OPENSPEC_TELEMETRY=0 npx --yes @fission-ai/openspec@1.0.2 validate --all --strict`, `npm pack --dry-run` and `npm run test:package` in sequence on runtime candidate `73d6b73`. Environment variables set `init.defaultBranch` through `GIT_CONFIG_COUNT/GIT_CONFIG_KEY_0/GIT_CONFIG_VALUE_0`.

| Environment / Git default | Full test result | Other gates | Raw log / process exit |
| --- | --- | --- | --- |
| macOS arm64 / Node 22.17.0 / main | 446/446, zero failures/skips; 103,894.037750 ms | Production audit: 0 vulnerabilities; strict OpenSpec: 8/8; pack + independently installed API/CLI/MCP/Harness: 84 entries, passed | `macos22-main.log`; exit 0 |
| macOS arm64 / Node 22.17.0 / master | 446/446, zero failures/skips; 94,418.251416 ms | Production audit: 0 vulnerabilities; strict OpenSpec: 8/8; pack + independently installed API/CLI/MCP/Harness: 84 entries, passed | `macos22-master.log`; exit 0 |
| macOS arm64 / Node 20.20.2 / master (supplementary) | 446/446, zero failures/skips; 70,226.423375 ms | Fresh `npm ci`; production audit: 0 vulnerabilities; strict OpenSpec: 8/8; pack + independently installed API/CLI/MCP/Harness: 84 entries, passed | `/private/tmp/memobranch-node20-acceptance-lmrr6j/macos20-master.log`; exit 0 |
| Linux / Node 20 / master | Not complete | Docker unresponsive; older candidate run is not final evidence | No completed result |
| Linux / Node 22 / main | Not run on final candidate | Docker recovery required | No result |

The supplementary Node 20 gate used an isolated `git archive` of `91969db`, a fresh dependency install and the official Darwin arm64 v20.20.2 distribution verified against its HTTPS `SHASUMS256.txt`. It ran the same check/audit/OpenSpec/pack/installed-package sequence and produced the same 84-entry tarball SHA-1 (`df902ba1bd5f0f9162be287a124e5f212b60138c`). It is additional minimum-runtime evidence, **not a substitute for Linux**.

A Linux Node 20.20.2/arm64/master run for the older candidate printed its runtime identification but has not completed dependency installation; Docker status requests also remain unresponsive. A fresh read-only `/_ping` probe timed out after 5 seconds with no response. Restarting Docker requires user approval because it can interrupt unrelated containers. No Linux result is marked passed. Only completed exit-zero results may be entered as passed. These are local environment checks, not evidence of a GitHub-hosted Actions run. Independent review is no longer blocked by workspace credits, but full acceptance remains blocked by the missing Linux results.

Hosted-model observation (`L`) has not been run. Deterministic fixtures and local HTTP services establish runtime/protocol behavior, not real-model synthesis quality. Windows process-tree behavior, remote production credentials, distributed writes and actual power-loss durability have not been tested by this run. The matrix does not make those release requirements; their limitations remain explicit.
