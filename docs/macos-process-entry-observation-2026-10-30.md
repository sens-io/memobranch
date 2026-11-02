# macOS process-entry observation

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Product/runtime candidate: `e44c096e4479f465f16e61ccd5d47d1243023a41`.
Starting documentation candidate: `e8ea976e6bbc067ff6cafe0bd0dd1c234ef0421e`.
This continues the [minimum-runtime follow-up](macos-minimum-runtime-followup-2026-10-30.md).
No product correction, original-test acceptance or batch acceptance is claimed.

## Read-only monitor, validated before the target run

The previous short-lived inspection helpers themselves produced no output before
their diagnostic deadlines. That does not identify which operation, if any, they
reached. A new helper was therefore started **before** the original test worker.
It reads process information for Node 20 descendants of that specific owned test
runner, checking the executable, user and parent. It does not signal, resume or
write memory in its target. The helper's own shutdown is separate.

The first monitor incorrectly divided `proc_listchildpids`' return value by
`sizeof(pid_t)` a second time and missed the child. Apple's
[implementation](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c)
returns a PID count from that wrapper. The corrected diagnostic uses that count
directly, with fixed array bounds. This changes only ignored diagnostic files.

Before running the original test again, a separate owned ordinary Node 20
parent/child control validated the corrected enumeration and native reads.
Child **91387**, parent **91386**, had **7 threads**, **38,780,928 bytes** resident,
484 Unix calls, 130 Mach calls, and `suspendCount:0`. Native task reads succeeded.
Both synthetic processes were terminated after the control. The control is not
an acceptance test for Wiki operations.

Control sources/logs under `.scratch/`:
`macos_owned_task_monitor6.c`, `macos_owned_task_snapshot2.c`,
`macos-task-monitor-control-6.mjs` and `macos-task-monitor-control-6.log`.

## Actual original worker, before debugger attachment

The original compiled **19-case** `wiki-import-adapters` file was run without
changing its assertions, selection, ten-second waiter bound or platform skips.
The observer activates only after the preceding Harness integration-cancellation
case finishes, then stops selecting children when the CLI prepare-cancellation
case finishes. The source test and product implementation remain unchanged.

In monitor run **6**, child **21466**, parent **91436**, was observed about
**92 ms** after its recorded native start time: 32,768 resident bytes, one waiting
thread, zero Unix/Mach calls and `suspendCount:0`. This early single sample alone
does not prove how long that state lasted. The complete file then reported
**17 passed / 19**, the same two CLI cancellation cases failed, exit 1.
No debugger was used in this run.

In run **7**, the debugger was already started in its own terminal before the
tests began. Before any attach request, **nine** snapshots of child **56427**,
parent **26527**, spanned **1606 ms**. Every sample reported:

- 32,768 resident bytes and one waiting thread;
- zero Unix and Mach calls;
- successful task-name/basic-info reads and **`suspendCount:0`**.

These direct reads distinguish the observation from a positive task suspension
count. Earlier `vmmap` wording such as “unstarted/suspended” is retained as that
tool's output; it is not proof of `task_suspend` or a spawn-suspended flag. The
samples do not establish the kernel wait reason, its cause, or a project fix.
They also do not describe an arbitrary later point in the child's lifetime.

Logs/results under `.scratch/`:
`macos-node20-preloaded-{6,7}-{monitor.log,tests.log,observations.json}`.
The observer sources are `macos-node20-preloaded-observe-{6,7}.mjs`.

## Preloaded debugger still did not provide the requested stack

LLDB's readiness was verified in a terminal before the original worker started.
After those nine snapshots, the observer requested attachment to the validated
owned child **56427**. The debugger log contains the request and queued commands,
but **no successful attachment, stack, image list or completed detach**. After
**6033 ms**, the controller sent its diagnostic termination signal to the debugger
group. This bounded timeout does not prove attachment can never succeed.

The affected CLI prepare case later failed with child code **5**, `LOCK_TIMEOUT`,
after approximately **28.1 seconds**. The next apply case passed; the file reported
**18 passed / 19**, exit 1. Attaching a debugger can change scheduling and signal
handling, so neither that changed failure nor the extra passing case is an
uninstrumented correction or acceptance result. No original deadline was extended.

Sources/log: `.scratch/macos-lldb-pty-bridge7.py`,
`.scratch/macos-node20-preloaded-observe-7.mjs`, and
`.scratch/macos-node20-preloaded-7-lldb.log`.

