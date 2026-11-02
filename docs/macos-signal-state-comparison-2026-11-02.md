# macOS Node 20 signal and process-state observations

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Runtime candidate: `e44c096e4479f465f16e61ccd5d47d1243023a41`.
Starting documentation candidate: `bb1e1a9cd87ecd28a334a88af0b743d970923009`.
This follows the [same-day launch comparison](macos-launch-context-comparison-2026-11-02.md).
**The application-launched failure remains open. No product correction, batch
acceptance or whole-roadmap completion is claimed.** The user has no second Mac
available; that is not a waiver of the existing macOS requirements. Actual Windows
execution remains skipped by the user's separate explicit request.

## Unchanged inputs and diagnostic boundary

The original Node **20.0.0** executable still has SHA-256
`ddd82d5e23efa1ac08ecae9c6abd7b4459da903d1946b9c9a2568df010a9f534`.
All **763** retained input/build hashes were checked before both observed runs and
again during analysis. Original source, compiled tests, assertions, selection
within the complete 19-case file, ten-second waiter bounds and skip conditions
were unchanged. Node **22.17.0** drives the commands; Node 20 runs the tests.
The new diagnostic runs only that original complete single file, under an actual
implicit Git **`main`**. It does not replace either original complete collection
or supply a new `master` result.

An ignored preload records selected `execFile` calls while delegating to Node's
original callback or custom promise implementation. It preserves the returned
child/promise and passes through arguments unchanged. A separate smoke check
confirmed callback output, the custom promise's child reference and an actual
exit-7 rejection. That smoke did not exercise the selected Wiki capture branch;
the two real 19-case runs below did, 24 calls each. The preload is supplied with
`--require`, not `NODE_OPTIONS`; the selected CLI children are not preloaded.

The native helper uses the existing compiler and installed headers, targeting
Node-API **8**, which this Node 20 executable supports. It reads the calling
process's current-thread signal mask, signal dispositions/flags, requested QoS,
nice value, task category and descriptors 0–2. It does not install handlers,
change masks/priorities, send signals, resume children or modify launch options.
The version used in the actual observation preserves the caller's `errno`.
Loading a native addon and recording JSON can still affect timing and memory;
these are diagnostic results, not uninstrumented acceptance runs.

## Initial controls and actual original-file results

Two fresh initial diagnostic-worker comparisons found no difference in the
reported user limits or visible signal/process handles. The later initial control
also compared 11 native signal dispositions/current-thread masks and the other
listed native fields, before and after the filtered process-report call; no
measured difference was found. Those initial controls do not describe later SDK
activity, and their TAP 1/1 results are not feature acceptance checks.

The original-file pair then captured the state before and after **24** actual
selected CLI spawns, including the CLI prepare cancellation case after the
preceding SDK/Harness operations. Each origin has **52 JSONL rows**: two preload
entries, 48 before/after entries, and two exits. Both recorded exits report no
probe error. Parent/worker identification uses the recorded PID relationship;
the runner and worker share an argument label, so that label alone is insufficient.

| Recorded launch origin | Actual Git default | Original single file | Failed | Cancelled / skipped | Command exit |
| --- | --- | --- | --- | --- | --- |
| Application: Node 22 → Bash → bundled Codex → ChatGPT.app | `main` | **18/19** | Case 14, CLI import-prepare waiter observation | 0 / 0 | 1 |
| System Terminal: Node 22 → login shell → login → Terminal.app | `main` | **19/19** | None | 0 / 0 | 0 |

Application prefix:
`.scratch/macos-node20-signal-run-a790942e-622b-4dad-b23c-668c15c61f91`.
Terminal prefix:
`.scratch/macos-node20-signal-run-efd14c85-4132-4f1c-8d96-8d3b1e5367d8`.
Each has `.jsonl`, `-main-original19.log` and `-results.json` files.
Origin records are `.scratch/macos-signal-launch-a600a19d-a962-444e-bd4e-cdd06c2f6edb.json`
and `.scratch/macos-signal-launch-067a4d0c-b55c-41ec-9b11-5e1422670d4b.json`.

The failing case again reports child code `null`, `SIGTERM`, empty stderr. Its
worker is **81533**, and selected call 21 returned actual CLI child **11467**.
The corresponding successful Terminal worker is **17472**, child **43115**.
These child identities come from the actual returned `ChildProcess` objects,
rather than inference from generic system-log PID text.

## Measured states matched; cause remains undetermined

Comparing matched trace positions, excluding timestamps and process identities,
found **zero differences** in the measured native fields and capture metadata.
All 29 catchable BSD signal classifications, flags and current-main-thread mask
bits matched, including the before/after states of the failed prepare spawn.
Measured requested QoS, nice value, task category and descriptor flags/types/TTY
state also matched. This rules out a difference in those observations for this
pair; it does not establish that all process state or launch conditions matched.

In particular, `caught` does not identify the handler function or JavaScript
listener. The helper does not read each handler's `sa_mask`, all other threads'
masks, every inherited descriptor, effective scheduler overrides, application
policy, full environment or the kernel wait reason. `qos_class_self()` is the
requested class, not proof of every effective scheduling decision.

Read-only system-log queries were restricted to `kernel`, each actual CLI PID,
and its bounded local-time window: **13:05:35–13:05:48** for 11467 and
**13:12:16–13:12:22** for 43115. Both queries ended 0, with empty stderr. Each
contains one message notifying `syspolicyd` about this exact executable and PID.
Thus this notification occurs for both the failing and passing child. These
PID-filtered queries are not the full security decision or proof of a denial,
and do not identify the source of the delay. The earlier generic policy warnings
also occurred during passing runs; neither observation supports changing host
security settings or treating them as the established cause.

## Retained evidence and remaining work

The corrected analysis is
`.scratch/analyze-macos-node20-signals-v2-2026-11-02.mjs`; output is
`.scratch/macos-node20-signal-comparison-2026-11-02.json`.
The first analyzer stopped at an assertion before producing output because it
selected the runner by the shared argument label. That draft is retained;
the corrected analyzer validates the parent/worker relationship and both results.
All helper versions are retained, including versions compiled but not used in the
real observation. Artifact counts are not counts of distinct tests or executed
diagnostic versions.

The **50-artifact**, **563,661-byte** supplement is frozen in
`.scratch/macos-node20-signal-inventory-2026-11-02.json`, SHA-256
`3b1d7bf8051c59c90c2b5a0f6c97a4d3d4c524003718a5f35e67ab224911842d`.
A scoped process check found no remaining matching owned signal driver or
retained compiled test command. Earlier inventories and the full Terminal matrix
retain their own recorded scope; this supplement does not replace them.

| Source branch | Confirmed remaining issue | Acceptance status |
| --- | --- | --- |
| `kevin/knowledge-expansion` | The application-launched minimum-runtime waiter failure still reproduces. No supported product correction or complete explanation has been identified. | Keep batch 4–6 and combined OpenSpec acceptance open; retain the complete original collections under both actual defaults and review the final corrected candidate. |

Database changes: none. Data migration: none. Persistent configuration changes:
none. There is no tracked runtime/test/dependency change, push, npm publication,
deployment, real account, service, grant or host security change in this work.
