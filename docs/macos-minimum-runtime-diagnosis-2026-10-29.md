# macOS minimum-runtime startup investigation

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Runtime/source checkpoint: `c01ae9b1999030d4d305d3a88c3883c8b411fa93`
(runtime code unchanged from `e44c096e`). **The gate remains open.** These
diagnostics identify a smaller triggering sequence; they do not replace the
retained failing complete collections or accept the roadmap batch.

## Fixed conditions and evidence

- macOS 15.5 (24F74), arm64; existing Node **20.0.0**, libuv 1.44.2,
  V8 11.3.244.4-node.3. Executable SHA-256:
  `ddd82d5e23efa1ac08ecae9c6abd7b4459da903d1946b9c9a2568df010a9f534`.
- No product code, original test assertion, 10-second waiter deadline, supported
  runtime version or system security setting changed. The four original test
  sources still compare byte-for-byte with Git `507a218`.
- Compiled staging includes the current source, full built `dist`, original
  non-TypeScript fixtures, built PDF worker, package metadata and assets.
- Only synthetic local vaults, fake principals/keys/grants and explicitly
  overridden fixture model methods were used. No real account, sharing grant,
  model service, publication, push or deployment was added.
- Frozen inventory: `.scratch/macos-node20-diagnosis-inventory-1.json`, **26**
  script/log hashes, SHA-256
  `ccec9a8a8cfc1afd264148356d12247d4ad9848a50f2ec0f8d8d38af462c083d`.
  The inventory identifies these observations; they are not 26 tests. Future
  experiments must use new files rather than overwrite these entries.

Windows platform execution remains **skipped by the user's explicit request**.
That waiver does not apply to this macOS gate.

## Complete and instrumented failures

The earlier original-path complete protocol result remains **36/38**, with
`import-prepare` and `import-apply` failing to observe their source-lock waiters:
`.scratch/pdf-processing-server-node20-2.log`. Its original four-file **35/37**
failure is also retained; neither was relabeled as passed.

A fresh path-control experiment copied the existing executable with `cp -p`,
compared its bytes and extended attributes, and confirmed the same version/hash.
The unchanged complete original four-file collection again failed **35/37**,
zero cancelled/skipped, exit 1: `.scratch/macos-node20-same-binary-37.log`.
The copy is a diagnostic control, not a substitute original-path acceptance run.
It did not resolve the same two failures.

A separate instrumented original-path run executed the entire 19-case
`wiki-import-adapters` file and failed **17/19**, zero cancelled/skipped, exit 1:
`macos-node20-entry-tests.log`, with terminal driver result in
`macos-node20-entry-driver.log`. An explicit `NODE_OPTIONS --require` record was
inherited by each Node child; it did not change any product function or test.
`NODE_TEST_CONTEXT` is Node's test-runner environment marker, observed as `child`.

The two failing child PIDs had **no completed entry record** at roughly 2 and 7
seconds, while `ps` still showed them alive with 32 KiB resident memory.
Snapshots and exact arguments are in `macos-node20-entry-observations.json`;
successful child entries are in `macos-node20-entry.jsonl`. Earlier retained
sampling of the same failure class showed `_dyld_start + 0` and a 96 KiB physical
footprint. These observations are consistent with a launch-stage stall, but an
absent record alone does not prove no JavaScript executed: the recording itself
uses a synchronous filesystem write. The underlying kernel/runtime cause is
**not established**. No platform or signature-policy defect is asserted.

Read-only signature metadata showed Node Foundation signing identities for both
existing Node 20 and Node 22 executables. This is not a fresh trust-chain or
notarization verdict. A narrowly filtered policy log returned no matching record;
that absence does not exclude a policy contribution. A system snapshot showed
16 GiB memory, 10 logical CPUs and 31% reported free memory. It does not prove
there was no transient memory/CPU/I/O pressure during a failed launch.

## Controls and triggering sequence