## Longer debugger observation captured the actual child's first instruction

Run **8** changes only the debugger's diagnostic observation bound from 6 to
30 seconds. Original tests and their waiter deadlines remain unchanged. Nine
pre-attach samples of owned child **38901**, parent **9231**, again span **1607 ms**
with the same 32,768-byte, one-thread, zero-call and zero-suspension-count values.

This time LLDB did attach, read the stack/program counter and image list, detach,
and exit 0. Its stack has one frame, **`dyld` / `_dyld_start + 0`**, and the program
counter is **`0x000000010a5707c0`**. The displayed first instruction is `mov x0, sp`.
The observed stop reason is **`SIGTERM`**, the signal the original test sends
after failing to observe the waiter. The child had not yet reached Node/project
JavaScript at this captured stop. The debugger itself affects stop/signal handling;
this does not establish the cause of the preceding delay or reproduce an
uninstrumented kernel stack. Listed shared-cache images do not by themselves
prove that those frameworks ran in the child.

There is no per-output timestamp for attachment completion, so no exact attach
latency is claimed. There is no debugger-time-limit record in this run.
The prepare case subsequently failed with `LOCK_TIMEOUT` after about **31.0 s**;
the file again reported **18 passed / 19**, exit 1. This remains a diagnostic
failure, not an improved acceptance result. The raw signal/stop evidence must not
be replaced with a claim that the uninstrumented child timed out in project code.

Evidence: `.scratch/macos-node20-preloaded-8-{lldb.log,monitor.log,tests.log,observations.json}`
and `.scratch/macos-node20-preloaded-observe-8.mjs`.

## Incomplete attempts remain retained

| Source branch | Attempt | Limitation / actual result |
| --- | --- | --- |
| `kevin/knowledge-expansion` | `real-cli` 1 | Short helpers timed out; selection was not yet restricted to the target test window. Complete file 17/19, no valid target capture. |
| `kevin/knowledge-expansion` | `real-cli` 2 | Same selection defect; a vanished child caused a driver exception and owned-run cleanup. Only a TAP header remains, no complete-file result. |
| `kevin/knowledge-expansion` | `real-cli` 3 | Corrected target window and caught vanished-child errors. Helper/attach attempts timed out. The user requested a pause; owned processes were stopped. Log stops after case 13, so no complete-file result is claimed. |
| `kevin/knowledge-expansion` | `preloaded` 4 | LLDB readiness was awaited through ordinary pipes; no marker arrived before the diagnostic timeout. Tests never started. |
| `kevin/knowledge-expansion` | `preloaded` 5 | Incorrect PID-count division prevented observation. Complete file 17/19, no native capture. |

The corrected terminal bridge used in run 7 resolves the readiness observation
problem in attempt 4. It does not resolve attachment to the delayed real child.
Failed source/log/result files were not overwritten.

## Official same-version executable: unchanged complete failure

The official Node **20.0.0** copy from the earlier verified archive was then used
for the complete current **38-case** collection, with no native sampling or
debugger running. An actual implicit Git initialization verified **`main`** using
subprocess-only configuration. The host's global Git configuration was unchanged.

The copy's SHA-256 still matched the original cached executable:
`ddd82d5e23efa1ac08ecae9c6abd7b4459da903d1946b9c9a2568df010a9f534`.
It was executed from `.scratch/node20-official-2026-10-30/node`; no executable was
installed, replaced, re-signed or otherwise modified.

The collection reported **36 passed / 38**, two failed, zero cancelled/skipped,
exit **1**. Both actual CLI `import-prepare` and `import-apply` waiter observations
again failed, child code `null`, `SIGTERM`, empty stderr. Changing to this separate
official copy did not remove the failure. This does not rule out every possible
filesystem, OS or launch-policy effect, and is not a root-cause finding.
Only this complete current collection / `main` combination was run with that copy;
the original-path results under both defaults remain the earlier separate runs.

Evidence under `.scratch/`:
`macos-node20-official-current-main-1.mjs`,
`macos-node20-official-current-main-1.log`,
`macos-node20-official-current-main-1-driver.log`, and
`macos-node20-official-current-main-1-result.json`.

## Prepared comparison outside the current application

