## ADDED Requirements

### Requirement: Experience is immutable evidence, not automatic knowledge
The system SHALL record structured context, actions, observed result, outcome,
task identity and limitations as immutable evidence with existing classification.

#### Scenario: A single successful task
- **WHEN** a caller records one successful execution and prepares a proposal
- **THEN** a signed proposal may be returned but no formal memory or executable skill is automatically created

### Requirement: Validation binds exact procedure and independent tests
The system SHALL run a host-supplied evaluator against a signed current proposal,
requiring distinct successful source tasks and held-out, retention and safety cases.

#### Scenario: Incomplete or unsuccessful validation
- **WHEN** cases overlap training tasks, required coverage is missing, a criterion fails, the callback times out or the operation is cancelled
- **THEN** no passing skill export is possible and no canonical procedure is approved

### Requirement: Export is explicit and respects current authority
The system SHALL require explicit review confirmation and recheck current source,
configuration, classification and key availability before returning skill files.

#### Scenario: Access removed after validation
- **WHEN** a source is unavailable or confidential selection is absent at export
- **THEN** export fails without returning source-derived plaintext or restoring old keys

#### Scenario: Successful explicit export
- **WHEN** current authorized sources and complete passing validation are confirmed
- **THEN** skill files are returned with applicability, limits and validation references, without installation, execution or permission changes
