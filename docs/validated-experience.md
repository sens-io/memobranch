# Experience checks and explicit skill export

Development feature: library and CLI. Not yet a Web workflow or a claim about
real-world agent effectiveness. No model or external service is used by this path.

An execution trace records `family`, `taskId`, `runId`, `context`, `actions`,
`observedResult`, `outcome` (`success`, `failure` or `partial`) and `limitations`.
These are the caller's observations, **not independently verified facts**. Capture
stores ordinary immutable evidence with the normal scope, encryption and audit
rules. A changed observation is new evidence, not an edit to its old record.

```sh
amem experience capture --root ./vault --file trace.json --scope project
amem experience prepare --root ./vault --file proposal.json
amem experience export ev-0123456789ab --root ./vault --confirm
```

`proposal.json` contains `traceIds`, a lowercase hyphenated skill `name`, a
descriptive `description` explaining when to use it, `procedure`, `conditions`
and `limitations`. Capture needs write/read permissions in the CLI. Prepare needs
read/write. Library validation needs read/write/review. Export needs read/review
and `confirm: true`. Confidential materials additionally require the matching
`includeSensitive` / `includeSecret` option at prepare, validate and export (or
`--include-sensitive` / `--include-secret` CLI flags).

Prepare returns a signed local proposal valid for 24 hours, not an approved
memory. One anecdote may produce a proposal, but cannot qualify for export.
Incompatible nonpublic scopes cannot be combined. Sensitivity cannot be reduced;
the proposal can optionally raise it using `sensitivity`.

## Validation must be supplied by a trusted host

`vault.experienceValidate(plan, suite, runner, options)` takes **application code**
as `runner`. Neither CLI nor agent input may choose an executable/module or submit
prefilled passing results. The host must select meaningful tests and evaluate the
actual behavior of the exact procedure. It must also classify any newly produced
private outputs correctly; there is no automatic secret detector or OS sandbox.

The suite contains `name` and `cases`; each case has `id`, a distinct held-out
`taskId`, `category` (`transfer`, `retention`, `safety`), `input` and a nonempty
list of named `criteria`. Requirements:

- At least two distinct successful source tasks, or the configured
  `minimumProcedureEvidence` if larger; duplicate runs of one task do not count.
- At least two transfer tasks, one retained-behavior case and one safety case.
  All case tasks are distinct from each other and from the source tasks.
- For each case, the callback returns `observed` and `checks`, with exactly one
  `{ criterion, passed }` result for every declared criterion.
- All cases and criteria must pass. Errors or malformed results are stored as
  generic failed cases without callback exception text. Cancellation or deadline
  before commit preparation aborts without a new report. If cancellation arrives
  after a transaction is ready to commit, the existing atomic commit rule applies:
  it settles and the cancellation error identifies the completed commit.

The callback receives `{ plan, test, signal }`. Its plan/test values are isolated
copies. A callback must actually exercise the described procedure and compare its
observations with independent expected behavior; returning constant `true` is not
meaningful validation. The library checks binding, structure and coverage, **not
semantic correctness or evaluator honesty**. The runner is trusted local code and
is not sandboxed. It should honor the signal and stop external work itself.

Validation is sequential and bounded: 4–32 cases, 1–16 criteria per case, default
30-second total deadline (configurable 100–120,000 ms), bounded complete artifacts.
Pass `signal` or use `withOperation` through an existing invocation. Late work
cannot use the cancelled operation to start new vault writes; arbitrary external
effects remain the trusted host's responsibility.

Reports are immutable evidence binding the exact signed proposal, input suite,
observed results and classification. Source hashes, current config, tenant,
permissions, private selection and keys are checked again before persistence and
at export. Changed config requires preparing and validating again. No formal
memory is promoted, even after passing tests. Existing manual procedure approvals
alone do not qualify for this export path.

Final permission checks include the current principal's tenant after asynchronous
reads and lock cleanup. If expiry or an authority change is detected after an
already-ready commit completes, the error preserves its normal code and
adds `completedValidation` with the saved evidence ID and commit. It does not
return report plaintext. Inspect that record with current authority; do not assume
the error means nothing was saved or blindly repeat the evaluator.

## Export is data, not installation

`vault.experienceExport(validationId, { confirm: true })` returns JSON with
`files['SKILL.md']` and `files['references/validation.md']`. The CLI prints that
same JSON; it does not create folders. The caller decides where to save and review
the files. No automatic installation, execution, permission grant or publication.
The skill states its applicability, limits, current-authorization requirement and
selected validation provenance.

An exported plaintext skill may contain private material and cannot be recalled.
Removing access or a source encryption key stops **new** exports, not copied
files. A passing synthetic suite proves only those checks; separately measure
real transfer quality before relying on it in production.
