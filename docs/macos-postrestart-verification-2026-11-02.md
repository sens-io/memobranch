# macOS verification after restarting the host application

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Starting documentation candidate: `a5f0196c3b067ac63aae43d3f253d1cb8c0d408d`.
Runtime candidate remains `e44c096e4479f465f16e61ccd5d47d1243023a41`.
**Restarting the application did not remove the known failure. No product
correction or final acceptance is claimed.** This follows the
[actual-child observations](macos-signal-state-comparison-2026-11-02.md).
This report records the state before administrator authorization. The user later
authorized two bounded samples; the [subsequent sampling record](macos-administrator-sampling-2026-11-02.md)
records the first actual control result and the remaining operation.

## Verified restart and unchanged complete collections

The user agreed to restart the current application, then requested continuation.
The recorded application process changed from **37322** to **22030**, started on
November 2 at **13:47:08 Asia/Shanghai** (**05:47:08 UTC**). The actual new chain
is Node 22 → Bash → bundled Codex CLI → `/Applications/ChatGPT.app`.
No origin was inferred from a log filename or terminal environment setting.

The existing reviewed driver/temporary-directory guard ran all four original
collections serially from this new application context, using the same original
Node **20.0.0** executable and all original assertions/deadlines/skip conditions.
It verified the same **763** source/build hashes first and probed each actual
implicit Git default through a real initialization. Global Git configuration
and `TMPDIR` were unchanged. Logs are in `.scratch/`; original tests also use
their existing explicitly permitted system temporary directory.

These were **uninstrumented test collections**: no diagnostic preload, native
addon, debugger or sampler was added. Node 22 only drove the commands. The current
six-file protocol collection has 38 cases; the retained original four-file
collection has 37. The collections overlap and are not distinct totals to sum.

| Actual default | Complete collection | Passed / total | Failed | Cancelled / skipped | Exit |
| --- | --- | --- | --- | --- | --- |
| `main` | Current | **37/38** | CLI prepare waiter observation | 0 / 0 | 1 |
| `main` | Retained original | **35/37** | CLI prepare/apply waiter observations | 0 / 0 | 1 |
| `master` | Current | **36/38** | CLI prepare/apply waiter observations | 0 / 0 | 1 |
| `master` | Retained original | **35/37** | CLI prepare/apply waiter observations | 0 / 0 | 1 |

Failures again report child code `null`, `SIGTERM`, empty stderr. No original
deadline was extended and no failing case was converted into a skip or retry.
Complete logs/results have prefix
`.scratch/macos-node20-terminal-bf6d383a-4696-47a0-a16c-c72f34ecdd9b`.
Despite the inherited filename, this run's actual origin is the application,
recorded in `.scratch/macos-terminal-launch-7fb4c70a-450e-422d-b42e-71a0fb874a51.json`.
The earlier successful real Terminal matrix remains a separate observation.

## Direct thread inspection did not provide child thread data

The installed public SDK exposes `THREAD_BASIC_INFO`, including a per-thread
suspension count. A new ignored Node-API diagnostic attempted that read using
existing permissions, with user/parent/executable/start-identity checks. It uses
the existing compiler and Node-API 8, preserves `errno`, and performs no thread
suspend/resume, memory write or permission-setting operation.

In the bounded owned-process capability control, self PID **17020** yielded
**11** thread records with successful basic/identifier reads. For its actual
synthetic direct child **17021**, `task_for_pid` returned generic failure **5**;
thread enumeration was therefore **not attempted**. The child was terminated
and the external controller ended 0 without its timeout. That outer exit only
means the observation completed, not that child inspection succeeded.

The empty thread array/count in that unavailable result is **not** a measurement
of zero threads or zero suspension. Nor does generic result 5 identify a specific
security policy. The actual failing CLI child's per-thread suspension remains
unmeasured. This does not negate the older available LLDB observations or claim
that every native debugger is unavailable.

Evidence is under `.scratch/macos-owned-thread-state-*2026-11-02.*`, including
source, binary, build log, control, driver terminal record and raw results.

## Ordinary-user system sampler requires administrator authority

The installed `spindump` manual documents `-onlyTarget` as sampling only the
target, and documents kernel/user stacks and timeline thread state. A separate
ordinary-user control invoked the installed tool for one **verified synthetic
owned Node 20 child**, PID **17546**, with one-second duration, 10 ms interval,
`-onlyTarget`, `-timeline`, `-noBinary`, eight-second tool limit and an explicit
private project output path. It exited **77** with the actual message:

> spindump must be run as root when sampling the live system

