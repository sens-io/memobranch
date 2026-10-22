## Implementation
- [ ] Extend the existing snapshot operation with strict exclusive recorded-time selection and additive public types.
- [ ] Preserve first-parent selection, bounded local reads, current access, lifecycle and cancellation.
- [ ] Expose the same selector in CLI, MCP, Harness and authenticated HTTP without new automatic behavior.
- [ ] Document exact semantics and retain the explicit-hash contracts.

## Verification
- [ ] Cover real dates, timezone/boundary/tie/clock/merge behavior and unavailable versions.
- [ ] Cover current authority, private data, keys, cancellation, cleanup, drift and traversal bounds.
- [ ] Run retained checks, both Git defaults, same-package minimum-runtime consumers, strict specs and audit.
- [ ] Independently review fixed commits, resolve confirmed issues and record results and limits.
