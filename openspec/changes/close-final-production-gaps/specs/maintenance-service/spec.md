## ADDED Requirements

### Requirement: Lease release is owner protected

Only the service instance whose owner token is recorded in the active lease MAY update or remove that lease.

#### Scenario: Unstarted instance is stopped

- **WHEN** an unrelated service object for the same vault is stopped
- **THEN** the active daemon lease remains intact and a second daemon receives the typed already-running error

### Requirement: Operational counters preserve concurrent updates

Audit rotation/append and metrics read-modify-write operations MUST be serialized across processes.

#### Scenario: Many operations increment one counter concurrently

- **WHEN** one hundred accepted increments execute concurrently
- **THEN** the resulting counter increases by one hundred without malformed state or lost updates