No stack report was produced; the owned target and sampler ended. This is an
observed tool requirement, not an automatic approval-review rejection or a reason
to waive the failed tests. No `sudo`, administrator dialog, privileged sampler,
new entitlement or host-policy change was used in this turn.

Source and raw observations are in `.scratch/macos-owned-spindump-control-2026-11-02.mjs`
and `.scratch/macos-owned-spindump-control-1b0347e8-3e17-49bb-b8f0-1e5a61ee5e44/`.

## Prepared administrator control — not executed

The proposed next step requires the user's explicit authorization. The prepared
source is `.scratch/macos-owned-spindump-admin-control-v2-2026-11-02.mjs`.
Its default `--plan` mode and ordinary-user `--check-guard` mode were exercised;
neither requests privilege or creates a sampling target. The intentionally stale
identity check exited **65**, before reaching the sampler command. Administrator
mode has **not** been exercised and no successful root capture is claimed.

If separately authorized, `--capture` keeps the controller unprivileged, creates
one fresh synthetic Node 20 child, validates its owner/parent/start/executable,
and asks macOS for administrator approval through its native dialog. The system
command checks the same complete process identity again **after** authorization;
a vanished or changed target is rejected before sampling. An existing output or
symlink is rejected. The sole profiling command is:

```text
/usr/sbin/spindump <verified-owned-pid> 1 10 -onlyTarget -timeline -noBinary -timelimit 8 -o <unique-project-output>
```

Passwords are entered only in the OS dialog, not passed to this program. The
command profiles only that target and saves locally under a private unique
`.scratch/macos-owned-spindump-admin-control-UUID/` directory. Controller/target
timeouts request termination of the owned processes; cancellation of the native
dialog and privileged command has not been verified. The command requests the
documented eight-second sampler limit; its privileged execution remains untested.
If the target ends before authorization finishes, the identity guard rejects it.
The controller propagates nonzero sampler exit and requires a nonempty readable
report after a successful exit. The first source draft is retained separately;
only its safe plan/guard modes were run.

This prepared synthetic control is not an actual failing-child capture. Any
later, separately authorized capture of the reproduced failure must retain the
same target-ownership checks and profiling scope. It cannot count as an
uninstrumented acceptance run, and there is no guarantee it will establish cause.
The proposed authorization is bounded to at most two one-second captures of this
project's newly created Node 20 test children: the synthetic capability control,
then, if useful, one reproduced failing child. No such authorization is assumed.

## Frozen evidence and outstanding acceptance

The **27-artifact**, **145,574-byte** supplement is
`.scratch/macos-postrestart-inventory-2026-11-02.json`, SHA-256
`cb158676bac99f47e9c983ae916208f75f86cbe5370007dcfa12799ddb96e124`.
It includes reviewed driver/guard sources also present in older inventories;
counts can overlap and do not represent distinct tests. The original Node hash,
763 input/build hashes and preceding 22 artifacts were reverified unchanged.
Analysis is `.scratch/analyze-macos-postrestart-2026-11-02.mjs` and its saved
output. The final scoped process check found no matching owned driver/test/control
commands still running. Administrator sources/checks are plans, not privileged
execution evidence.

| Source branch | Confirmed remaining issue | Required next state |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Complete macOS minimum-runtime collections still fail after a verified host-app restart. The root cause/correction remains unknown; child thread inspection and ordinary-user kernel sampling did not provide the needed data. | User decision on bounded administrator sampling, then actual evidence/correction, unchanged complete gates and final independent acceptance review. Keep batch 4–6 and combined OpenSpec acceptance open. |

Actual Windows execution remains skipped by the user's separate instruction.
Another Mac remains unavailable; no repeated application restart is requested.

## Independent review

Fixed candidate `5dfc347adc309be2b3bcf4f16e94b818e8eb3074`, source branch
`kevin/knowledge-expansion`, received two independent read-only reviews. The
scope review covered all **4/4** document diffs; the native review read this
complete new report **1/1** and the designated native/controller/control sources.
Both skipped zero files, independently verified all 27 artifact hashes/bytes,
the original Node, 763 inputs and preceding 22 artifacts, and checked the complete
raw results. Neither confirmed a new P1/P2 or required minor correction. The
administrator scheme's limits are source-review findings; successful authority,
capture, cancellation, timeout and report readback are still unverified. No
reviewer ran tests, diagnostics, analysis scripts, administrator mode, networking,
installation or mutations. These reviews do not close the known failure or accept
the unfinished roadmap. The timeout wording above explicitly retains this limit.

Database changes: none. Data migration: none. Persistent configuration changes:
none. No tracked runtime/test/dependency change, push, npm publication,
deployment, real account, service, grant or host security-policy change occurred.
