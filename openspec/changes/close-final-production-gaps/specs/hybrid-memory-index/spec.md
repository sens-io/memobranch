## ADDED Requirements

### Requirement: Cached retrieval is bound to canonical source state

Before reusing an in-memory search snapshot, the system MUST verify that the canonical Wiki file set and source identities still match the indexed state. Returned hits MUST be reread through the authorized canonical reader before snippets are emitted.

#### Scenario: Canonical clearance changes without an index update

- **WHEN** an indexed public document becomes internal while a public reader retains an in-memory index
- **THEN** the next query rebuilds or fails closed and does not return the document

#### Scenario: Revocation commits but index refresh fails

- **WHEN** a memory revocation commits and the following index persistence fails
- **THEN** the mutation may report its durable commit but subsequent retrieval does not use the stale snapshot
