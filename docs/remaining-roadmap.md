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

| Batch | Deliverable | State |
| --- | --- | --- |
| 1 | Immutable experience traces, bounded host-run validation, explicit skill export; then CLI and management adapters | Accepted locally. Core/CLI and MCP/Harness accepted on 2026-10-23; Web actual browser checks completed 2026-10-24. Combined patched-dependency verification: 828 retained checks under each Git default, strict OpenSpec 28/28, production audit 0, same installed package on Node 20/22 and final checkpoint-text review passed. See [core checkpoint](validated-experience-core-verification-2026-10-22.md), [agent adapter checkpoint](validated-experience-agent-verification-2026-10-23.md) and [Web work record](validated-experience-web-verification-2026-10-23.md). |
| 2 | As-known-at reconstruction with explicit availability evidence; never infer knowledge from mutable Git dates | Accepted locally, including CLI/MCP/Harness/Web: 35 agent/CLI checks, 93 Web checks, 846 retained checks under each Git default, strict OpenSpec 28/28, audit 0, same installed artifact on Node 20/22, native browser/375px, fixed-candidate fixes and final checkpoint-text independent review passed. See [core verification](knowledge-availability-verification-2026-10-24.md) and [adapter verification](knowledge-availability-adapters-verification-2026-10-24.md). |
| 3 | Local / Git pinned, read-only sharing under explicitly configured identities, current access and source checks | Accepted locally: 45 core/agent checks, 104 related Web checks, 880 retained checks under each Git default, strict OpenSpec 29/29, audit 0, the same 401-entry installed package on Node 20.0/22.17, actual browser/375px and independent fixed-candidate review passed. No cloud accounts or grant editor. See [verification](pinned-shared-wiki-verification-2026-10-24.md). |
| 3b | Cloud memory sharing, added by the user on 2026-10-24 | Confirmed: both self-hosted cloud service and Git remote sharing. [Self-hosted service checkpoint](cloud-read-service-verification-2026-10-26.md) passed locally. [Cloud client candidate](cloud-sharing.md) adds strict version 2 local/cloud bindings, certificate trust, complete graph checks, live expiry guards and fresh confirmed import; 63 related core checks and 18 CLI/SDK/HTTP checks passed. Independent client review, native browser, full/installed client gates remain in progress. Git transport, service setup and whole-batch acceptance remain pending. No hosted SaaS dependency, real service, account or grant has been created. |
| 4 | Cross-vault / branch import and merge preview, separate approval, preserved origin and classification | Design reviewed with retry/ordinary-memory/Git wording fixes. Artifact format and library copy fixes independently reviewed; 130 related checks and 876 whole functional tests passed. Both-default/release/package/native gates for this batch remain pending. Human-authored integration and import adapters pending; no batch acceptance yet. Another branch requires an explicitly configured local checkout, without Git merge or grant changes. See [candidate guide](shared-wiki-import.md). |
| 5 | Optional bounded local OCR and visual-page processing, preserved original PDF and honest extraction limits | Pending |
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
