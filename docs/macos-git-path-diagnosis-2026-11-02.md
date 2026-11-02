# macOS Node 20: executable-search control isolates the launch delay

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Starting documentation candidate: `c5e8f34a6aba83293eaf5fdb76ec6408f0f93dc6`.
Runtime remains `e44c096e4479f465f16e61ccd5d47d1243023a41` at this diagnostic checkpoint.
**No product repair or final acceptance is claimed here. No restart is required
by the proposed repair.**

## Parent lifetime and path controls

The diagnostic child preserves the same three synthetic SDK cancellation/follow-up
lifecycles. Version output is inherited into the owned guardian's log; a persistent
ordinary-user reader observes the same owned process signature fields. After the
SDK work and disposal, the version-only command has its original 10-second bound.

| Control | Version-output observation | Boundary |
| --- | --- | --- |
| Inherited environment, keep SDK parent | 7721 ms | Version child later confirmed exit 0. |
| Request immediate normal SDK-parent exit after publishing the child | 7691 ms | Exit intent is written 24 ms after version creation; SDK parent later confirmed exit 0. Output timing is observed, not the orphan child's exit code. |
| Four system program directories, keep parent | 16 ms | Version child confirmed exit 0. |
| Restore inherited 43-directory environment, keep parent | 7657 ms | The wrapper records the original PATH fingerprint; version child confirmed exit 0. |
| Keep the same 43-directory environment; diagnostic substitution for project `spawn('git')` uses the same absolute Git executable | 17 ms | Version child confirmed exit 0. `argv0` stays `git`; the Git child environment is retained. This is an instrumented diagnostic, not an acceptance run. |

The restored environment and absolute-Git controls record the same PATH SHA-256,
`278d58fdf5a3eae265a4f9725c92797170095ba147a4857c4b3da87b510a702b`.
The shortened-PATH control is process-local; it does not edit global or user
configuration. The generated SDK child is otherwise the same across these runs.
No measured signature-category drift explains these differences.

Both environment selections resolve Git to **`/usr/bin/git`**, version
**2.39.3 (Apple Git-146)**, SHA-256
`bed335fb48472e4ee3c2c3a38517b208326f37865bd57792df88b42669ec9603`.
Thus changing Git versions does not explain the control. The original Node
**20.0.0** executable and the retained 763 inputs are unchanged.

The project's Git runner currently calls `spawn('git', ...)`. Node 20.0.0's
[published libuv implementation](https://raw.githubusercontent.com/nodejs/node/v20.0.0/deps/uv/src/unix/process.c)
tries PATH candidates by spawning them; an executable path containing a slash
bypasses that search. This source mechanism plus the controls identifies avoiding
repeated executable search as a concrete repair to test. It does not diagnose the
internal reason the OS validation service delays an individual execution.
Large gaps between observed process numbers are not counts of project-created
processes, so no process-count claim is inferred from those gaps.

## Complete collections under the environment control

The unchanged reviewed driver ran from the application, not Terminal, with only
the four-directory process-local PATH substitution. It checked the original Node
bytes and all 763 input/build hashes, probed both actual Git defaults, and kept
all original test assertions, ten-second waiters and skip rules. No diagnostic
preload, native addon, debugger or sampler was added to these collections.

| Actual default | Current collection | Retained original collection | Cancelled / skipped |
| --- | --- | --- | --- |
| `main` | 38/38, exit 0 | 37/37, exit 0 | 0 / 0 |
| `master` | 38/38, exit 0 | 37/37, exit 0 | 0 / 0 |

Logs have prefix
`.scratch/macos-node20-terminal-71328b74-48fe-4109-9513-2011e6f612d3`.
The inherited name is not evidence of launch origin; the supplement includes the
actual application ancestry and wrapper's environment record. Collections overlap
and are not summed. These results establish the environment control's scope;
they do **not** replace the still-failing original-environment acceptance gate.

## Preserved baseline and proposed product repair

Before changing product source, all **763** original input/build files were copied
and individually hash-verified under
`.scratch/macos-git-path-baseline-c6f9744e-ba03-4d9a-9a12-cf2464a8bb7e/files/`.
Its manifest contains **10,947,260 bytes** of file content, SHA-256
`013c8ae9ef86aff18df269b134f60fad28e30d7329730f3d373380e48f3fd285`.
Later source/build changes must be compared with this preserved baseline rather
than presented as unchanged old inputs.

The proposed macOS repair selects the installed executable according to the
caller's current PATH and working directory, then invokes that path directly
while retaining the entire child environment and `argv0`. It must honor search
order, executable permissions, relative/empty entries, changes between calls,
failed-start fallback, cancellation and the existing total deadline. Other
platforms retain their existing launch path. No hard-coded system Git, new
dependency, cache, setting, runtime upgrade or policy exception is introduced.
The [OpenSpec change](../openspec/changes/fix-macos-git-executable-lookup/proposal.md)
defines implementation and executable acceptance, including the original four
complete collections under the original inherited application environment.

The **81-artifact**, **207,995-byte** supplement is frozen in
`.scratch/macos-git-path-controls-inventory-2026-11-02.json`, SHA-256
`d0318bf3f005ea8e5c36d4e5efe9866c9c7818f88ba0dbfd24bf838acf36f54b`.
It includes the executed controls, five result folders, full environment-control
matrix and baseline manifest. The previous 38 artifacts and all baseline copy
hashes were independently checked by the freezer. Artifact totals are not tests.

Two isolated read-only reviewers of preceding candidate `c5e8f34` each covered
3/3 document diffs, zero skipped, and reverified all 38 prior artifacts plus
18/10 earlier artifacts and 763 inputs. Neither found a confirmed required
correction or accepted the failing gate. This newer diagnosis and any product
repair require their own fixed-candidate review.

| Source branch | Next required evidence |
| --- | --- |
| `kevin/knowledge-expansion` | Implement the bounded executable lookup, preserve selection/failure semantics, pass the unchanged complete macOS Node 20 collections in the original environment, then the remaining complete/package/spec/audit and independent review gates. |

Batch 4–6 and the 12+1 combined OpenSpec items remain unaccepted. Windows actual
execution remains skipped by request. No database change, migration, persistent
configuration change, additional administrator action, push or publication.
