# Compiled Wiki copy and human-integration adapters — candidate checkpoint

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Baseline: `11773e745d8bc4edafb99d133159a3284fa69c0f` (verified library core record).
This checkpoint covers CLI, MCP and DeepSeek Harness, not Web controls or whole
batch 4 acceptance. No push, npm publication, real service/account/grant change
or deployment is authorized by these tests.

## Implemented behavior

- `wiki import-prepare` requires a configured source name, exact catalog pin and
  distinct keys; returns complete compiled evidence for review, never captures it.
- `wiki import-apply --file ... --confirm` separately rechecks source access and
  retains evidence only. Shared configuration remains host-owned.
- `wiki integration-prepare --file ...` reads authored text and an exact local
  revision (zero creates). It returns the complete comparison, ordinary preview
  and signed plan, without a model call or Wiki approval. Existing `wiki preview`
  and separately invoked `wiki apply` approve the target.
- MCP/Harness expose the corresponding strict copy prepare/apply and integration
  prepare tools, with required literal copy confirmation. Copy tool registration
  follows host configuration and current permissions; execution also rechecks
  authority. Integration uses an already retained local artifact and does not
  require remaining remote sharing configuration.
- Private selection and source/destination keys remain independent. Extra roots,
  principals, authority fields, apply flags and JSON signals fail. Host transport
  and provider lifetime signals cancel real owned waits.
- Complete escaped reviews and separately resubmittable approval envelopes are
  bounded at 9 MiB. CLI copy approval/integration input files may include formatting
  within a 9 MiB file limit, while canonical signed plans remain at 1,000,000 bytes.
  The existing bounded file reader keeps regular-file/replacement/cancellation
  checks and its default 1 MB limit for directory/experience inputs.
- English and Chinese guides describe the two separate approvals, offline-copy
  limits, exact retries, compatibility and host-owned local/cloud/Git setup.

## Recorded checks

Build and all test types passed in
`.scratch/wiki-import-adapters-build-3.log` and
`.scratch/wiki-import-adapters-types-3.log`.

`.scratch/wiki-import-adapters-1.log` passed 29/29 checks. After adding complete
formatted-file/transport bounds and retained directory-import tests,
`.scratch/wiki-import-adapters-2.log` passed **37/37**, zero failures,
cancellations or skips. These runs use real compiled CLI children, the MCP stdio
SDK and Harness ToolRuntime against two synthetic vaults. They cover complete old
fixed-version content; no canonical preparation writes; separate capture and Wiki
approval; current target comparison; exact retries; raw evidence/source state;
private selection and missing source/destination keys; permission tiers; forged
and extra arguments; changed grants; retained-copy use after sharing removal;
actual source/destination waits cancelled through all three entry points;
Harness disposal; and full-result refusal at real CLI/MCP transport boundaries.

The larger retained set passed **63/63** in
`.scratch/wiki-import-adapters-retained.log`, zero failures/cancellations/skips.
Independent read-only review of `6e820526000c4b23b3b178405605ce1cdbb4b659`
covered 14/14 candidate files and the 3/3 preceding core-checkpoint text files,
zero skipped, with no confirmed new P1/P2 in that scope. Scope/rules are retained
in `wiki-import-adapters-review-{preview,rules}.json`.

Minimum Node 20.0 verification has **not passed**. The first combined 37-check
run passed 35 and failed two CLI source-wait cancellation cases
(`wiki-import-adapters-node20.log`). Running that 19-check new adapter file alone
still passed 17 and failed the same two (`wiki-import-adapters-node20-serial-wiki-import-adapters.log`).
An isolated name-filtered diagnostic passed the three CLI cancellation cases,
with 16 unrelated cases explicitly skipped; it is not a passing full file.
The failure also repeats after preceding Harness tests, so cross-file parallelism
is not a sufficient explanation. Additional child-start/exit and read/lock traces
are under investigation; do not classify an empty child stderr as proof of a
runtime or product cause. Product/test deadlines and assertions remain unchanged.
The strict OpenSpec stage after the first failed minimum-runtime run did not run.

There was no failed test in the two Node 22 adapter runs above. Earlier library red/green regression
evidence remains in the [core record](shared-wiki-integration-core-verification-2026-10-26.md).

## Remaining batch work

Web copy/integration controls and their invalidation, HTTP/native-browser checks,
same installed package verification on Node 20/22, both Git defaults, final audit
and complete batch review are pending. Passing the adapter checks does not prove
semantic correctness of arbitrary authored text or independent raw-source verification.

Database changes: none. Data migration: none. Configuration changes: no new config
format or real configuration edits; reuse the existing optional host sharing file.
Stop old readers/writers before enabling new imported evidence/integration records.
