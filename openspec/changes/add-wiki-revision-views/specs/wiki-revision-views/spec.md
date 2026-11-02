## ADDED Requirements

### Requirement: Explicit bounded committed Wiki reads
The system SHALL provide local read-only views at a full ancestor commit, returning complete selected pages and required dependencies with exact historical and current revision identities, source hashes, rule versions and historical warnings.

#### Scenario: Inspect old compiled knowledge after an update
- **WHEN** an authorized caller selects a prior local commit and currently available page keys
- **THEN** the result contains the original compiled text and dependency versions without changing canonical files, refs, index, keys or invoking a model
- **AND** invalid refs, foreign or nonancestor commits, missing paths and exceeded limits fail without a partial result

### Requirement: Current authority governs every historical dependency
The system SHALL validate both historical provenance and current tenant, permissions, classifications, lifecycle and encryption under the existing reader/writer lock; old revisions SHALL NOT restore access.

#### Scenario: A supporting record loses access
- **WHEN** a historical page or any historical dependency is currently revoked, expired, erased, unauthorized or requires confidential opt-in that was not given
- **THEN** reading the historical view fails without returning page bodies or restoring old keys

#### Scenario: Concurrent writes and cancellation
- **WHEN** writes compete with a revision read, recovery is pending, managed data changes outside the lock, or the read is cancelled
- **THEN** the read uses one settled current authority snapshot or fails without a canonical mutation or leaked writer lock
