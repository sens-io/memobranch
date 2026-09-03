# Remote Git Sync Delta

## ADDED Requirements

### Requirement: Synchronization failure restores local state
After beginning remote integration, failure during reconcile, validation, final status, or push MUST restore the pre-sync local revision and managed working state.

#### Scenario: Remote fast-forward contains invalid managed state
- **WHEN** post-integration validation fails
- **THEN** synchronization returns a typed conflict and local HEAD and managed files match the pre-sync snapshot

### Requirement: Remote configuration is atomic
Git remote configuration and tracked vault configuration MUST change as one compensatable operation under the writer lock.

#### Scenario: Tracked configuration cannot be committed
- **WHEN** remote configuration succeeds but the vault configuration transaction fails
- **THEN** the previous Git remote and tracked vault configuration are both restored

### Requirement: Persisted remote URLs contain no credential channels
Remote URLs containing userinfo, query parameters, fragments, or unsafe SCP usernames MUST be rejected before Git or tracked configuration is changed.

#### Scenario: A remote URL embeds credentials
- **WHEN** a caller supplies userinfo, a query, a fragment, or an unsafe SCP username
- **THEN** configuration is rejected before either Git or tracked vault state changes
