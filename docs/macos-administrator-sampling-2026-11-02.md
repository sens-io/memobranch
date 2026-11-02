# Authorized macOS sampling: control and prepared failure capture

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Starting documentation candidate: `88553c665276380d58829783d2ef0d21aa77771a`.
Runtime remains `e44c096e4479f465f16e61ccd5d47d1243023a41`.
The [complete post-restart failures](macos-postrestart-verification-2026-11-02.md)
remain open. **This is diagnostic evidence, not a product correction or acceptance.**

## Exact authority and first actual result

The user explicitly authorized **at most two one-second system samples**, limited
to this project's newly created Node 20 test processes: first the synthetic
capability control, then, if useful, one reproduced failing child. Reports stay
in the local project. This is not general administrator authority or permission
for a third sample, host-policy changes, publication, pushing or deployment.

The first approved invocation used the already reviewed administrator-control
v2 source, SHA-256
`f95e27d2cc5147ff679f87dc67dab206b2291c36968bb39fab6ff2783c9579be`.
The ordinary-user controller created target **31700**, parent **31699**, verified
its identity, and used the native macOS administrator dialog. The command checked
the same complete identity after authorization before invoking the fixed
`spindump` command. Its client exited **0**, and the readable report is **58,725
bytes**. Both owned target and client reached recorded terminal states.

The actual report names PID **31700**, the original Node 20 executable, UID **501**,
and only **one Process section**. It records **1.00 seconds**, **100 samples at
10 ms**, and **7 threads**. User and kernel frames are present; some kernel frames
are unresolved offsets. This demonstrates that the approved tool can collect this
synthetic owned process. It does not establish that the failing startup can be
sampled or explain its cause.

Raw report, target/client logs and observations are preserved in
`.scratch/macos-owned-spindump-admin-control-ff7965a9-1d1b-404f-9d8e-1dae64edfb1e/`.
**One authorized sample has completed; one remains available.**

## Prepared second operation, still unexecuted at this checkpoint

At candidate `180397b`, the remaining operation was prepared in three ignored files:

- `.scratch/macos-spindump-failure-capture-v4-2026-11-02.mjs` — ordinary-user controller.
- `.scratch/macos-spindump-request-v2-2026-11-02.mjs` — fixed system command builder.
- `.scratch/macos-node20-spindump-hook-2026-11-02.cjs` — records actual selected CLI children through the original `execFile` implementations.

The controller checks the original Node bytes, retained 763 source/build hashes
and permitted temporary directory. It runs the original complete **19-case** file
with unchanged assertions/deadlines, using a diagnostic preload. This remains a
diagnostic run and cannot replace the uninstrumented complete 38/37-case gates.

The actual runner/worker relationship is established first. The system dialog
and root command can then start before the short-lived target exists. A private
FIFO carries only a PID and complete process-identity line once a fresh recorded
CLI prepare/apply child still has one thread, less than 1 MiB resident and zero
Unix/Mach calls at a sample at least 1500 ms after spawning. The controller checks
its owner, direct parent, executable and birth time. It submits at most one request.
No assertion or ten-second original waiter clock is paused or extended.

The command runs fixed system Bash with a clean environment, avoiding inherited
`BASH_ENV`. It rechecks the exact worker identity after native authorization, uses
a bounded **120-second** FIFO read and a five-second identity-line read, and checks
the worker again after receiving the request. Payload fields are treated as data,
not evaluated as commands. It requires the same ordinary user, actual test worker
as direct parent, original Node executable and unchanged full target identity.
It rejects the runner/worker themselves, existing output and a final symlink,
closes the FIFO descriptor, and invokes only this single profiling operation:

```text
/usr/sbin/spindump <verified-owned-child-pid> 1 10 -onlyTarget -timeline -noBinary -timelimit 8 -o <private-project-report>
```

The source has no retry or additional sampler invocation. The controller checks
the returned report's PID against the selected child. A missing target, cancelled
dialog, absent eligible child or nonzero result is recorded, not turned into a
passing capture. Native dialog/root-command cancellation remains unverified;
ordinary-user stop checks below do not prove that stronger boundary. Sampling
and preloading can change timing, and no root cause or correction follows merely
from a successful capture.

## Ordinary-user checks and retained failed drafts

The default plan mode makes no administrator request. In the v4 guard control,
a real owned worker was established but the supplied supposed child was the
controller itself; the normal-user shell exited **65** before reaching the
sampler. No report was created. An explicit interrupt control exited **130** and
recorded terminal states for both ordinary-user processes. AppleScript was
compiled for syntax only, without execution or an administrator dialog.

Earlier v2 interruption cleanup raised **EPERM** while sending a group signal,
and exited before saving a complete observation file. A scoped read afterward
found no matching owned controls live; that failed attempt is not a pass. v3
contained a generated-source syntax error and never entered its program body.
Both drafts and the incomplete directory remain retained.

v4 avoids signalling a child whose exit/signal status is already known and
records unconfirmed signal errors rather than letting them abort final recording.
It still waits for actual close results; an EPERM alone is never treated as proof
of termination. Its interrupt check also observed an EPERM followed by actual
terminal results. The reason for that EPERM is not established by the record.

