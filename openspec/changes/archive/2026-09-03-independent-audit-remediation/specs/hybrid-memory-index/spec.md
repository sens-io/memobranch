# Hybrid Memory Index Delta

## ADDED Requirements

### Requirement: Search cache observes completed external mutations
A long-lived process MUST invalidate its trusted in-memory index before the next query when another process has completed an index replacement.

#### Scenario: Another process revokes a cached memory
- **WHEN** one vault process completes revocation after a second process cached the active record
- **THEN** the second process's next query reloads trusted state and does not return the revoked memory
