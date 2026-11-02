## Implementation
- [x] Extend the existing snapshot operation with strict exclusive recorded-time selection and additive public types.
- [x] Preserve first-parent selection, bounded local reads, current access, lifecycle and cancellation.
- [x] Expose the same selector in CLI, MCP, Harness and authenticated HTTP without new automatic behavior.
- [x] Document exact semantics and retain the explicit-hash contracts.

## Verification
- [x] Cover real dates, timezone/boundary/tie/clock/merge behavior and unavailable versions.
- [x] Cover current authority, private data, keys, cancellation, cleanup, drift and traversal bounds.
- [x] Run retained checks, both Git defaults, same-package minimum-runtime consumers, strict specs and audit.
- [x] Independently review fixed commits, resolve confirmed issues and record results and limits.

Acceptance evidence and remaining limits: [verification record](../../../docs/dated-wiki-views-verification-2026-10-22.md).