v4 guard and interrupt folders respectively:
`.scratch/macos-owned-spindump-failure-79991c1b-c9ad-4383-afab-aac9f26e06ad/` and
`.scratch/macos-owned-spindump-failure-84f1de27-8e43-41f9-af7c-84aa152d95ac/`.
These verify diagnostic safety paths, not library functionality or privileged
cancellation. No second administrator operation was run during these checks.

## Review correction: keep the ordinary process group owned after command exit

Independent review of fixed candidate `180397b658c857f80ff72043da937b9ededc0320`
covered all **3/3** document diffs for scope and this complete new report **1/1**
plus its designated sources for native safety; neither skipped a file. Both
verified all 29 regular artifacts and their bytes, without reading FIFO contents.
The native review identified a P2 in v4's cleanup. The scope review also found
an older audit paragraph needed a historical qualification; that text is corrected.

| Source branch | Confirmed diagnostic issue | Correction / current verification |
| --- | --- | --- |
| `kevin/knowledge-expansion` | v4 `stop()` skipped a process group once its command leader had exited. A still-live descendant could retain the output pipe, while cleanup then waited forever for close. | A separate ordinary Node 22 guard now remains the live group leader until cleanup. Command completion and guard/pipe completion are distinct; group signalling remains owned even after the command exits. The fixed descendant control is described below; independent re-review remains required before the second sample. |

The active controller is now
`.scratch/macos-spindump-failure-capture-v6-2026-11-02.mjs`, using
`.scratch/macos-owned-group-controller-v2-2026-11-02.mjs` and
`.scratch/macos-owned-group-guard-2026-11-02.mjs`. The fixed system command builder
and CLI-observation hook remain unchanged. The extra ordinary guard is part of
the diagnostic process tree, not a production change or an uninstrumented gate.

The guard uses a private parent IPC channel, removes its transport variables from
the actual command's environment, and does not exit merely because that command
exits. Parent disconnection terminates its owned ordinary group; cleanup signals
that group while the guard still reserves its identity. An unexpected lost guard
or unconfirmed pipe close is recorded as uncertainty; the controller does not
blindly signal a potentially reused group or wait indefinitely for that close.
This does not establish cancellation of native administrator/root processes.

Fresh v6 ordinary-user results are machine-recorded in
`.scratch/macos-spindump-group-controls-2026-11-02.json`: plan **0**, wrong-child
guard **0** with inner shell **65**, interrupt **130**, descendant control **0**.
The interrupt observations themselves record interruption and actual process
ends; the external control record separately saves the outer exit code. The
earlier v4 outer 130 was observed in the parent tool result, not its private JSON.

In the required descendant boundary, command **64165** exited **0** while child
**64166** remained alive, held the output pipe and was verified in guard **64163**'s
group. Cleanup then ended the guard and the child's PID was confirmed missing.
Guard and interrupt checks also recorded the ordinary guards' terminal states,
without ownership loss. These are diagnostic regressions, not library acceptance.

The correction supplement contains **24 regular artifacts**, **46,477 bytes**, in
`.scratch/macos-group-correction-inventory-2026-11-02.json`, SHA-256
`b860493441c107d220e75461cc161413387e10e129b9e003074790a1a63b6df3`.
Six FIFO entries are metadata only, never content-read. All earlier 29 artifact
hashes still match. No matching ordinary group guard remained live at the check.
The active controller / group-controller / guard SHA-256 values are:
`50c1b706ad92c330c90ec0722fa7bbbf90972dcac26fef53a91907e490c5a528`,
`ce13cae5eb36fdf6f22149d6f76b9ac5eaa07e816ba289940d360cc6363d5013`,
`cbccd2d19cbb9131faec7a17c63bb388ef201e659e05d46a3524a1d0baf5e8e4`.
The authorized count remains **1 used, 1 remaining**; the second operation is
still unexecuted at this correction checkpoint.

## Frozen evidence and remaining acceptance

The **29 regular artifacts**, **130,003 bytes**, are frozen in
`.scratch/macos-authorized-sampling-inventory-stage1-2026-11-02.json`, SHA-256
`e9f0838912e5b4c53bb3e1848063d5775c0dbfc86cd1db04779600c325d49bda`.
Five transient FIFO entries are listed separately with type/mode/owner metadata;
their contents were not read or content-hashed. Artifact totals are not tests.
The preceding 27 artifacts, original Node and all 763 inputs were reverified
unchanged. A scoped read found no matching ordinary-user controls left running.

At candidate `180397b`, the initial controller, builder and hook SHA-256 values were:
`193b03e8247afc67f9fbe43c5495fd5673f8bfb9510187a9bc6eee4112a62629`,
`cb6881d414d2cca3a5e4176170cb4275302ccbef22a0b4686ce2e9b1a1153702`,
`64ea6d78fcb1ffb4fe71c4a32ccbd5fde700a5f9066171411f1b0c7a61637c89`.

| Source branch | Confirmed remaining issue | Next operation |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Complete minimum-runtime failures remain unexplained and uncorrected; batch 4–6 and combined OpenSpec acceptance remain open. | Independently review the fixed second-operation sources, then use at most the single remaining authorized sample. Keep any diagnostic result separate from unchanged complete acceptance gates. |

Actual Windows execution remains skipped by request. Database changes: none.
Data migration: none. Persistent configuration changes: none. One specifically
authorized administrator sample was performed; no host security-policy change,
tracked runtime/test/dependency change, push, publication, deployment, account,
service or grant change occurred. Passwords were handled only by the native OS
dialog, not this program.
