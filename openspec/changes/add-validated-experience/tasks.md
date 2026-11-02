## Implementation
- [x] Implement immutable trace capture and signed bounded procedure proposals.
- [x] Implement trusted-host validation with coverage, deadline, cancellation and revalidation.
- [x] Implement explicit skill export without installation or execution.
- [x] Add CLI capture/prepare/export without arbitrary evaluator execution.
- [x] Add applicable MCP/Harness adapters without agent-selected evaluators.
- [x] Add the management workflow with explicit review and no server-side arbitrary execution.
- [x] Document core/CLI claims and confidential export limits in both languages.

## Verification
- [x] Cover source/config/tenant/permission changes, private opt-in and erasure.
- [x] Cover single anecdotes, duplicate training tasks, missing held-out/retention/safety cases and forged reports.
- [x] Cover failed checks, timeout, cancellation, concurrent mutations and immutable raw evidence.
- [x] Validate generated skill format and exercise an isolated synthetic workflow.
- [x] Run core/CLI retained checks under both Git defaults and installed Node 20/22 package consumers; repeat for adapter changes.
- [x] Independently review fixed core/CLI commits and resolve confirmed findings; review subsequent adapters separately.

Core/CLI checkpoint and exact remaining scope: [verification record](../../../docs/validated-experience-core-verification-2026-10-22.md).

MCP/Harness retained, installed Node 20/22 and independent review checks:
[agent adapter checkpoint](../../../docs/validated-experience-agent-verification-2026-10-23.md).

Web retained/installed checks, native-browser workflow and responsive evidence:
[Web verification record](../../../docs/validated-experience-web-verification-2026-10-23.md).
