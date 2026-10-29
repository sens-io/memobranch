# macOS minimum-runtime cancellation investigation

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
19-case file: all three real calls cancelled, retried and disposed; the next CLI
prepare then had **`waiter:false`, no completed entry record and SIGTERM after
10052 ms**. The other three CLI observations succeeded. Log:
`macos-node20-sdk-standalone-prefix-1.log`. Its outer TAP **1/1** is explicitly
**not a successful cancellation gate**: the diagnostic script records this
failed flow without failing the whole file. Parent RSS after the three calls
was approximately 117/123/128 MB; that alone does not establish or exclude a
resource explanation.

A control performing only three rounds of the existing helper's environment
save/restore, without SDK execution, observed four healthy CLI flows:
`macos-node20-env-roundtrip-1.log`. Thus environment rewriting alone is not a
sufficient reproduced cause. Neither is a single SDK cancellation, the test
marker alone, basic lock ownership alone, or the executable's original path.
The observations do not rule out interactions between those factors.

## Remaining issue

| Source branch | Confirmed observation | Required next evidence |
| --- | --- | --- |
| `kevin/knowledge-expansion` | The macOS Node 20 minimum-runtime complete protocol gate still fails. Repeated Harness cancellation/retry followed by CLI source waiting reproduces a launch-stage symptom; individual operations also have positive controls. | Identify the retained SDK/operation/process state, correct any confirmed defect, and rerun the entire unchanged protocol collections under both real Git defaults. Do not close this with a filtered run, longer deadline, different version/OS, or test-file isolation that merely hides the interaction. |

No new product correction is claimed by this investigation. The existing Windows
ownership repair, Node 22 full checks, package consumers and historical Linux
checks retain their previously documented scopes. Database changes: none. Data
migration: none. Configuration changes: none. No host upgrade or real service
change. Independent review of this committed investigation remains required.
