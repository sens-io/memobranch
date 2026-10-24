## Implementation
- [ ] Implement strict bounded host bindings and explicit reader identity matching.
- [ ] Implement current-authority capped pinned source reads and catalog without network or canonical writes.
- [ ] Recheck caller/grant changes, confidentiality, source keys/lifecycle and cancellation.
- [ ] Add library, CLI, MCP, Harness and local Web management adapters.
- [ ] Document setup, current-local revocation and offline-copy limits in both languages.

## Verification
- [ ] Use two actual synthetic Git vaults; advance source content and prove the configured pin stays fixed.
- [ ] Reject missing/foreign readers, tenants, scopes, elevated sensitivity and caller-supplied paths/commits/identity.
- [ ] Cover secret opt-out before decrypt, explicit key configuration, erased keys, source withdrawal/expiry and dirty/pending sources.
- [ ] Cover malformed/oversized/symlink host files, changed bindings during reads, cancellation and opposite-source concurrency.
- [ ] After a real source read, wait for the caller's final lock past current/historical expiry and refuse the assembled result.
- [ ] Preserve source/caller evidence, heads, refs and indexes across ordinary reads.
- [ ] Verify real adapters, native Web behavior, both Git defaults and the same installed package on Node 20/22.
- [ ] Independently review fixed candidates and resolve confirmed findings before local acceptance.
