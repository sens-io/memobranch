# PDF processor core — independent review and corrections

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Reviewed candidate: `eb9e6b0058a6549d02bdd484a99c4fb8e17f277a`.
This is an intermediate implementation record, not acceptance of batch 5.

Three read-only reviewers examined the process engine/tests (2 files), schema/Git
cleanup export (2 files), and checkpoint/OpenSpec/roadmap records (6 files).
The documentation review covered 6/6 with no confirmed P1/P2. The schema/export
review covered 2/2 and found the two P2 issues below. Process review is still being
completed; its Windows background-process concern remains open.

| Source branch | Finding | Correction / actual evidence |
| --- | --- | --- |
| `kevin/knowledge-expansion` | P2: ASCII decoding clears the high bit in a PNG chunk name. An invalid raw name can pass as `IHDR` after its CRC is recomputed. | Decode with `latin1`, preserving each byte for the existing ASCII-letter validation. The committed old implementation accepted the exact malformed control; the new regression refuses it. |
| `kevin/knowledge-expansion` | P2: `inflateSync` ignores unconsumed bytes after a valid zlib stream. Extra IDAT bytes can pass with a recomputed CRC. | Require the decompressor's consumed-input count to equal the complete IDAT byte count. The committed old implementation accepted the exact trailing-byte control; the new regression refuses it. |
| `kevin/knowledge-expansion` | Windows background helper cleanup after normal leader exit is not established by the POSIX fixtures. `taskkill` using an already-exited leader PID cannot reliably stop that helper. | Open. Do not describe skipped Windows cases as accepted. A process ownership implementation and actual platform evidence are still required. |

The original-candidate reproducer is retained in
`.scratch/pdf-processing-png-baseline.log`; it confirms both malformed inputs
were accepted by the old committed schema. The initial regression failed in
`.scratch/pdf-processing-png-regression-red.log`. The implementation retains all
previous assertions and adds a complete malformed-input regression.

Related collections after the PNG correction: **37/37 on Node 22.17.0 and
compiled Node 20.0.0**, zero failed/cancelled/skipped, exit 0, in
`.scratch/pdf-processing-png-fixed.log` and `pdf-processing-png-node20.log`.
These are the 17 processor checks, 9 existing Git cancellation checks and 11
existing PDF import checks. They are not a full repository or installed-package
acceptance run. An initial build failed because the installed Node declarations
omit the runtime-supported `info:true` return overload; the implementation now
states that return shape explicitly. That failed build remains recorded.

Subsequent processed-evidence integration is separate work and is not established
by these related collections. The original macOS Wiki-adapter 35/37 failure also
remains open. No push, publication, deployment, dependency installation, real
account, grant, service or host configuration change was performed.
