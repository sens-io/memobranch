# Remaining implementation work

Scope confirmed on 2026-10-22 for `sens-io/memobranch`, branch `kevin/knowledge-expansion`.
The original choice was **local / Git-managed, fixed-version sharing**, implemented
in batch 3. On 2026-10-24 the user explicitly added **cloud sharing**; that earlier
local-only restriction no longer excludes this new feature. Its deployment/access
model was then confirmed as **both self-hosted cloud service and Git remote sharing**
(the user's answer: "1+2"). Keep the accepted local mode available; do not add a
hosted SaaS dependency or automatic account registration.
Configuring real grants/accounts/services, publishing, pushing, deploying or
installing an exported skill is not part of this development loop.

Work proceeds through implementation, retained verification, local commits and
independent adversarial review. A passing batch is not a claim that all future
features, arbitrary documents, or real-world skill effectiveness are proven.

On 2026-10-29 the user explicitly instructed: **skip Windows platform verification**.
Record real Windows execution/ACL checks as skipped by request, not passed; do not
make a Windows-runtime acceptance claim. The waiver did not remove the already
identified process-ownership defect from implementation and independent review;
its correction and review are recorded below.
This waiver does not skip macOS/Linux checks or authorize pushing/deployment.

## Current local acceptance

All agreed batches 1–6 are accepted locally after the
[final Git lookup repair and verification](git-executable-lookup-verification-2026-11-02.md).
The original complete macOS Node 20 collections now pass under both implicit
Git defaults in the inherited application environment, without rebooting.
Node 22 full checks pass 1102 cases per default; Linux Node 20, the same archive
on Node 20/22, strict OpenSpec and current dependency audits also passed.
Independent source and final evidence reviews found no remaining confirmed issue
within this scope. Windows actual execution remains skipped by request.
This accepts development source locally; no push, npm publication or deployment
was performed. Database changes, data migration and persistent configuration
changes: none.

## Historical investigation before the accepted repair

The following paragraphs retain the earlier checkpoint states and unsuccessful
attempts. Their open-gate descriptions are historical; current acceptance is above.

The [macOS minimum-runtime investigation](macos-minimum-runtime-diagnosis-2026-10-29.md)
retains complete failures and directly observes an unstarted/suspended Node 20
child after repeated SDK activity. Later controls also reproduce it without
cancelling active requests or running CLI logic. Filtered positive controls do not accept that gate;
the suspension's cause and required correction remain open. The
[scoped completion audit](roadmap-completion-audit-2026-10-29.md) maps the remaining
tasks to implementation and exact evidence without accepting the failed gate.
Its fresh current-code Linux supplement passed both actual Git defaults: related
PDF/Git 69 passed / 2 existing Darwin-only skips, current protocol 38/38 and
original protocol 37/37, each exit 0. Both setup failures remain recorded.
Another macOS environment is currently unavailable, as confirmed by the user;
the macOS failure remains open.
The [October 30 follow-up](macos-minimum-runtime-followup-2026-10-30.md) repeats
the complete failures under both actual defaults, verifies official runtime bytes
and records the unavailable native trace capability. No batch acceptance changed.
It later verifies existing LLDB launch/attach as a local continuation path, while
retaining two incomplete capture attempts. This is not a reason to waive the
failing macOS gate or require a new environment before further local investigation.
The later [actual-worker observation](macos-process-entry-observation-2026-10-30.md)
records pre-attach native samples with a zero task suspension count, a later
successful real-child capture at the loader's first instruction, and the same
complete failure using a verified official executable copy. It preserves failed
and interrupted attempts and prepares an outside-application comparison; the
cause, correction and final acceptance remain open.
The [November 2 same-day comparison](macos-launch-context-comparison-2026-11-02.md)
now records the original complete Node 20 Terminal matrix passing under both
actual defaults (38/38 and 37/37), while application-launched complete runs still
fail. Temporary startup-setting controls and the tool's terminal mode did not
close that failure. Both contexts also emit the same system-policy warnings;
their presence is not a proven cause. Combined acceptance remains withheld.
The [signal-state supplement](macos-signal-state-comparison-2026-11-02.md) records
an observed original single-file pair (application 18/19, Terminal 19/19).
Measured native states matched around all 24 selected CLI spawns, including the
failed prepare case. The same exact-PID system notification occurred for both
corresponding children. Neither observation identifies a correction or closes
the known failure; complete-collection requirements remain unchanged.
The [verified application-restart result](macos-postrestart-verification-2026-11-02.md)
still fails all four complete collection/default combinations. Direct child thread
inspection was unavailable in its bounded control; the installed system sampler
explicitly requires administrator authority. Its bounded administrator control
was prepared without execution at that checkpoint. The user subsequently
authorized at most two scoped samples; [both have now completed](macos-administrator-sampling-2026-11-02.md).
The captured failing child waits in the OS execution-validation path for
`syspolicyd` before project JavaScript. Its delayed response/correction remains
unverified. The user then separately authorized one service-restart attempt;
[macOS refused it under System Integrity Protection](macos-syspolicy-restart-verification-2026-11-02.md).
Read-only metadata still shows the same running PID and no service exit. No
post-restart test matrix was started because no restart succeeded. Both samples
and the single restart attempt are consumed. Complete acceptance requirements
remain unchanged; no broader system action is authorized.
The user chose not to restart the Mac for now. This keeps the macOS gate open;
it is not a platform-verification waiver or permission for another intervention.
The [ordinary-user follow-up](macos-readonly-launch-followup-2026-11-02.md)
checks execution-assessment output and reads owned process signature fields
before/after SDK activity, retaining an incomplete first comparison. A persistent
reader observes matching fields while a version-only child still takes 8162 ms.
No correction follows; restarting the computer is not an acceptance prerequisite.
The [next path-search controls](macos-git-path-diagnosis-2026-11-02.md) reproduce
7.7-second launches in the original environment and 17 ms with the same Git
invoked directly, retaining its environment. All four original collections pass
under a temporary short-PATH control. The bounded executable-lookup repair is
specified but not accepted; final verification must use the original environment.

| Batch | Deliverable | State |
| --- | --- | --- |
| 1 | Immutable experience traces, bounded host-run validation, explicit skill export; then CLI and management adapters | Accepted locally. Core/CLI and MCP/Harness accepted on 2026-10-23; Web actual browser checks completed 2026-10-24. Combined patched-dependency verification: 828 retained checks under each Git default, strict OpenSpec 28/28, production audit 0, same installed package on Node 20/22 and final checkpoint-text review passed. See [core checkpoint](validated-experience-core-verification-2026-10-22.md), [agent adapter checkpoint](validated-experience-agent-verification-2026-10-23.md) and [Web work record](validated-experience-web-verification-2026-10-23.md). |
| 2 | As-known-at reconstruction with explicit availability evidence; never infer knowledge from mutable Git dates | Accepted locally, including CLI/MCP/Harness/Web: 35 agent/CLI checks, 93 Web checks, 846 retained checks under each Git default, strict OpenSpec 28/28, audit 0, same installed artifact on Node 20/22, native browser/375px, fixed-candidate fixes and final checkpoint-text independent review passed. See [core verification](knowledge-availability-verification-2026-10-24.md) and [adapter verification](knowledge-availability-adapters-verification-2026-10-24.md). |
| 3 | Local / Git pinned, read-only sharing under explicitly configured identities, current access and source checks | Accepted locally: 45 core/agent checks, 104 related Web checks, 880 retained checks under each Git default, strict OpenSpec 29/29, audit 0, the same 401-entry installed package on Node 20.0/22.17, actual browser/375px and independent fixed-candidate review passed. No cloud accounts or grant editor. See [verification](pinned-shared-wiki-verification-2026-10-24.md). |
| 3b | Cloud memory sharing, added by the user on 2026-10-24 | Accepted locally: both self-hosted service and Git remote sharing. [Combined verification](cloud-host-verification-2026-10-26.md): native credential/template/check/foreground commands, Git CLI/MCP/Harness tests, 57 compiled Node 20 checks, 987 full checks under each Git default, strict OpenSpec 31/31, audit 0 and the same 448-entry installed package on Node 20/22. Prior service/client/Git and actual browser evidence is linked there. Implementation review covered 15/15 files; final acceptance-text review covered 8/8 files at `3c22972`, zero skipped, no confirmed issue. No hosted SaaS dependency, real service, account or grant has been created. |
| 4 | Cross-vault / branch import and merge preview, separate approval, preserved origin and classification | Accepted locally. [Recovery](shared-wiki-import-recovery-verification-2026-10-28.md), [browser](shared-wiki-web-verification-2026-10-28.md) and [final combined verification](git-executable-lookup-verification-2026-11-02.md) cover library/CLI/MCP/Harness/Web and bilingual instructions. The original complete macOS 37-case collection now passes under both actual defaults; old failures remain preserved. Another branch requires an explicitly configured checkout; no automatic Git merge or real grant changes. |
| 5 | Optional bounded local OCR and visual-page processing, preserved original PDF and honest extraction limits | Accepted locally. [Native implementation and observations](pdf-processing-combined-verification-2026-10-29.md), [ownership correction](pdf-windows-host-verification-2026-10-29.md) and [final combined verification](git-executable-lookup-verification-2026-11-02.md) retain exact-byte/encryption/recovery checks, original complete macOS current 38/38 and original 37/37 under both defaults, and independent review. Actual Windows verification is skipped by request; arbitrary OCR quality is not proven. No real host configuration was created. |
| 6 | Complete management/adapters, bilingual instructions, retained package/runtime checks and final independent review | Accepted locally within the agreed scope. [Final verification](git-executable-lookup-verification-2026-11-02.md): 1102 full checks per actual default, 79 related macOS Node 20 checks, Linux Node 20, the same 502-entry archive on Node 20/22, strict OpenSpec 33/33, project/consumer audits 0 and independent fixed-candidate review. Existing browser/native evidence keeps its component scope. No publication, deployment or external model-quality claim. |

## Acceptance boundaries

- Raw material remains immutable. Ingest, Query and Lint remain separate.
- No automatic promotion of an anecdote into a generally applicable procedure.
- Validation records bind exact procedure, source versions, cases and observed
  results. A trusted evaluator determines semantic correctness; schema checks alone
  do not prove usefulness. Include held-out, retained-behavior and safety cases.
- A copied plaintext export cannot be recalled. Removing access must stop new
  reads/exports, but does not erase another person's offline copy.
- Historical reconstruction must report unsupported legacy history as unknown,
  not fabricate when a model first learned a fact.
- No unconsented remote model calls, fetching arbitrary networks, executing an
  untrusted evaluator, weakening tests or silently changing permissions.
- Each batch records actual verification, review findings, commit IDs and skipped
  checks. Do not mark a task complete solely because its code exists.

Baseline before this loop: `601efb2ef5291a339bc6d575d12c48df3e201477`.