Eight basic spawn controls, with and without a real `withFileLock` owner, all
completed in **17–152 ms**: `macos-node20-spawn-probe-1.log`. They used version,
trivial JavaScript and actual CLI help commands. They do not exercise Wiki copy.

An independent script then created the same synthetic shared Wiki fixtures and
performed actual CLI prepare/apply cancellation, both without and with the child
test marker. All four observed flows entered the expected real source queue,
returned code **130 / OPERATION_CANCELLED**, retained their owner and left both
vaults unchanged: `macos-node20-standalone-1.log`.
Running the same script under Node's test runner observed the same four outcomes
in `macos-node20-standalone-under-runner-1.log`. TAP reports **one script**, not
four independent tests. The script logs unsuccessful waiter observations rather
than unconditionally failing them, so its exit code alone is not acceptance
evidence; the four actual `waiter:true` results are the relevant observations.

The following name-filtered runs preserve the original source/assertions/deadline
and are **diagnostic subsets only**. None replaces the complete 37/38-case gate.
All report zero cancelled cases; unmatched cases are explicitly skipped.

| Selected prior behavior plus the three original CLI cancellation cases | Passed / selected | Unmatched skipped | Log under `.scratch/` |
| --- | --- | --- | --- |
| CLI cancellations alone | 3/3 | 16 | `macos-node20-cancel-isolation-1.log` |
| All earlier CLI cases | 6/6 | 13 | `macos-node20-cli-prefix-1.log` |
| All Harness cases | 7/9 (same two CLI failures) | 10 | `macos-node20-harness-prefix-1.log` |
| One successful Harness SDK copy/integration lifecycle | 4/4 | 15 | `macos-node20-one-harness-prefix-1.log` |
| Harness permission/unsupported-field lifecycles | 4/4 | 15 | `macos-node20-harness-strict-prefix-1.log` |
| All three Harness cancellation/retry lifecycles | 5/6 (CLI prepare failed) | 13 | `macos-node20-harness-cancel-prefix-1.log` |
| Only Harness prepare cancellation/retry | 4/4 | 15 | `macos-node20-one-harness-cancel-prefix-1.log` |
| Only Harness apply cancellation/retry | 4/4 | 15 | `macos-node20-one-harness-apply-cancel-1.log` |
| Only Harness integration cancellation/retry | 4/4 | 15 | `macos-node20-one-harness-integration-cancel-1.log` |

The smallest **tried** repeating trigger is the group of three SDK
cancellation/retry lifecycles; pairs have not yet been tested, so this is not a
claim of a mathematically minimal sequence or a proven component root cause.

An independent SDK host script reproduced that group without the original
19-case file: all three real calls were cancelled; prepare and integration were
then retried, while cancelled apply was followed by a new prepare, before each
host was disposed. The next CLI
prepare then had **`waiter:false`, no completed entry record and SIGTERM after
10052 ms**. The other three CLI observations succeeded. Log:
`macos-node20-sdk-standalone-prefix-1.log`. Its outer TAP **1/1** is explicitly
**not a successful cancellation gate**: the diagnostic script records this
failed flow without failing the whole file. The original uniform
`cancelledAndRetried:true` label overstates the apply branch: it proves a later
prepare remained usable, not an apply retry. The original script/log are retained
unchanged. Parent RSS after the three calls
was approximately 117/123/128 MB; that alone does not establish or exclude a
resource explanation.

A control performing only three rounds of the existing helper's environment
save/restore, without SDK execution, observed four healthy CLI flows:
`macos-node20-env-roundtrip-1.log`. Thus environment rewriting alone is not a
sufficient reproduced cause. Neither is a single SDK cancellation, the test
marker alone, basic lock ownership alone, or the executable's original path.
The observations do not rule out interactions between those factors.

## Later controls: active request cancellation and CLI code are not required

This second set preserves the original 26 artifacts. New inventory:
`.scratch/macos-node20-diagnosis-inventory-2.json`, **27** source/log artifacts,
SHA-256 `d2ce8e36a40d4d300d955f513e378e353b1f16f6f177b2c1d2f02431933697a4`.
The first inventory was rechecked after these runs: all original hashes matched.