A local diagnostic driver is ready at
`.scratch/macos-node20-terminal-comparison-2.mjs`. It uses the same original
Node 20 binary and unchanged compiled collections, verifies the fixed inventory
and all **763** input/build hashes first, probes both actual Git defaults using
subprocess-only configuration, and runs the complete current/original collections
serially. Each invocation writes new uniquely named driver logs under `.scratch/`.
Some original tests also use the existing system temporary directory. That
directory is within this task's explicitly permitted temporary roots; neither
the driver nor the wrapper changes `TMPDIR`. Thus “only writes `.scratch`” was
too broad a description and has been corrected without changing test behavior.
It does not install anything, change tests, write canonical project knowledge,
change global configuration, push or publish. This is a diagnostic comparison,
not a newly added acceptance gate or proof that the application caused the delay.

The initial draft misread inventory paths and failed before launching tests.
That draft and failed control log remain retained. The corrected driver uses
the inventory's project-relative paths. Its preflight and actual first-collection
interrupt control passed: after `SIGINT`, the driver exited **130**, stopped its
owned collection, and did not start any later collection. That deliberately
interrupted run is not acceptance. Sources/results:
`macos-terminal-script-interrupt-control-{1,2}.mjs`, their logs, and
`macos-terminal-script-interrupt-control-2-result.json` under `.scratch/`.

Independent review found that inaccurate directory description after a Terminal
draft was started. The exact owned driver **52851** was stopped using `SIGINT`;
its record is `.scratch/macos-terminal-draft-stop-2026-10-30.json`. That interrupted
draft is not a completed outside-application result or acceptance.

A guarded Terminal wrapper is now prepared. Before importing the driver,
`.scratch/macos-terminal-temp-guard-2.mjs` first selects the same project directory
as the driver, then resolves the existing temporary directory
and refuses unless its real path is exactly `/private/tmp` or this task's
explicitly writable per-user temporary root. It records only its own ancestor
process paths and that directory, with new files under `.scratch/`. It makes no
environment, permission or security-setting change. The new `.command` wrapper
only selects the project directory and executes that guard using existing Node 22.
Existing Node 22 only drives the unchanged Node 20 test commands:

```sh
/Users/imac/.nvm/versions/node/v22.17.0/bin/node /Users/imac/code/memobranch/.scratch/macos-terminal-temp-guard-2.mjs
```

## Acceptance remains open

The initial **72** diagnostic/control/source/result artifacts are frozen in
`.scratch/macos-process-entry-inventory-2026-10-30.json`, SHA-256
`caf5cbbc2b1b349807bd96565aeda47ba0cf88d2fbdeae5d9aa9275e49d8cde9`.
The prior four diagnosis inventories and nine-file LLDB inventory were rechecked
without changing their files or hashes. All **763** earlier input/build snapshot
hashes also still match. These file counts are not acceptance-test counts.

The November 2 correction has a separate **12-artifact** inventory at
`.scratch/macos-terminal-guard-inventory-2026-11-02.json`, SHA-256
`5a1fdf5fd5dbdfb416a24ee5b9cc4b5ad46d424542c6d62f51a8e3b34fa5637b`.
It retains the stopped Terminal draft, both guard versions and the exact wrappers.
The initial inventory was not rewritten.

Independent read-only review covered the `26367a23` candidate in full (3/3
documentation files, zero skipped), with a separate native-evidence review of
the new report and all 72 hashes. That native review found the inaccurate
temporary-directory description. Follow-up review found a second boundary:
the guard and driver could resolve a relative `TMPDIR` from different current
directories. Guard version 2 now selects the project directory before validation;
neither version changes `TMPDIR`. Actual rejection controls for an unlisted
absolute directory and a relative directory from another working directory both
exited 1 without starting the driver or creating launch logs. The final read-only
correction review covered **12/12** files/records, zero skipped, and closed both
P2 findings without another confirmed P1/P2. This review accepts the correction
only; it does not accept the outstanding macOS or roadmap gates.

The scoped process check in
`.scratch/macos-process-entry-cleanup-2026-10-30.json` found no remaining matching
owned diagnostic/test processes or debuggers for the inspected targets. No live
job is left waiting for the external comparison.

The cause of the macOS minimum-runtime failure and any justified project
correction remain unknown. Batches 4–6 and the whole goal remain unaccepted.
Windows execution remains skipped by the user's request, not passed.
The earlier Linux, Node 22, package and review evidence retains its recorded scope.

Database changes: none. Data migration: none. Persistent configuration changes:
none. No product, original test, runtime/dependency or host security setting was
changed. No push, publication, deployment, account, grant or service change.
