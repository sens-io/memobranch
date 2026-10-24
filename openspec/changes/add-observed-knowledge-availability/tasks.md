## Implementation
- [x] Add strict signed availability observations with current source/config/HEAD guards.
- [x] Add bounded as-known-at reconstruction with unknown legacy/ambiguous history.
- [ ] Add appropriate CLI, agent and local management adapters without identity overrides.
- [ ] Document partial coverage, host-clock trust and current-authority limits in both languages.

## Verification
- [ ] Cover forged markers, missing observations, backdated Git commits and timestamp ambiguity.
- [ ] Cover classification, private opt-in before decrypt, current source/key/lifecycle and tenant changes.
- [ ] Cover cancellation, save failures, commit settlement and unchanged query state.
- [ ] Retain existing assertions; test both Git defaults and the same installed artifact on Node 20/22.
- [ ] Independently review committed candidates, resolve confirmed findings and record actual limits.

The core has passed retained, installed Node 20/22 and independent fixed-commit
checks. Adapter tasks and their verification remain open:
[core verification](../../../docs/knowledge-availability-verification-2026-10-24.md).
