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
permissions and time. The target's origin hash records provenance. Signed existing
Wiki completion records with a new integration discriminator bind the actual
affected graph and support for a successful no-op retry. Old programs reject the
new plan kind and integration completion discriminator. No database or
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

The initial `1c12f075ff4335365f0e0944b06bf8a312251ff9` candidate also passed
47/47 compiled Node 20.0 checks (`wiki-integration-node20.log`) and 183/183
broader retained Wiki checks (`wiki-integration-retained-1.log`). These passing
checks did not cover the later confirmed review boundaries below.

## Independent review and fixes under verification

Two read-only reviewers covered the fixed candidate's 6/6 source files and 5/5
test/documentation files, zero skipped. Local OCR scope/rules are retained in
`.scratch/wiki-integration-review-{preview,rules}.json`; no external model was
used by OCR. The root agent also checked the target's origin-only replay path.

| Source branch | Confirmed issue | Correction |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Ordinary preview lacked a final integration time check after outer lock cleanup. | Signed effective-time limits are checked after cleanup and at final commit/replay boundaries. |
| `kevin/knowledge-expansion` | A successful replay could rebuild an unrelated expired memory's projections and create a commit. | The existing mutation no-commit rollback path now handles successful Wiki replays before projection rebuilding. |
| `kevin/knowledge-expansion` | A retained origin hash could accept an already edited target as an unchanged integration. | Signed completion records bind actual affected pages, dependency closure, evidence and rules; unrelated later knowledge remains independent. |
| `kevin/knowledge-expansion` | The spec still prohibited all networks despite accepted remote confirmation. | Distinguish local v1 from bounded fresh reads of host-configured cloud/Git bindings. |
| `kevin/knowledge-expansion` | Allowed fields could produce a plan above the documented 1 MB UTF-8 bound. | Check the complete plan before signing and on preview/application; never truncate. |

All three executable regressions genuinely failed against `1c12f075` in
`wiki-integration-review-red.log` (0/3 passed). After the fix they passed 3/3 in
`wiki-integration-review-green-2.log`. The first fix run passed 1/3: receipt
validation correctly rejected an identity not matching the old compile-only
canonical formula (`wiki-integration-review-green-1.log`). Integration completion
identity and its optional operation tag are now explicit in the existing receipt
schema; ordinary compilation receipts retain their old identities/format.

`wiki-integration-review-combined-1.log` subsequently passed **235/235** related
and retained checks, zero failures/cancellations/skips. This includes independent
local-conflict retention and a true whole-plan UTF-8 bound before signing, plus
above-limit preview/application refusal. Build/test types passed in
`wiki-integration-build-8.log` / `wiki-integration-types-8.log`.

The `5ef7740894a46fad002a365bb3bf9488f806e8b8` fix also passed all 52/52
compiled Node 20.0 checks (`wiki-integration-fixed-node20.log`), zero failed,
cancelled or skipped. Documentation/test re-review covered 5/5 files with zero
skipped and closed its contract/coverage findings. Source re-review covered 5/5,
zero skipped, and confirmed the preview, actual-content receipt and projection
rollback fixes. It identified one remaining final replay boundary below.

That replay still checked time before the outer mutation lock's asynchronous
cleanup. `wiki-integration-replay-cleanup-red.log` genuinely failed 0/1 against
`5ef77408`. Duplicate-only validation now also runs after the mutation returns;
normally committed operations retain their existing safe-commit semantics.
`wiki-integration-replay-cleanup-green.log` passed 1/1. All earlier regressions
remain. The final 236-check combined run, 53-check compiled Node 20 run and this
last fix's independent review are still in progress.

Package/native adapter verification and
complete checks under both Git defaults remain to be recorded before batch 4
acceptance. No push, publication, real account/service or deployment occurred.
