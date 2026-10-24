## Implementation
- [x] Add strict signed availability observations with current source/config/HEAD guards.
- [x] Add bounded as-known-at reconstruction with unknown legacy/ambiguous history.
- [x] Add appropriate CLI, agent and local management adapters without identity overrides.
- [x] Document partial coverage, host-clock trust and current-authority limits in both languages.

## Verification
- [x] Cover forged markers, missing observations, backdated Git commits and timestamp ambiguity.
- [x] Cover classification, private opt-in before decrypt, current source/key/lifecycle and tenant changes.
- [x] Cover cancellation, save failures, commit settlement and unchanged query state.
- [x] Retain existing assertions; test both Git defaults and the same installed artifact on Node 20/22.
- [x] Independently review committed candidates, resolve confirmed findings and record actual limits.

The core has passed retained, installed Node 20/22 and independent fixed-commit
checks:
[core verification](../../../docs/knowledge-availability-verification-2026-10-24.md).

CLI/MCP/Harness/Web retained, installed, native-browser and independent fixed-candidate
review checks also passed locally; the final checkpoint text receives a separate review:
[adapter verification](../../../docs/knowledge-availability-adapters-verification-2026-10-24.md).
