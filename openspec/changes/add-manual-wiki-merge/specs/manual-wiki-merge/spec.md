## ADDED Requirements

### Requirement: Manual historical merge proposals preserve provenance
The system SHALL prepare a bounded signed local proposal from an authorized ancestor revision and an existing current compiled Wiki page without changing canonical knowledge or calling a model.

#### Scenario: An operator combines two versions
- **WHEN** an authorized writer supplies a complete ancestor commit, target key, expected current revision and authored merged body/summary
- **THEN** the response shows the historical graph, current target and full before/after review
- **AND** both versions' sources, conditions, uncertainty, conflicts and stricter access/expiry limits are retained without creating new independent evidence

### Requirement: Approval remains current and explicit
The system SHALL apply a merge only through existing review authority, current signed input checks and an atomic transaction, and SHALL safely recognize an unchanged successful retry.

#### Scenario: A proposal becomes unsafe or stale
- **WHEN** its body/proof is edited, current inputs change, support is withdrawn/erased, time eligibility ends or approval lacks authority
- **THEN** preview/application rejects without partial canonical writes or restoring old access

#### Scenario: A reviewer accepts a valid proposal
- **WHEN** a currently authorized reviewer explicitly applies the unchanged signed plan
- **THEN** all declared dependent changes and the audit log are committed atomically
- **AND** an identical retry does not create another revision or commit

### Requirement: Confidential choices survive the workflow
The system SHALL use the signed confidential document choices consistently in preparation, preview and application, without exposing excluded unrelated catalog metadata.

#### Scenario: Private content is not selected
- **WHEN** sensitive or secret content was not explicitly selected or exceeds current authority
- **THEN** selected Wiki reads do not decrypt it or include it in the proposal boundary, and unavailable required support causes failure rather than silent omission
- **AND** application retains the existing host-side whole-vault transaction integrity checks, without exposing excluded content in the plan or result
