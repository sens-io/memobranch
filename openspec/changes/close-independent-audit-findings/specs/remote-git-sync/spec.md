## ADDED Requirements

### Requirement: Remote compensation completes inside the writer boundary
Remote configuration compensation MUST settle before the writer lock is released. Known failed pre-commit updates MUST restore both configurations; successful or uncertain commits MUST not be misclassified as safe to roll back.

#### Scenario: Two configuration writers overlap
- **WHEN** the first fails and the second succeeds
- **THEN** delayed compensation from the first cannot overwrite the second's Git remote

### Requirement: Snapshot restoration is durable and checked
Synchronization MUST persist recovery information before losing its original state, check restoration results, and retain recovery information across reset or cleanup failure. Accepted or uncertain pushes MUST not be blindly rolled back.

#### Scenario: Rejected remote configuration is unreadable
- **WHEN** rollback is interrupted after receiving an invalid or changed-tenant configuration
- **THEN** an authorized recovery can validate the original snapshot tenant and restore it without trusting the rejected configuration or disclosing it to another tenant
