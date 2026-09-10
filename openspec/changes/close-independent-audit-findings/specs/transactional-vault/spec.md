## ADDED Requirements

### Requirement: Operation commits exclude unrelated staging
Operation commits MUST include only their journaled changes and preserve unrelated staged and unstaged work.

#### Scenario: Instructions were independently staged before capture
- **WHEN** evidence capture commits its files
- **THEN** the unrelated instructions edit is absent from that commit and remains staged

### Requirement: Sync recovery precedes journal replay
Interrupted or failed synchronization MUST retain its original snapshot until restoration succeeds, and MUST restore that snapshot before replaying ordinary journals.

#### Scenario: Git index lock prevents rollback
- **WHEN** reconciliation fails and the snapshot cannot be restored immediately
- **THEN** recovery information remains durable, writers fail closed, and recovery after lock removal restores the original revision and retires rejected sync journals