Independent review of `e9aa6a9` covered both changed documents (2/2, zero skipped)
and the 26 hashes. A separate native-evidence review covered the main document
and six designated evidence files, zero skipped. It found one P2 wording error:
apply cancellation was followed by a fresh prepare, not an apply retry. The text
above now says exactly that; original scripts/logs remain unchanged. Neither
review established a product root cause or accepted the failing runtime gate.

Each later command control used a fresh SDK parent and the same Node 20.0.0
binary, source fixtures and ten-second observation bound. **All are diagnostic
scripts, not added passing acceptance cases.** Their outer TAP 1/1 only means
the script ended; the recorded `completed:false` / `waiter:false` still fails
the behavior being investigated.

| Control after three SDK operations | Observed result | Raw log under `.scratch/` |
| --- | --- | --- |
| Passive state before/after disposal | No changed environment values or newly added `Object.prototype` property names at capture. Three standard socket handles remained; the request snapshot changed from a file-close request to an FS callback. The next CLI prepare still failed. These snapshots do not exclude other native or deferred state. | `macos-node20-sdk-state-1.log` |
| First child is only `node --version` | **Not completed**; SIGTERM after 10067 ms. This command does not run MemoBranch CLI logic. A JavaScript entry record is not expected from a version-only command. | `macos-node20-sdk-first-version-1.log` |
| First child is a minimal `-e` script | **Not completed**, no completed entry; SIGTERM after 10073 ms. No MemoBranch import in that child. | `macos-node20-sdk-first-minimal-1.log` |
| Three normal SDK calls, no cancellation of running requests, then original CLI probe | SDK calls completed; the next CLI prepare still had **`waiter:false`** and SIGTERM after 10049 ms. Therefore cancelling an active request is **not a necessary condition**. The later three CLI observations succeeded. Normal host disposal still aborts its lifetime controller; this control does not eliminate every use of `AbortController`. | `macos-node20-sdk-no-cancel-1.log` |
| Diagnostic parent launched with `--jitless`, first child still ordinary `--version` | Command completed after **9892 ms**, close to the bound, rather than becoming a normal fast launch. The warning about disabled WebAssembly is retained. This changed parent mode is not a product fix or a substitute default-runtime gate. | `macos-node20-sdk-first-version-jitless-1.log` |

The first filtered observations associated the symptom with a cancellation
group; these later normal-call controls refute any inference that cancellation
of an active request is required. No test-file split, forced collection, longer deadline,
runtime upgrade or automatic process-resume behavior was added to the product.

## Same-failure native observation

The native observation used a fresh parent **98157** and its exact version-only
child **5295**. At approximately 3.3 seconds after first observation, `sample`,
`vmmap`, both `lsof` calls and `ps` all completed successfully for that same
parent/child pair. The child subsequently failed to finish and was terminated
at 10057 ms under the original diagnostic bound.

- `macos-node20-native-version.sample.txt`: `_dyld_start + 0` throughout the
  sampled second, physical footprint **96 KiB**.
- `macos-node20-native-version-vmmap.log`: no malloc zones; the system tool
  explicitly reported **“Process exists but has not started -- it is
  launched-suspended.”** Read-only library pages were almost entirely
  unallocated, with 16 KiB resident text.
- `macos-node20-native-version-child-files.log`: only the executable, `dyld`,
  working directory and three standard streams; no Wiki/source file was open.
  The parent file list records its owned source lock and its own standard/loop
  descriptors. No application read or file-lock wait inside the child was observed.
- `macos-node20-native-version-processes.log`: matching PID/parent/arguments,
  32 KiB child RSS and normal recorded priority/nice values at capture.
- `macos-node20-native-version-observations.json` binds the sampled pair and
  actual command outcomes; the driver/test logs record their terminal states.

