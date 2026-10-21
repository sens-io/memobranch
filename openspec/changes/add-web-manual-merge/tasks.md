## Implementation
- [x] Add bounded authenticated revision and merge preparation routes without widening core authority.
- [x] Add historical/current comparison, manual editing and separate proof-bound approval.
- [x] Preserve lifecycle cleanup, stale-response refusal, input invalidation and honest outcome reporting.

## Verification
- [x] Cover HTTP boundaries and shipped UI events, including failures and concurrent edits/navigation.
- [x] Run browser, installed Node20/22, both Git defaults, strict specs and production audit.
- [x] Independently review committed candidates and resolve confirmed findings.

Evidence and limitations: [verification report](../../../docs/web-manual-merge-verification-2026-10-21.md).
