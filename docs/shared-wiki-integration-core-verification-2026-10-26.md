# Human-authored imported Wiki integration — core candidate

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Baseline: `d8938c1b8de638b5d6df6b7714e9677f7f52466c` (accepted cloud batch).
This is the library integration core in roadmap batch 4, not whole-batch
acceptance, a published npm feature or deployment. Import adapters, bilingual
delivery, installed-package/native-browser gates and the remaining roadmap work
are still pending.

## Behavior and boundaries

`MemoryVault.wikiIntegrationPrepare` reads a separately confirmed local import,
accepts authored title/summary/body and an exact target revision (zero creates),
and returns the full artifact/current-target comparison, a signed `integrate`
plan and ordinary Wiki preview. It performs no model call or canonical write.
Existing separate Wiki review is required to apply the plan. A new source summary
links to the complete immutable artifact; valid existing summaries are retained.

The normal Wiki engine retains local evidence, links and all imported/local
classification, conditions, uncertainty, unresolved conflict and lifecycle.
Authors may add caveats, mark conflict and make classification stricter, including
secret authored text supported by an internal source. Private inputs/outputs need
explicit selection and keys. This operation cannot clear an existing conflict.
It makes no claim to detect arbitrary semantic contradictions or independently
verify original raw sources. Copied artifacts remain explicitly identified as
compiled material that cannot be recalled through a later remote grant change.

Approval checks the current local artifact, source body hash, configuration,
permissions and time. The target records the signed plan's origin hash for a
successful no-op retry. Old programs reject the new plan kind. No database or
existing-record migration is performed, and no real grant/configuration is edited.

## Verification so far

- Build and all test types passed (`wiki-integration-build-5.log`,
  `wiki-integration-types-5.log`).
- `.scratch/wiki-integration-core-3.log`: **47/47** combined checks passed,
  including 8 new integration cases and retained import/historical-merge cases;
  zero failed/cancelled/skipped. This is not a full repository check.
- New cases cover creation and exact retry; update comparison and local evidence;
  current imported conflict; strict/reserved/malformed inputs; independent
  preparation/application permissions; edited/foreign/stale plans; retained
  offline copies; private selection, missing keys and encrypted pages; author
  classification/caveats; actual lock-wait cancellation, cloned inputs and changed
  authority; and source expiry during an actual approval wait without partial Wiki.
- Preparation compares both source/caller canonical HEADs, refs, indexes and
  status; source state and a copied evidence file are retained after application.
  The fixture source model counter stays unchanged and the destination model
  method throws if invoked. Fixtures are synthetic, not a semantic-quality test.

Retain development failures: the first build missed two new imports (fixed);
`wiki-integration-core-1.log` passed 5/6, failing because the test expected a
nonexistent key-error code instead of the existing `ENCRYPTION_KEY_UNAVAILABLE`.
`wiki-integration-core-2.log` passed 45/46: its synthetic clock jump crossed the
existing lock deadline as well as source expiry, giving `LOCK_TIMEOUT`. The
fixture now expires before that deadline and still requires `VALIDATION_FAILED`;
product deadlines and assertions were not loosened.

Compiled Node 20 checks and broader retained Wiki checks are in progress.
Independent fixed-candidate review, package/native adapter verification and
complete checks under both Git defaults remain to be recorded before batch 4
acceptance. No push, publication, real account/service or deployment occurred.
