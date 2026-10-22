# Experience core / CLI checkpoint — 2026-10-22

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Baseline: `601efb2ef5291a339bc6d575d12c48df3e201477`.
Work began on 2026-10-22; final local checks completed on 2026-10-23.

This is a **core and CLI checkpoint**, not completion of the remaining roadmap.
MCP/Harness/Web experience management, historical availability reconstruction,
local/Git fixed-version sharing, cross-vault import/merge and local OCR remain
tracked in [remaining work](remaining-roadmap.md). Sharing will use the user's
chosen local/Git approach, without a new cloud account service.

## Local commits

| Commit | Purpose | Push |
| --- | --- | --- |
| `e6275126b300082e8470ef6a6981d520eb1a7958` | Immutable experience evidence, signed proposal, trusted-host validation, explicit skill files, CLI, package checks and OpenSpec | Not pushed |
| `431ec569d0e7c8e4c589b8f3f79bb89833c35c19` | R1/R2: synchronous final authority/time check, source selection before decryption, regression tests | Not pushed |
| `fb9a9973f08a0b07a2e7c68f659d27964c56731d` | R3/R4: final tenant checks and safe saved-record identifiers on post-commit refusal | Not pushed |
| `db1014f833a54357b7ca2a1008221c5ea06e628f` | Checkpoint scope, progress and P3 English wording correction; runtime unchanged | Not pushed |

No database change, data migration, configuration change, model service,
real vault grant, deployment, push or npm publication. The optional trusted-host
callback is application code, not an agent-selected executable. No generated
skill is installed or automatically executed.

## Verification

| Check | Evidence / result |
| --- | --- |
| Build and test types | Passed at `fb9a9973` |
| Targeted core boundary tests | 19/19, zero failure/cancellation/skip; `.scratch/experience-targeted-fix-tenants.log` |
| Full retained suite, Node 22 / Git main | 769 functional + 14 release + 10 evaluation = 793 passed; zero failure/cancellation/skip; `.scratch/experience-final-full-main.log` |
| Full retained suite, Node 22 / Git master | 769 functional + 14 release + 10 evaluation = 793 passed; zero failure/cancellation/skip; `.scratch/experience-final-full-master.log` |
| Strict OpenSpec 1.0.2 | 27/27; `.scratch/experience-final-specs.log`; acceptance checkbox text recheck recorded separately |
| Production dependency audit | Zero known production vulnerabilities; `.scratch/experience-final-audit.json` |
| Same installed tar, Node 22.17.0 / Git main | Passed, 359 packed entries; `.scratch/experience-package-node22.log` |
| Same installed tar, exact minimum Node 20.0.0 / Git master | Passed, 359 packed entries; `.scratch/experience-package-node20.log`; before/after SHA-256 files compare equal |
| Skill format validator | `Skill is valid!`; `.scratch/experience-skill-format.log` |
| Independent synthetic skill instruction exercise | `  delta  ` → `DELTA`; Chinese translation outside scope; shell text treated only as a string, never executed |

Installed artifact: `.scratch/experience-package.B47hy0/memobranch-1.1.0.tgz`,
built at `fb9a9973`, SHA-256
`de9a1dc5a92380476e3d22a0355e37db0f0929a0bae6a3135c1dc2620f0c17ae`.
Subsequent verification/report/task text and the P3 English wording correction
are not in that tar. They do not change runtime code. No publication is implied.

The system and application-bundled Python both lacked PyYAML, so their initial
validator attempts failed. A project-local ignored `.scratch/experience-skill-validator`
environment with fixed PyYAML 6.0.2 then ran the supplied validator successfully.
No system Python, package manifest or lock file changed. The retained fixture is
synthetic, not a user's skill installation.

Earlier runs are not substituted for final evidence: the initial candidate's
main suite passed (764 functional + 14 release + 10 evaluation); its master run
was interrupted to fix findings. The `431ec56` full rerun was also interrupted
for R3/R4. Their logs remain in `.scratch`; neither interrupted run counts as
final acceptance. Initial test-authoring/type errors were fixed before the
reported 19/19 result; no retained assertions, limits or concurrency were reduced.

## Independent adversarial review

OCR was used only for local deterministic file selection and rules, not an
external model endpoint. Git 2.39.3 generated its older-version warning; no Git
upgrade was performed. Initial preview listed 16 files (6 reviewable by default,
10 excluded by its filters); **all 16**, including tests/docs/specs, were manually
assigned and reviewed: 5 core files and 11 adapter/document files, skipped 0.
The four-file R1/R2 patch and five-file R3/R4 patch were independently reviewed
in full, skipped 0, against their fixed commits.

| ID | Priority | Source branch | Finding | Resolution / evidence |
| --- | --- | --- | --- | --- |
| R1 | P2 | `kevin/knowledge-expansion` | Async final-source checks could outlive review authority or proposal time; an extra await also affected existing synchronous Wiki final checks | Closed in `431ec56`; separate async revalidation and synchronous final decision, zero-save counterexamples and actual transaction microtask regression |
| R2 | P2 | `kevin/knowledge-expansion` | Whole-directory materialization decrypted unrelated private evidence before explicit selection and let an unrelated erased key block reads | Closed in `431ec56`; unique target envelope, authorization/opt-in before target decryption; real private decrypt-count and unrelated-key regressions |
| R3 | P2 | `kevin/knowledge-expansion` | Final return/persistence authorization omitted current tenant after async cleanup | Closed in `fb9a9973`; tenant-bound final checks, source-read and cleanup regressions |
| R4 | P2 | `kevin/knowledge-expansion` | A completed save could be reported as an unidentified failure or return report plaintext after access withdrawal | Closed in `fb9a9973`; original error code plus only saved evidence ID/commit; real completed-transaction regressions |
| R5 | P3 | `kevin/knowledge-expansion` | English explanation ambiguously described normal pre-expiry commit completion as an error condition | Closed in `db1014f`, independently confirmed by the document reviewer |

The core reviewer independently replayed ten final lifecycle scenarios with real
engine code and in-memory ports, confirming R3/R4 closure and no other confirmed
runtime issue in its reviewed scope. Its port/lock/materializer substitutes do
not prove real disk, encryption or OS-lock behavior; those are separately covered
by the executing test suite. The other reviewer read the generated skill and
validation reference and performed only a text exercise, not command execution.
The four-file checkpoint `db1014f` was then independently reviewed, 4/4 and
skipped 0, confirming R5 closed and that pending adapters/roadmap items were not
misrepresented as complete. Final numerical/status text below is not runtime code.

The `agent-engineering` memory and evaluation guides informed the separation of
caller observations, held-out checks and reusable procedures. `skill-creator`
informed applicability/authority limits and the format check. Neither skill
authorized installation, external evaluation, account grants or publication.

## Limits and next step

Source outcomes are caller observations. Coverage and signatures do not establish
evaluator honesty, task independence in the real world, universal skill quality or
external model effectiveness. An uncooperative callback's external effects are
the trusted host's responsibility; an event-loop deadline is not an OS sandbox.
Plaintext exports cannot be recalled. Current access/key checks stop new exports,
not offline copies. No Linux/hosted CI, real provider quality or production rollout
is claimed by this local checkpoint.

Core/CLI retained, package, audit and fixed-runtime review checks are complete.
Continue the adapter and management portion of batch 1. Re-run relevant retained
checks for those changes; do not close the overall goal at this checkpoint.
