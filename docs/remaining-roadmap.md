# Remaining implementation work

Scope confirmed on 2026-10-22 for `sens-io/memobranch`, branch `kevin/knowledge-expansion`.
The user chose **local / Git-managed, fixed-version sharing**. Do not add a cloud
account service. Configuring a real vault's grants, publishing, pushing, deploying,
or installing an exported skill is not part of this development loop.

Work proceeds through implementation, retained verification, local commits and
independent adversarial review. A passing batch is not a claim that all future
features, arbitrary documents, or real-world skill effectiveness are proven.

| Batch | Deliverable | State |
| --- | --- | --- |
| 1 | Immutable experience traces, bounded host-run validation, explicit skill export; then CLI and management adapters | Core/CLI and MCP/Harness accepted locally on 2026-10-23. Web candidate `d329b3c` passed 83 targeted checks, 813 retained checks under each Git default, the same installed package on Node 20/22 and independent review of all 15 files. Current native-browser end-to-end/responsive verification remains pending; do not close this batch yet. See [core checkpoint](validated-experience-core-verification-2026-10-22.md), [agent adapter checkpoint](validated-experience-agent-verification-2026-10-23.md) and [Web work record](validated-experience-web-verification-2026-10-23.md). |
| 2 | As-known-at reconstruction with explicit availability evidence; never infer knowledge from mutable Git dates | Core candidate: explicit signed observations and bounded historical reconstruction, including confidential opt-in, cancellation, post-save authority loss, expiry and rule bindings. 48 new/retained checks and strict OpenSpec 28/28 passed. Full retained/installed verification and independent review pending; CLI/agent/Web adapters pending. See [development core](knowledge-availability.md). |
| 3 | Local / Git pinned, read-only sharing under explicitly configured identities, current access and source checks | Pending |
| 4 | Cross-vault / branch import and merge preview, separate approval, preserved origin and classification | Pending |
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
