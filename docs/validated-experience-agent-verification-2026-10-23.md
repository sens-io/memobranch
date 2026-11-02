# Experience agent adapters — 2026-10-23

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Baseline: `4b6105e226eff21f4ee33a42ba3fc050acc929d7`.
This accepts the MCP/Harness portion only. Web and the other roadmap batches
remain open in [remaining work](remaining-roadmap.md).

## Local commits and behavior

- `41b630f7aaf275cdd7d8037b3bd6e8edfc602428`: three guarded tools, strict
  schemas, complete bounded responses, official SDK tests, installed consumers,
  bilingual documentation and OpenSpec.
- `120a0407379e480333cfdbbba4871df4e3c7c3c8`: add the three new names to the
  retained full-grant Harness catalog assertion; no runtime changes.

`memory_experience_capture` stores an unverified observation.
`memory_experience_prepare` binds the exact sources and procedure.
`memory_experience_export` requires explicit confirmation, a genuine passing
validation and current access/private opt-in. No agent tool selects or executes
an evaluator, installs a skill, approves a memory, or overrides host identity.
Validation remains trusted application code. Complete escaped JSON responses
above 9 MiB are refused rather than truncated.

Push: not pushed. Database change: none. Data migration: none. Configuration
change: none. No real vault grants, provider calls, deployment or publication.

## Verification

| Check | Actual result / local evidence |
| --- | --- |
| New real MCP/Harness workflows | 7/7; `.scratch/experience-adapters-targeted-1.log` |
| Retained tool, permission and lifecycle tests | 46/46, failure/cancellation/skip 0; `.scratch/experience-adapters-retained-targeted-fixed.log` |
| Full Node 22 / Git main | 776 functional + 14 release + 10 evaluation = 800 passed, failure/cancellation/skip 0; `.scratch/experience-adapters-full-main.log` |
| Full Node 22 / Git master | Same 800 passed, failure/cancellation/skip 0; `.scratch/experience-adapters-full-master.log` |
| Strict OpenSpec 1.0.2 | 27 passed, 0 failed; `.scratch/experience-adapters-specs-final.log` |
| Production dependency audit | 0 known vulnerabilities; `.scratch/experience-adapters-audit.json` |
| Same installed tar on Node 22.17.0 / Git main | Passed; `.scratch/experience-adapters-package-node22.log` |
| Same installed tar on exact minimum Node 20.0.0 / Git master | Passed; `.scratch/experience-adapters-package-node20.log` |

The 363-entry tar is `.scratch/experience-adapters-package.W7w6mI/memobranch-1.1.0.tgz`,
built at `41b630f`, SHA-256
`6fc7a4acda2553cdd2f69770ad8c2da6b1e4a37603db9012d0527a8e507441c1`.
Before/after hashes match. Installed checks exercise actual public types, library,
CLI, MCP child transport and Harness plugin against synthetic local vaults.
Subsequent catalog-test and checkpoint text are not runtime changes and do not
claim a new published version. No assertions, timeouts or concurrency were reduced.

The first retained adapter run was 45/46: its exact full-grant catalog still
expected the old names. The corrected expectation retains every old tool and adds
exactly the three new ones. Initial test-authoring type errors were fixed before
the reported results. Neither failed run counts as passing acceptance.

## Independent adversarial review

OCR supplied local deterministic selection/rules only; no external model endpoint.
All 13 changed files were reviewed, including tests/docs/specs excluded by default:
4 runtime/tool-test files and 9 script/document/spec files; skipped 0. The separate
one-line catalog correction was reviewed 1/1, skipped 0. No confirmed open issue
was found in those fixed-commit scopes.

The runtime reviewer independently exercised official SDK boundaries, nested
unknown-field rejection, six Harness grant combinations, default classification,
per-call cancellation, plugin shutdown and oversized/Unicode responses. Its vault
substitutes do not establish actual encryption or filesystem behavior; executing
tests and installed consumers separately cover those paths. The document reviewer
performed static review only, not a second full suite.

Coverage and signatures do not prove evaluator honesty, universal skill quality
or real provider effectiveness. A trusted callback is not an OS sandbox.
Plaintext copies cannot be recalled. Current source/key/access checks prevent new
exports, not offline copies. Local verification does not claim hosted Linux CI
or production rollout. Continue with Web management; do not close the overall goal.
