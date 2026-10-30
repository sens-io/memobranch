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

| Batch | Deliverable | State |
| --- | --- | --- |
| 1 | Immutable experience traces, bounded host-run validation, explicit skill export; then CLI and management adapters | Accepted locally. Core/CLI and MCP/Harness accepted on 2026-10-23; Web actual browser checks completed 2026-10-24. Combined patched-dependency verification: 828 retained checks under each Git default, strict OpenSpec 28/28, production audit 0, same installed package on Node 20/22 and final checkpoint-text review passed. See [core checkpoint](validated-experience-core-verification-2026-10-22.md), [agent adapter checkpoint](validated-experience-agent-verification-2026-10-23.md) and [Web work record](validated-experience-web-verification-2026-10-23.md). |
| 2 | As-known-at reconstruction with explicit availability evidence; never infer knowledge from mutable Git dates | Accepted locally, including CLI/MCP/Harness/Web: 35 agent/CLI checks, 93 Web checks, 846 retained checks under each Git default, strict OpenSpec 28/28, audit 0, same installed artifact on Node 20/22, native browser/375px, fixed-candidate fixes and final checkpoint-text independent review passed. See [core verification](knowledge-availability-verification-2026-10-24.md) and [adapter verification](knowledge-availability-adapters-verification-2026-10-24.md). |
| 3 | Local / Git pinned, read-only sharing under explicitly configured identities, current access and source checks | Accepted locally: 45 core/agent checks, 104 related Web checks, 880 retained checks under each Git default, strict OpenSpec 29/29, audit 0, the same 401-entry installed package on Node 20.0/22.17, actual browser/375px and independent fixed-candidate review passed. No cloud accounts or grant editor. See [verification](pinned-shared-wiki-verification-2026-10-24.md). |
| 3b | Cloud memory sharing, added by the user on 2026-10-24 | Accepted locally: both self-hosted service and Git remote sharing. [Combined verification](cloud-host-verification-2026-10-26.md): native credential/template/check/foreground commands, Git CLI/MCP/Harness tests, 57 compiled Node 20 checks, 987 full checks under each Git default, strict OpenSpec 31/31, audit 0 and the same 448-entry installed package on Node 20/22. Prior service/client/Git and actual browser evidence is linked there. Implementation review covered 15/15 files; final acceptance-text review covered 8/8 files at `3c22972`, zero skipped, no confirmed issue. No hosted SaaS dependency, real service, account or grant has been created. |
| 4 | Cross-vault / branch import and merge preview, separate approval, preserved origin and classification | Implemented in library/CLI/MCP/Harness/Web with bilingual guides. [Recovery and full-check checkpoint](shared-wiki-import-recovery-verification-2026-10-28.md): actual crash/cancel/dual-capture tests, 36 related checks on both runtimes, final recovery 8/8 on both, full 1041 under each Git default, strict specs 32/32 and independent records review 7/7 passed. [Same 457-entry archive](shared-wiki-package-verification-2026-10-28.md) passed Node 20/22 consumers; unchanged dependencies retain audit 0. [Actual browser checks](shared-wiki-web-verification-2026-10-28.md) passed. [Linux Node 20.0.0 supplement](shared-wiki-import-linux-verification-2026-10-28.md): complete 37/37 under each actually probed default. The original macOS minimum-runtime collection still failed 35/37; earlier samples show waiting before JavaScript, without establishing cause. That failure is retained, so the combined final gate and batch acceptance remain open. Another branch requires an explicitly configured checkout; no Git merge or real grant changes. |
| 5 | Optional bounded local OCR and visual-page processing, preserved original PDF and honest extraction limits | [Combined checkpoint](pdf-processing-combined-verification-2026-10-29.md): selected local rendering/OCR, immutable encrypted media, authorized API/CLI reads and bilingual guides implemented under verification; actual mixed-PDF save/read, full 1078 under each Git default, strict 32/32, audit 0 and the same 477-entry archive on Node 20/22 passed. Source reviews covered 19/19 and 6/6 files; packaging review 7/7 plus follow-up 2/2 closed a direct-encryption verification gap. Linux Node 20 current 38/38 and original 37/37 passed under each actual default. [Windows ownership correction](pdf-windows-host-verification-2026-10-29.md) has 71/71 related checks on both runtimes, fresh 1094 complete checks under each actual Git default, strict 32/32, production audit 0 and the same 488-entry archive verified on Node 20/22. Independent review closed both cleanup findings; actual Windows platform verification is skipped by request. macOS waiter failures and final checks remain open, so no batch acceptance is claimed. No real service/account/host configuration change. |
| 6 | Complete management/adapters, bilingual instructions, retained package/runtime checks and final independent review | Pending |

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
