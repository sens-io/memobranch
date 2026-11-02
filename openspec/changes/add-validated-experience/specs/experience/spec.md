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

### Requirement: Agent tools preserve host-owned execution authority
The system SHALL expose capture, proposal preparation and confirmed export with
the core's current permissions and strict input schemas, without accepting an
agent-selected evaluator or prefilled passing validation.

#### Scenario: An agent supplies execution or identity overrides
- **WHEN** a tool input includes a runner, module path, tenant or permission override
- **THEN** the input is refused before canonical mutation and no evaluator is executed

#### Scenario: A permitted agent exports a host-validated procedure
- **WHEN** the caller has current read/review authority and explicitly confirms a valid stored validation ID
- **THEN** complete bounded skill files are returned, with no installation or execution

### Requirement: Local management separates observation, validation and export
The system SHALL provide explicit experience management without accepting an
executable evaluator from the browser or automatically installing exported files.

#### Scenario: The default server has no trusted evaluator
- **WHEN** the operator opens experience management or requests validation
- **THEN** the page explains the unavailable evaluator and the request cannot produce a passing validation

#### Scenario: Private listing and changed drafts
- **WHEN** confidential records are not explicitly selected, or the operator changes a prepared draft or leaves the page
- **THEN** unselected confidential bodies are not decrypted and stale validation/export controls cannot be used

#### Scenario: Explicit host validation and separate export
- **WHEN** a configured trusted host evaluator completes the core's required cases
- **THEN** immutable validation evidence is saved and plaintext files require a separate confirmation and download action
