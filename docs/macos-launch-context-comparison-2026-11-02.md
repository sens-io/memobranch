# Same-day macOS Node 20 launch comparison

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Runtime candidate: `e44c096e4479f465f16e61ccd5d47d1243023a41`.
Starting documentation candidate: `d54860437e7301fca02ace99f695c94c5f8a2892`.
This continues the [actual-worker observation](macos-process-entry-observation-2026-10-30.md).
**Terminal's original complete matrix passed. The application-launched failure
still exists; no product correction or final batch acceptance is claimed.**

## Unchanged inputs and actual launch origins

The cached macOS arm64 Node **20.0.0** executable remains the original path,
SHA-256 `ddd82d5e23efa1ac08ecae9c6abd7b4459da903d1946b9c9a2568df010a9f534`.
Existing Node **22.17.0** only drives these Node 20 commands. The original test
sources, compiled collections, assertions, ten-second waiter deadlines and skip
conditions were not changed. The drivers checked all **763** retained input/build
hashes before running; that inventory includes current source, tests and build
files, not 763 tests or individually inventoried dependencies.

Each branch value is subprocess-only configuration, verified with an actual
implicit Git initialization. Global Git configuration was unchanged. Both launch
origins used the same permitted system temporary directory; neither wrapper
changes `TMPDIR`. Driver logs remain under `.scratch/`; original tests also use
their existing system temporary directory. The corrected guard and its independent
review are recorded in the earlier observation.

The Terminal ancestor chain is Node 22 → login shell → `login` →
`/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal`.
The ordinary application chain is Node 22 → Bash → bundled Codex CLI →
`/Applications/ChatGPT.app/Contents/MacOS/ChatGPT`. These are recorded process
paths, not labels inferred from `TERM_PROGRAM`.
Current metadata: macOS **15.5**, build **24F74**, arm64; the observed application
version is **26.1027.51404**, build **23880**. Version metadata does not establish
which component caused a delay.

## Complete results

All rows below are complete runs with zero cancelled/skipped tests. The collections
and repeated rows overlap; do not sum them as distinct functional cases.

| Launch / diagnostic | Actual Git default | Collection | Passed / total | Failed | Child command exit |
| --- | --- | --- | --- | --- | --- |
| System Terminal | `main` | Current | **38/38** | 0 | 0 |
| System Terminal | `main` | Retained original | **37/37** | 0 | 0 |
| System Terminal | `master` | Current | **38/38** | 0 | 0 |
| System Terminal | `master` | Retained original | **37/37** | 0 | 0 |
| Application, ordinary command output | `main` | Current | **36/38** | 2 | 1 |
| Application, foreground requested | `main` | Current | **37/38** | 1 | 1 |
| Application, only `MallocNanoZone` removed from this launch subtree | `main` | Current | **36/38** | 2 | 1 |
| Application, five selected startup settings removed from this launch subtree | `main` | Current | **36/38** | 2 | 1 |
| Application, tool's terminal/PTY mode | `main` | Current | **37/38** | 1 | 1 |

The ordinary application run again failed CLI `import-prepare` and `import-apply`
waiter observations, child code `null`, `SIGTERM`, empty stderr. The foreground
request and PTY runs still failed prepare; their additional passing apply case is
not proof of a fix. No diagnostic changes a failing assertion into a pass.

Terminal result prefix:
`.scratch/macos-node20-terminal-048a8d12-6bf4-422b-90e6-2ad172b045d9`.
Its `-{main,master}-{current,original}.log` files and `-results.json` retain all
four complete results. Application prefixes, in table order:

- `.scratch/macos-node20-app-23e8bcbb-8061-4228-8474-744fb04d96eb`
- `.scratch/macos-node20-app-8d12294a-b993-4d76-a0eb-6873db8aebd4`
- `.scratch/macos-node20-app-49aa3d2a-fb27-49cf-9b96-3df26708581f`
- `.scratch/macos-node20-app-df0ed1c2-0ca1-470f-b06b-4499efcf937c`
- `.scratch/macos-node20-app-e062a137-833f-422f-b6db-941f2ec6f9e5`

Each has `-main-current.log` and `-results.json`.
The foreground record verifies this application was frontmost at the start, but
another application was frontmost after the test. It does **not** establish a
continuously foreground run or measure App Nap. The user's later focus was left
in place. No sleep, priority or security setting was changed.

## Limited environment checks, not a causal explanation

