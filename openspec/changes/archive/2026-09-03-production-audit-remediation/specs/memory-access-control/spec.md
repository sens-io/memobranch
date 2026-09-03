# Memory Access Control Delta

## ADDED Requirements

### Requirement: Derived knowledge preserves provenance restrictions
An extracted or proposed memory that cites evidence MUST NOT have a broader scope or lower sensitivity than that evidence, regardless of model output.

#### Scenario: Model attempts to downgrade secret evidence
- **WHEN** an extractor returns a public candidate from secret evidence
- **THEN** the persisted candidate remains secret and no plaintext enters Git or generated artifacts

### Requirement: Every read is tenant-bound
Every document, history, resident-context, search, and answer operation MUST validate the configured vault tenant before returning or sending content.

#### Scenario: Principal belongs to another tenant
- **WHEN** a principal with otherwise sufficient permissions calls get, history, context, or answer
- **THEN** the request fails with an authorization error before content is returned or sent to a provider
