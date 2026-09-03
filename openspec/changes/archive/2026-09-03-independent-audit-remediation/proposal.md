# Change: Independent audit remediation

## Why

A second independent review reproduced seven boundary failures despite the existing test suite and archived verification passing. The failures affect writer exclusion, confidential storage, evidence authorization metadata, cache invalidation, tenant binding, Git metadata, and erasure audit truthfulness. These are release blockers for a production memory service.

## What changes

- Replace racy stale-lock deletion with uniquely owned contender tickets and deterministic single-winner acquisition.
- Reject unencrypted confidential canonical documents during reads, health validation, and remote synchronization.
- Bind evidence sensitivity into its identity and validate evidence before returning it.
- Keep confidential keys out of filenames, commit subjects, and low-clearance history results.
- Require a matching tenant for every non-admin principal.
- Invalidate trusted search state across processes after completed mutations.
- Persist a non-plaintext commitment to the supplied erasure reason and report legacy intents truthfully.
- Add adversarial regressions for each reproduced failure while retaining the existing behavior suite.

## Impact

Affected code includes `src/utils.ts`, `src/policy.ts`, `src/types.ts`, `src/vault.ts`, `src/search.ts`, and regression tests. New evidence IDs include sensitivity in their digest. Local administrators remain an explicit tenant-binding exception; non-admin services must configure `AMEM_TENANT_ID`.
