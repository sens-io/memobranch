# macOS minimum-runtime follow-up: complete failures retained

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Runtime candidate: `e44c096e4479f465f16e61ccd5d47d1243023a41`.
Starting documentation candidate: `7abfbd342545e6dc8bc897398d937db0e0d470d0`.
This continues the [earlier investigation](macos-minimum-runtime-diagnosis-2026-10-29.md)
and [scoped acceptance audit](roadmap-completion-audit-2026-10-29.md).
**No product correction or batch acceptance is claimed.**

## Unchanged complete reruns on October 30

The original-path macOS arm64 Node **20.0.0** executable was used. The fresh
compiled staging from the previous Linux supplement includes full runtime,
package metadata, assets and original fixtures. All **763** snapshot hashes still
match. The four retained original test sources match Git `507a218` byte-for-byte.
No original assertion, waiter deadline, test selection or platform skip changed.
No parallel heavy verification or diagnostic sampling ran during these reruns.

Each default was set only in the subprocess environment, then an actual implicit
Git initialization was probed. Host global Git configuration was not changed.

| Actual Git default | Current complete protocol collection | Retained original complete collection | Terminal result |
| --- | --- | --- | --- |
| `main` | **36 passed / 38**, 2 failed, 0 cancelled/skipped | **35 passed / 37**, 2 failed, 0 cancelled/skipped | Both exit 1 |
| `master` | **36 passed / 38**, 2 failed, 0 cancelled/skipped | **35 passed / 37**, 2 failed, 0 cancelled/skipped | Both exit 1 |

All four runs failed the same `import-prepare` and `import-apply` CLI waiter
observations. Each reported child code `null`, signal `SIGTERM`, empty stderr.
That alone does not prove where each of those particular children was waiting.
The collections overlap; they are not 75 distinct tests or full repository runs.

Logs: `.scratch/macos-node20-complete-{main,master}-{current,original}-2026-10-30.log`.
The fixed driver and four terminal results are
`macos-node20-complete-followup-2026-10-30.mjs` and
`macos-node20-complete-followup-results-2026-10-30.json` under `.scratch/`.

## Additional diagnostic controls across October 29–30

These are separate synthetic scripts, not passing replacement acceptance cases.
Outer TAP 1/1 means script termination; `completed:false` remains a failed
observation. Existing uniform `cancelledAndRetried:true` labels in copied SDK
prefixes retain the earlier limitation: cancelled apply is followed by prepare,
not by another apply. The copied original evidence was not edited retrospectively.

| Control | Recorded observation | Log under `.scratch/` |
| --- | --- | --- |
| Bare SDK only: three Context/SystemPrompt/ToolRuntime lifecycles, two synthetic echo calls each, no MemoBranch import | Next Node 20 version command completed in **18 ms**. | `macos-node20-bare-sdk-1.log` |
| Three real shared-fixture/prepare lifecycles without SDK host execution | Next version command completed in **6731 ms**. This is a slow positive result, not proof the SDK is necessary. | `macos-node20-fixtures-only-1.log` |
| Original three-operation prefix in Node 20, version-only child changed to installed Node 22 | **Not completed**, SIGTERM after **10095 ms**. A Node 20 child binary is not necessary for that symptom. | `macos-node20-parent20-child22-1.log` |
| Same prefix in installed Node 22, version-only child changed to original Node 20 | Completed in **64 ms**. This is a diagnostic parent-version change, not acceptance on Node 20. | `macos-node20-parent22-child20-1.log` |
| Pure heap allocation / JSON round trip, no project or SDK | Completed in **19 ms** despite approximately 129 MB RSS / 66 MB heap used. This does not exclude all memory-layout interactions. | `macos-node20-pure-heap-2.log` |
| Ten thousand synthetic functions, no project or SDK | Completed in **16 ms**. This is not a replica of every V8 compilation state. | `macos-node20-pure-functions-2.log` |
| 150 sequential `true` commands in new process groups; 150 Git version queries with and without new process groups, fresh parent for each variant | Subsequent Node version queries completed in **15 / 16 / 15 ms** respectively. These queries do not exercise real repository mutations. | `macos-node20-spawn-sequence-{true-detached,git-attached,git-detached}-1.log` |
| Import fixture modules without invoking them; pure crypto; ordinary file operations; WikiProof alone; native file/directory synchronization alone | Version queries completed in **16 / 17 / 16 / 21 / 19 ms** respectively. Each control has its own synthetic script; no real accounts, keys or services were used. | `macos-node20-{imports-only,pure-crypto,pure-files}-3.log`, `macos-node20-{proof-only,pure-fsync}-4.log` |

