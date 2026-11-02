# macOS launch follow-up without restarting the computer

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Starting documentation candidate: `d76d7e15a62b9d26faf7c4d8ee6fafe4c55b272c`.
Runtime remains `e44c096e4479f465f16e61ccd5d47d1243023a41`.
**Computer restart is not an acceptance prerequisite. The existing failing
macOS checks remain required and unresolved.**

The user declined a computer restart. This follow-up used ordinary-user commands
and reads of the project's own diagnostic processes. No administrator dialog,
live stack sample, service restart, policy edit, signature replacement, runtime
upgrade or dependency change occurred. The two earlier sampling grants and
single service attempt remain consumed; they were not reused.

## Execution assessment does not distinguish the versions

One `spctl --assess --type execute --no-cache --verbose=4` call for each existing
Node executable exited **3**, without a signal, with empty stdout. Both reported
valid code that did not appear to be an application. Node 22 is also the existing
passing runtime, so this shared bare-executable assessment result does not explain
the Node 20-only waiter failures or establish that either runtime's actual
execution is denied. It is not a notarization verdict or a product check.

`--no-cache` avoids storing assessment outcomes, as the installed manual states;
no policy-changing option was invoked. Actual outputs and argument arrays are in
`.scratch/macos-node-policy-assessment-52064238-3e1a-44ae-9a97-77dd6dfd5e4c/`.

## Read-only process metadata, with an unavailable first comparison retained

The next hypothesis was that SDK activity changes a parent's code-signing state
or validation category. The helper uses only `csops` read operations **0** and
**17**, corresponding to status and validation category in Apple's matching
[XNU header](https://raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-11417.121.6/bsd/sys/codesign.h).
The [kernel implementation](https://raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-11417.121.6/bsd/kern/kern_proc.c)
handles these as reads without a root-only requirement. None of its mutation
operations is called. This is metadata retrieval, not stack sampling or process
debugging. No native addon was loaded into the measured Node process.

Each read checks the same ordinary UID, exact Node 20/22 executable paths, the
owned parent chain to the Node 22 controller, and process birth identity before
and after. Reads outside this tree are refused. A Node 22 group guardian remains
alive until cleanup, retaining the reviewed protection against signalling a
reused group after an earlier command exit.

The controller derives a new diagnostic child from the retained synthetic SDK
prefix, verifies that prefix's original hash, and uses the current compiled
fixture/source collection. It preserves all three actual cancellation assertions
and their follow-up operations. In particular, cancelled apply is followed by
prepare, not an apply retry; the new log names that distinction explicitly.
Only fake local fixtures/identities and fixture model replies are used.

The first controller launched a fresh metadata helper for each read. Controller
**21571** and SDK worker **21577** both returned status **570491397**, category
**6**, before the operations. After the three SDK lifecycles, the helper call
produced no JSON and ended with `SIGTERM` under its separate two-second bound.
This supplies **no after-state measurement**: it does not prove a category change,
a helper startup stall or where that call spent its time. The SDK group was
then stopped; its command terminal status was unconfirmed, while the guardian's
actual `SIGKILL` and retained ownership were recorded. No version-only probe ran.
Keep this incomplete comparison, not a passing control:
`.scratch/macos-codesign-checkpoint-bdadc576-ebe9-46de-8011-fa2b1b3f587a/`.

## Persistent reader: matching fields, still a slow launch

The second controller started the helper **before** the SDK activity and retained
its private input/output pipes. That removes launching another helper from the
after-state observation. It reads serial requests; checkpoint files are published
by rename after complete writes. The two checkpoint acknowledgements precede the
version-only command and do not extend its **10,000 ms** execution bound.

| Observed process / time | PID / parent | Status read / category read | Status flags | Validation category |
| --- | --- | --- | --- | --- |
| Node 22 controller | 27585 / 22434 | 0 / 0 | 570491397 | 6 |
| Node 20 SDK worker, before operations | 27592 / 27591 | 0 / 0 | 570491397 | 6 |
| Same worker, after disposal | 27592 / 27591 | 0 / 0 | 570491397 | 6 |
| Actual version-only child, about 1500 ms after creation | 32761 / 27592 | 0 / 0 | 570491397 | 6 |

All four reads returned zero errors and stable birth identity. The child
eventually returned `v20.0.0`, empty stderr, exit **0**, after **8162 ms**, without
a signal or timeout kill. The SDK worker also exited **0**. Guardian **27591**
then reached its recorded `SIGKILL` cleanup state without ownership loss, and
persistent reader **27587** exited **0** on closed input.

There is no observed drift in these fields at these four moments. This does not
exclude transient differences, another field, another process, or a policy wait.
The slow command completed within its diagnostic bound; it is not a reproduction
of an original failed assertion, a correction, or acceptance of the complete
38/37-case collections. No actual CLI copy/integration cancellation gate was
replaced by this version-only probe. All results and the generated executed child
are retained in
`.scratch/macos-codesign-checkpoint-9c14c075-3311-4e99-b4bc-6cc72efc9c65/`.

## Current metadata and frozen evidence

At **09:06:28 UTC / 17:06:28 Asia/Shanghai**, a saved ordinary `ps` query still
identifies `syspolicyd` PID **309**, started **09:33:53 Asia/Shanghai**, with **8608
KiB RSS** and **0.0% CPU**. The application is still PID **22030**, started
**13:47:08 Asia/Shanghai**. The system reports execution assessments enabled.
This momentary metadata does not establish or exclude earlier load or a leak.
A later query for the eight recorded controller/guardian/worker/child PID slots
returned no rows, exit **1**, empty stderr; it was an absence check, not an error
interpreted as passing a product test. The persistent reader is included.

Sources, compiled diagnostic helpers, both comparisons and assessment/metadata
outputs are frozen as **38 regular artifacts**, **175,769 bytes**, in
`.scratch/macos-codesign-state-inventory-2026-11-02.json`, SHA-256
`ea6286877b7f620c1a0bb0fd69445931f685f3acd94586d101a09623464d14ad`.
All **763** retained input/build hashes and the preceding 18/10 artifact
inventories were reverified unchanged by the freezer. Counts are artifacts, not
tests. Its `ipcContentsRead:false` field describes the freezer: it only read
regular files, not live IPC. The diagnostic controller did consume its private
reader pipe messages, which are retained in `native-reader.log`; no filesystem
FIFO contents were read or hashed.

| Source branch | Remaining requirement | Current boundary |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Explain/correct the known macOS Node 20 failure and pass the unchanged complete collections under both actual defaults, then final independent acceptance review. | Assessment output and the four measured signature fields do not identify a correction. Keep batches 4–6 and all 12+1 combined OpenSpec items open. |

The original failures, successful Terminal matrix, Linux and Node 22 results
retain their prior scopes. Windows execution remains skipped by request. No
tracked runtime/test/dependency change, database change, data migration or
persistent configuration change. No push, publication, deployment or new grant.