Outer-launcher snapshots hash only a small allowlist of startup settings; they do
not record credential variables or their values. Six names differed:
`MallocNanoZone`, `PATH`, `TERM`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`,
`__CFBundleIdentifier`. These snapshots are not a capture of every variable in the
later Node 20 worker/CLI child, nor proof that all other process state matched.

Both origins resolved the same `/usr/bin/git`, version
`2.39.3 (Apple Git-146)`, SHA-256
`bed335fb48472e4ee3c2c3a38517b208326f37865bd57792df88b42669ec9603`.
The different `PATH` fingerprint did not select a different Git executable in
these observations. The one-setting control removed `MallocNanoZone` only for
that launch. The five-setting control additionally removed `TERM`, `TERM_PROGRAM`,
`TERM_PROGRAM_VERSION` and `__CFBundleIdentifier`. Neither control fixed the full
run; there was no persistent environment or configuration edit.

A separate shorter diagnostic ran three real SDK operations followed by a
version-only child. That final child completed in **7656 ms**; the entire outer
TAP script took **11452.511625 ms**. It did not reproduce the complete collection's
failure. The script's outer TAP 1/1 is not another 38-case acceptance.
Its inherited `cancelledAndRetried` label retains the old limitation: cancelled
apply is followed by prepare, not another apply. It is not new apply-retry proof.

Evidence: `.scratch/macos-launch-env-comparison-2026-11-02.json`,
`macos-launch-git-comparison-2026-11-02.json`, the referenced hashed snapshots,
`macos-node20-sdk-env-control-2026-11-02.mjs` and
`macos-node20-sdk-env-baseline-2026-11-02.log`.

## System-policy records also occur during successful runs

A read-only system-log query for this exact Node 20 executable completed with
exit 0. The **455,483,919-byte** JSON contains **394,499** parsed records, including
**131,579** validation-category mismatch messages (`6/3`) and **131,339** messages
whose format says security policy would not allow a process. These are the
system's words, not a confirmed account of the CLI failure's cause.

The successful Terminal window (**10:45:30–10:57:05**, local time) also contains
**155,847** of the same `6/3` messages and **155,556** of the same would-not-allow
messages. Their presence therefore does not distinguish a passing from a failing
launch. They must not be represented as proof that Gatekeeper, a signature rule,
App Nap, this application or MemoBranch caused the timeout. PID numbers extracted
from message text are not verified CLI/parent assignments, and can be reused.

The cached executable also passed read-only `codesign --verify --strict`:
**valid on disk**, **satisfies its Designated Requirement**, exit 0. That is not a
fresh notarization, OS launch-policy or signature-chain assessment verdict.
Nothing was re-signed, cleared from a security cache or allowed through a new
security exception.

Raw query, bounded stream summary and successful-window counterfactual are retained
under `.scratch/macos-node20-launch-system-log-2026-11-02.*`,
`macos-node20-system-log-summary-2026-11-02.json`,
`macos-terminal-node20-policy-log-2026-11-02.*`, and
`macos-terminal-policy-counts-2026-11-02.json`. The JSON source SHA-256 is
`61bc1f09e3b3ab1fd16fe54a702ecb47c51889b2dcde9ff559697195c5574af7`.

## Remaining acceptance condition

The **59-artifact** supplement is frozen in
`.scratch/macos-launch-context-inventory-2026-11-02.json`, SHA-256
`f06f7671b9f337c61e2320d5a3af7239711c3f579498b6f6d134023c5da95e1b`.
It includes raw logs, both origin records, controls, sources and summaries.
The earlier 72-artifact and 12-artifact inventories were verified without changing
their files/hashes, and all 763 input/build snapshot hashes still match. Artifact
sets can overlap; none of these counts is a count of distinct functional tests.
The scoped process check found no matching owned drivers or compiled test runners
left running: `.scratch/macos-launch-context-cleanup-2026-11-02.json`.

| Source branch | Confirmed state | Remaining requirement |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Original complete Terminal matrix passes both actual defaults; same-day application-launched complete failures persist. No supported product correction has been identified. | Explain/correct the remaining known failure and review the exact final acceptance candidate. Keep batch 4–6 and the combined OpenSpec checks unaccepted meanwhile. |

Independent read-only scope review checked the four Terminal results, two initial
application results and the original requirements. It explicitly distinguished
the passed real macOS matrix from closing the still-known failure. The original
assertions/lowest runtime and both defaults remain required; a passing subset or
another context does not establish that the known failure was corrected.

The current runtime's earlier Linux, Node 22, installed-package and native PDF
evidence retains its recorded scope. Windows execution is still skipped by the
user's explicit request. No original failure or interrupted draft was overwritten.

## Independent review of the comparison candidate

Fixed candidate `9a9dd97a4b4c7fbd78c6c043a466f32b0c8bf7a7`, source branch
`kevin/knowledge-expansion`, received two independent read-only reviews. The scope
review covered all **3/3** changed documents, zero skipped; the native review
covered this complete new report **1/1** and its evidence, zero skipped. Both
verified the 59-artifact inventory and its bytes/hashes. The native review also
rehashed the prior 72/12 artifacts, all 763 inputs and Node executable, and
independently streamed both system-log counts. Neither confirmed a new P1/P2.
The native review's minor timing-wording observation is clarified above: 7656 ms
belongs to the final child, not the whole three-operation diagnostic.
Reviewers did not run tests, new diagnostics, networking, installation or mutations.
These reviews verify the comparison record; they do not accept the remaining
known application-launched failure or the unfinished whole roadmap.

Database changes: none. Data migration: none. Persistent configuration changes:
none. Diagnostic environment changes were limited to the specified owned launch
subtrees. No project runtime/test/dependency change, push, npm publication,
deployment, real account, grant, service or host security-policy change occurred.
