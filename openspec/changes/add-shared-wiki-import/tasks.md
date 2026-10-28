## Implementation
- [x] Add bounded derived-source artifact schema, deterministic URI and inherited restrictions.
- [x] Add signed preparation and separately confirmed import through current sharing and transaction guards.
- [x] Add human-authored integration preparation using exact local revisions and ordinary separate Wiki approval (library checkpoint in `docs/shared-wiki-integration-core-verification-2026-10-26.md`; adapter and whole-batch gates remain below).
- [x] Add CLI, MCP, Harness and Web adapters with invalidation and separate confirmations (committed candidates independently reviewed; native/package checks passed, while the minimum-runtime aggregate remains below).
- [x] Document local branch checkout setup, provenance, private copies, limits and compatibility in both languages.

## Verification
- [x] Two actual vaults: fixed old version, independent target, no source changes/model calls, full provenance and exact retry.
- [x] Missing/changed authority, keys/grants/pin/content/config, forged/foreign/stale plans and classified destination refusal.
- [x] Actual destination waits crossing lifecycle/cancellation, rollback/readiness/recovery and opposite-source concurrency.
- [x] Imported restrictions survive model omission, manual drafts, approval, ordinary reads and public projection.
- [x] Exact retry after unrelated memory expiry creates no generated housekeeping commit; concurrent identical imports create one artifact.
- [x] All ordinary-memory creation/approval/consolidation/validation/read paths refuse imported artifact support.
- [x] Manual integration creation/update, stale revision, conflicts, source summary and retained local provenance.
- [x] Strict bounded inputs and complete output across real CLI/SDK/HTTP and native browser cleanup behavior.
- [ ] Both Git defaults, same installed package Node 20/22, strict OpenSpec, audit and independent fixed-candidate review.

The first eight checks cover their recorded functional scenarios, not full batch
acceptance. See the [requirement/evidence mapping](../../../docs/shared-wiki-import-recovery-verification-2026-10-28.md#task-verification-mapping).
The last combined gate stays open: the complete minimum Node 20 adapter collection
on macOS still fails 2/37 actual CLI wait observations. The same complete collection
passed 37/37 on Linux Node 20.0.0 under both actually probed defaults
([supplement](../../../docs/shared-wiki-import-linux-verification-2026-10-28.md));
that result does not erase the retained macOS failures or prove their cause.
Do not substitute isolated passing subsets, installed consumers or stronger
recovery tests for the failed macOS result.
