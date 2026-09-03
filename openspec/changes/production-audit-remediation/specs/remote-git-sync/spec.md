# Remote Git Sync Delta

## ADDED Requirements

### Requirement: Synchronization failure restores local state
After beginning remote integration, failure during reconcile, validation, final status, or push MUST restore the pre-sync local revision and managed working state.

#### Scenario: Remote fast-forward contains invalid managed state
- **WHEN** post-integration validation fails
- **THEN** synchronization returns a typed conflict and local HEAD and managed files match the pre-sync snapshot

### Requirement: Remote configuration is atomic
Git remote configuration and tracked vault configuration MUST change as one compensatable operation under the writer lock.

### Requirement: Persisted remote URLs contain no credential channels
Remote URLs containing userinfo, query parameters, fragments, or unsafe SCP usernames MUST be rejected before Git or tracked configuration is changed.
