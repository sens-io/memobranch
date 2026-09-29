## ADDED Requirements

### Requirement: Shutdown owns only its cycle
Maintenance shutdown MUST cancel only its own in-flight cycle, stop scheduling additional work, and retain its lease until that cycle has settled safely.

#### Scenario: A cycle is stopped during recovery
- **WHEN** shutdown starts while recovery is completing a protected operation
- **THEN** shutdown waits for cleanup and no subsequent expiry, indexing or sync step begins

#### Scenario: A provider is shared with another caller
- **WHEN** maintenance stops
- **THEN** unrelated model calls remain active and only the maintenance operation signal is aborted

#### Scenario: Shutdown races with an asynchronous localhost bind
- **WHEN** stop is requested while the startup DNS lookup or listener bind is pending
- **THEN** startup reports cancellation, shutdown waits for any late listener to close, and no lease or scheduling resources survive
