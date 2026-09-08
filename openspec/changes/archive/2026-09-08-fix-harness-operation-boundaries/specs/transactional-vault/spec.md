## ADDED Requirements

### Requirement: Cancellation respects durable transaction boundaries
Cancelled pre-ready mutations MUST roll back and release locks. Ready commits, started recovery, and irreversible erasure MUST settle under bounded execution before returning; subsequent work MUST not start under the cancelled invocation.

#### Scenario: Cancellation arrives after the first journaled write
- **WHEN** a transaction has written managed files but has not entered ready phase
- **THEN** cancellation restores the previous managed state, removes its journal and releases the write lock

#### Scenario: Cancellation occurs while waiting for the write lock
- **WHEN** a queued writer is cancelled before acquiring the lock
- **THEN** it removes its queue entry without entering a transaction or affecting the current lock owner
