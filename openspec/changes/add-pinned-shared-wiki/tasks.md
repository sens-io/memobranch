## Implementation
- [x] Implement strict bounded host bindings and explicit reader identity matching.
- [x] Implement current-authority capped pinned source reads and catalog without network or canonical writes.
- [x] Recheck caller/grant changes, confidentiality, source keys/lifecycle and cancellation.
- [x] Add library, CLI, MCP, Harness and local Web management adapters.
- [x] Document setup, current-local revocation and offline-copy limits in both languages.

## Verification
- [x] Use two actual synthetic Git vaults; advance source content and prove the configured pin stays fixed.
- [x] Reject missing/foreign readers, tenants, scopes, elevated sensitivity and caller-supplied paths/commits/identity.
- [x] Cover secret opt-out before decrypt, explicit key configuration, erased keys, source withdrawal/expiry and dirty/pending sources.
- [x] Cover malformed/oversized/symlink host files, changed bindings during reads, cancellation and opposite-source concurrency.
- [x] After a real source read, wait for the caller's final lock past current/historical expiry and refuse the assembled result.
- [x] Preserve source/caller evidence, heads, refs and indexes across ordinary reads.
- [x] Verify real adapters, native Web behavior, both Git defaults and the same installed package on Node 20/22.
- [x] Independently review fixed candidates and resolve confirmed findings before local acceptance.