A separate instrumented two-fixture run probed after each returned `initialize`,
`capture` and `wikiIngest` call. Its **12** launches completed in **191–459 ms**:
`macos-node20-fixture-phases-1.log`. Only that diagnostic process temporarily
wrapped the three prototype methods, restoring them in `finally`; tracked source
and original tests were unchanged. The extra launches changed timing, so this
cannot establish that the uninstrumented failing sequence is healthy.

## One finite-delay observation, not a longer acceptance deadline

The separate timeline script observed a version-only child for up to 30 seconds
solely to distinguish finite delay from an indefinite wait. At **10003 ms** the
command was still incomplete, so the original ten-second observation still failed.
That particular command later completed at **10870 ms**. No original deadline
was increased and no extended observation was used as a passing gate.

Parent **26315** returned from spawning child **32971** in **1 ms**. A native
parent sample showed its event loop polling and processing timers, while the
same child was reported unstarted/suspended by `vmmap`. This rules out a long
synchronous spawn call in this particular observation. Sampling itself can affect
timing; the 10870 ms result does not predict an unobserved run or establish the
suspension's source. No automatic resume or scheduling change was added.

Evidence: `.scratch/macos-node20-timeline-{tests-1.log,observations-1.json,parent.sample.txt,child-vmmap-1.log}`.

## Official executable comparison and available inspection