This is direct evidence of an unstarted, suspended **version-only child in this
particular reproduction**, rather than a conclusion based solely on missing
JavaScript logs or an old PID. It does not identify who requested/caused the
suspension or prove every earlier failing child had exactly the same cause.
Apple documents [a process-start suspension attribute](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/posix_spawnattr_getflags.3.html),
but the observed tool output alone does not prove that attribute was passed.
The [published Node 20.0.0 spawn implementation](https://github.com/nodejs/node/blob/v20.0.0/deps/uv/src/unix/process.c#L410)
is a reference, not a trace of the actual captured syscall parameters.

A separate controlled version-only reproduction targeted its own observed child
**15652**, parent **8917**, with one ordinary `SIGCONT` after approximately three
seconds. The command still failed to complete and received SIGTERM at 10069 ms:
`macos-node20-resume-version-{observations.json,tests.log,driver.log}`. This did
not establish a usable recovery or the suspension's origin. No production
process-resume workaround or host security change was made.

## Additional controls and fixed-candidate review

Four further controls used the same independent three-call SDK prefix and
ten-second observation bound. Each ran in a fresh parent. Their outer TAP result
still records script termination, not acceptance of the observed child behavior.

| First child/control after the SDK prefix | Actual result | Log under `.scratch/` |
| --- | --- | --- |
| `node --version` with an empty environment | Not completed; SIGTERM after **10066 ms**. | `macos-node20-sdk-first-version-emptyenv-1.log` |
| `node --version` without acquiring the synthetic source owner lock | Not completed; SIGTERM after **10054 ms**. | `macos-node20-sdk-first-version-nolock-1.log` |
| `/usr/bin/true` instead of Node | Completed successfully after **53 ms**. | `macos-node20-sdk-first-version-systemtrue-1.log` |
| `node --version` in a new process group/session (`detached:true`) | Not completed; SIGTERM after **10061 ms**. | `macos-node20-sdk-first-version-detached-1.log` |

Emptying the child's environment, removing that owner lock and changing its
process group did not remove the symptom. The system command's success is a
positive control for that command; it does not identify a Node, SDK or OS defect.
No product implementation was changed on the strength of these controls.

The new **12** source/log artifacts are frozen in
`.scratch/macos-node20-diagnosis-inventory-3.json`, SHA-256
`4933e55c59df3253e91f00daac64724874e89d1107fab9f9051066482c3a5f1e`.
All original 26 and second-set 27 hashes were rechecked unchanged. The four
original test files still match Git `507a218` byte-for-byte. These counts are
artifact counts, not added passing tests.

Read-only review of committed candidate `7ef1cdc4046061fa24e4e1f3a312c6ffe21b22ac`
covered the main report and roadmap **2/2**, zero skipped. A separate native
evidence review covered the main report **1/1**, zero skipped. Both checked the
new 27 and original 26 hashes, closed the apply-follow-up wording P2 and found
no new confirmed P1/P2 in those scopes. The additions in this section require
their own committed-candidate review; no review accepts the failed macOS gate.

## Remaining issue

| Source branch | Confirmed observation | Required next evidence |
| --- | --- | --- |
| `kevin/knowledge-expansion` | The macOS Node 20 minimum-runtime complete protocol gate still fails. Repeated SDK activity followed by a new Node child reproduces the startup symptom without cancelling active requests or running CLI logic; individual operations also have positive controls. One same-failure version child was directly observed unstarted/suspended. | Identify the suspension trigger or compare another actual macOS environment; correct any confirmed project defect and rerun the entire unchanged protocol collections under both real Git defaults. Do not close this with a filtered run, longer deadline, different version/OS, or test-file isolation that merely hides the interaction. |

The user confirmed that another macOS test environment is **not currently
available**. This prevents that comparison now; it does not waive the failed
gate, establish a cause, or authorize a host/runtime/security change.

No new product correction is claimed by this investigation. The existing Windows
ownership repair, Node 22 full checks, package consumers and historical Linux
checks retain their previously documented scopes. Database changes: none. Data
migration: none. Configuration changes: none. No host upgrade or real service
change. Review evidence above applies to its exact committed candidate; the
remaining runtime failure and final roadmap acceptance remain open.
