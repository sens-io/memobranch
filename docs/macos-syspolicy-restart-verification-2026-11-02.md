# macOS service restart attempt: refused by System Integrity Protection

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Starting documentation candidate: `6a2992761a26ee6ed4c91cb9d1ead0a0751f8bf0`.
Runtime remains `e44c096e4479f465f16e61ccd5d47d1243023a41`.
**The service did not restart. No correction or final acceptance is claimed.**

## Separate authorization and exactly one attempt

After both authorized samples completed, the user separately answered
“授权一次重启并复测” to the specific proposal to restart
`com.apple.security.syspolicy` once, then rerun the unchanged complete checks.
This new grant does not authorize another sample, disabling security controls,
changing policy, replacing Node, or restarting the entire computer.

The ordinary Node 22 controller submitted exactly this command through the native
macOS administrator dialog, once, with no retry:

```text
/bin/launchctl kickstart -k -p system/com.apple.security.syspolicy
```

The client was PID **10970**. Submission was **08:33:06.740 UTC** and completion
**08:34:09.287 UTC** (**16:33:06.740–16:34:09.287 Asia/Shanghai**). The client
exited **1**, without a signal; stdout was empty. The actual error was:

```text
Could not kickstart service "com.apple.security.syspolicy": 150: Operation not permitted while System Integrity Protection is engaged (150)
```

This is an operating-system refusal, not an automatic approval-review rejection.
It shows why this specific intervention did not execute, not why the earlier
Node child waited. No attempt was made to disable System Integrity Protection,
kill the protected daemon by another route, clear caches or expand the grant.
Passwords were handled only by the native OS dialog.

## Read-only state verification and retained checks

Subsequent ordinary-user `launchctl print` and the specific PID query both exited
**0** with empty stderr. They still identify the same program
`/usr/libexec/syspolicyd`, **PID 309**, running, **one run**, and **never exited**;
the process start remains November 2 at **09:33:53 Asia/Shanghai**. Thus neither
the command result nor service metadata supports a successful restart.

No tracked runtime, test or dependency files changed in this attempt. There was
no successful intervention, so the planned post-restart four-matrix run was **not
started**. The latest unchanged uninstrumented complete results remain those in
the [application-restart report](macos-postrestart-verification-2026-11-02.md):

| Actual Git default | Current collection | Retained original collection |
| --- | --- | --- |
| `main` | 37/38, exit 1 | 35/37, exit 1 |
| `master` | 36/38, exit 1 | 35/37, exit 1 |

These are prior results, not fresh runs after a service restart. The
[actual failing-child capture](macos-administrator-sampling-2026-11-02.md) locates
that child's sampled wait before project JavaScript in the OS execution-validation
path. It still does not identify the delayed response's cause or a correction.
The old passing Terminal matrix does not replace the retained failing app runs.

## Frozen local evidence and remaining boundary

The executed controller is
`.scratch/macos-syspolicy-restart-once-2026-11-02.mjs`. Raw command output,
observations and subsequent read-only metadata are private files under
`.scratch/macos-syspolicy-restart-a697c528-39d6-4963-89ee-de0b120ffff8/`.
The earlier frozen proposal remains unchanged as a pre-authorization record;
this report and the new observations record the later grant and actual attempt.

The new supplement freezes **10 regular artifacts**, **13,600 bytes**, in
`.scratch/macos-syspolicy-restart-inventory-2026-11-02.json`, SHA-256
`39330ecdc12a7ecbaeae07301e878f9fdb5888f5de8e1468e0828d2de5f16936`.
The preceding 18-file capture inventory and all its regular hashes were reverified
unchanged. No FIFO contents were opened or hashed. Artifact counts are not tests.

| Source branch | Confirmed remaining issue | Next boundary |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Complete macOS Node 20 checks still fail; the captured child waits in OS execution validation and the approved service restart was refused. | A further host-state intervention requires a separate user decision; preserve the unchanged full gates and final independent acceptance review. |

The user subsequently chose **“暂不重启 Mac”**. No computer restart is planned
at this checkpoint. This is not a waiver of the macOS gate or authorization for
another system intervention; the existing complete checks remain pending.

Both sampling operations and the single service-restart attempt are consumed;
no additional live sample or service attempt is authorized. The computer has
not been restarted by this task. Batch 4–6 acceptance and **12+1** combined
OpenSpec items remain open. Actual Windows execution remains skipped by request.
No tracked runtime/test/dependency changes, database changes, data migration or
persistent configuration changes occurred. No push, publication or deployment.

## Independent review and evidence wording correction

Two isolated read-only reviewers examined committed candidate
`ad41d7dd977fa45e287356c293905871199717ef`, source branch
`kevin/knowledge-expansion`, against `6a2992761a26ee6ed4c91cb9d1ead0a0751f8bf0`.
Both manually covered **5/5** changed documents, with zero skipped, and
independently reverified all **10/10** regular artifacts and the preceding 18.
The native reviewer found no required correction. The scope reviewer identified
one evidence-wording improvement, addressed in this record:

| Source branch | Review observation | Correction |
| --- | --- | --- |
| `kevin/knowledge-expansion` | The parent tool transcript recorded a 763-input check while the command was pending, but the ten frozen service artifacts did not retain that check or its timing. | Removed that timing statement from the state-verification section; it now states the directly reviewable absence of tracked runtime, test and dependency changes. No raw evidence was altered or new execution implied. |

Both reviewers confirmed that a submitted command is not a successful restart,
the refusal came from macOS rather than automatic approval review, and the
post-restart tests were not run. They did not execute tests, diagnostics,
sampling, administrator/service operations, network requests or writes.
This review does not close the failing functional gates or authorize another
system action.
