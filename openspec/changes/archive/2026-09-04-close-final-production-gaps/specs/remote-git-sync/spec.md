## MODIFIED Requirements

### Requirement: Synchronization failure restores local state

Before a push succeeds, failure during integration, reconciliation, validation, status, or transport MUST restore the pre-sync local revision and managed state. After a push succeeds, later status or local-bookkeeping failure MUST retain the matching pushed local revision because the external state cannot be rolled back safely.

#### Scenario: Final status fails after a successful push

- **WHEN** the remote accepts the local revision and the subsequent status refresh fails
- **THEN** synchronization returns a typed error while local HEAD and remote branch both remain at the pushed revision

#### Scenario: Push itself fails

- **WHEN** the remote does not accept the push
- **THEN** synchronization restores the pre-sync local revision, managed files, and synchronization state