The existing cached executable was compared with the binary extracted from the
official same-version archive. The archive matched the
[published SHA-256](https://nodejs.org/dist/v20.0.0/SHASUMS256.txt):
`ee27eea6694a5d8c834b11a12fb85a5dae01a91178be12920a6da12d8c299c43`.
Both **92,646,720-byte** binaries have identical SHA-256
`ddd82d5e23efa1ac08ecae9c6abd7b4459da903d1946b9c9a2568df010a9f534`;
the separate official copy reports `v20.0.0`. This eliminates a byte difference
from that published archive, not every filesystem, OS or launch-policy effect.
It is not a fresh signature-chain/notarization verdict.

Only the named binary was extracted into `.scratch/`; nothing was installed,
replaced or upgraded. No signature/xattr or host security setting was changed.
Result: `.scratch/node20-official-comparison-2026-10-30.json`.

A plain-user trace attempt targeting only a new version-query command failed
with **“DTrace requires additional privileges”**. Its output also notes enabled
system integrity protection. No administrator identity, privilege workaround or
security change was attempted. This is an OS inspection limit, not an automatic
approval-review rejection. Log:
`.scratch/macos-node20-native-trace-access-2026-10-30.log`.

The connected REA tool was also checked for an existing alternative. Its
`list_frida_devices` call returned `capability_unavailable` / `unsupported_provider`:
the installed Frida native binding could not be located. No process was attached,
spawned or modified through REA. No provider/dependency installation, repair or
configuration change was attempted. The tool's JSON error text is retained in
`.scratch/macos-node20-rea-capability-2026-10-30.json`, separately from the already
frozen 66-file inventory. This establishes that this advertised backend is
unavailable, not that every possible native debugger is unavailable everywhere.
The retained error text has SHA-256
`f6dbdd0aa74be78081b4d2e90aae9c90ee7bc5e2855c47159801b2de24c6bc75`.

## Existing LLDB provides a local continuation path

The existing LLDB was then checked separately, with user initialization files
disabled and address randomization retained for the launched target. It could
both launch the same Node 20 binary for a version query and attach to an ordinary
synthetic Node process **13452**, read its stack and detach. The target's unique
marker and executable were checked before attaching; it was terminated after
detachment. No other application was attached and no software was installed.
Thus the DTrace/Frida limitations do not require stopping local investigation.

Two native capture attempts used temporary debugger breakpoints in an owned
diagnostic process. Both recorded version-query spawn flags **16396 / 0x400c**.
They ran the SDK prefix directly under LLDB, not the original `--test` collection;
debugger effects and timing prevent treating either as runtime acceptance.
No argument, return value or on-disk executable was changed. Breakpoints do
temporarily affect the diagnostic target's instruction memory and timing.

The first attempt stopped on a diagnostic callback `KeyError` before completing
the requested capture. The second let the target finish, with its version probe
reporting **757 ms**, but stepping out ran past process exit. Its later JSON
`pid:null` / `returnCode:0` is **not a valid observed native return value** and
must not be used as such. The batch then exited 1 on an invalid `continue`.
Both incomplete attempts remain retained, not relabeled as successful traces.

All **nine** LLDB capability/source/log/result artifacts are frozen separately in
`.scratch/macos-node20-lldb-inventory-2026-10-30.json`, SHA-256
`129461577346ed66ab7ba6e78d2901b5c1cb53d202fe889dc8aabd72edd1e612`.
A final scoped process listing found no remaining matching diagnostic process.
This adds an available next observation method, not a project fix.

## Independent review of the preceding record

Committed candidate `95bc5d6d48cc8797de7119f86e72a3362f7b056d` received independent
read-only Agent review: the native reviewer covered the follow-up **1/1**, and the
scope reviewer covered all three changed documents **3/3**, each zero skipped.
They checked the old/new frozen hashes, official-byte comparison and complete
failures, and confirmed no new P1/P2 in those scopes. Those reviews apply to that
exact candidate, not subsequent LLDB additions. OCR excluded Markdown; the
Agents explicitly reviewed the documents. Neither review accepted the failed gate.

## Retained scope and next step

All **66** new source/log/result/archive/binary artifacts are frozen in
`.scratch/macos-node20-diagnosis-inventory-4.json`, SHA-256
`1cd2e3adc89fc94d0a16a234566b6bb76e77bf230b4d51f43f438ea1f7b501f0`.
The earlier **26 + 27 + 12** hashes remain unchanged. Artifact counts are not test
counts. The runtime, tests, dependencies and configuration are unchanged from
`e44c096e`; these new records cannot justify a project implementation change.

| Source branch | Remaining condition | Required next evidence |
| --- | --- | --- |
| `kevin/knowledge-expansion` | The same complete minimum-runtime failure persisted through the prior investigation, scoped audit and these four unchanged reruns. Available local isolations have not identified a safe project correction. Another Mac is unavailable; DTrace/Frida have the specific limits above. Existing LLDB launch and attach are available, so local investigation can continue. | Apply the verified LLDB capability to the actual SDK/test-worker reproduction with explicit debugger/timing limits; identify the trigger and any project correction supported by evidence. Another Mac remains an optional comparison. Then pass both unchanged complete collections under both real Git defaults and perform final acceptance review. |

The observed delay is not attributed to Node, the SDK, macOS, security software
or MemoBranch as a proven root cause. More passing subsets, changing minimum
versions, moving tests into separate files, or extending the original deadline
would not close this requirement. Batches 4–6 and the whole goal remain unaccepted.
Windows execution is still skipped by request, not passed. The existing Linux,
Node 22, installed-package and source-review results retain their recorded scope.

Database changes: none. Data migration: none. Persistent configuration changes:
none. No push, npm publication, deployment, real account, grant or service change.

The later [actual-worker observation](macos-process-entry-observation-2026-10-30.md)
uses a validated preloaded native monitor. Its nine pre-attach samples report
`suspendCount:0`, despite the earlier tool's “unstarted/suspended” wording.
The first preloaded debugger attempt did not finish within six seconds. A later
30-second diagnostic bound did capture the actual child at `_dyld_start + 0`
with pending `SIGTERM`, then detach. Original test bounds are unchanged and the
instrumented results still do not accept the original gate. A same-byte official
copy also fails the complete current 38-case collection under actual `main`.
