## ADDED Requirements

### Requirement: Availability has explicit immutable evidence
The system SHALL record a signed, bounded local availability observation only on
an explicit authorized write, binding committed documents and their dependencies.

#### Scenario: An operator observes selected current pages
- **WHEN** current source, classification, tenant and write authority all pass
- **THEN** immutable availability evidence is saved without approving or modifying the observed knowledge

#### Scenario: State changes while saving
- **WHEN** source, HEAD, configuration, current permission or required key changes before the save decision
- **THEN** stale observations are not saved and completed saves remain distinguishable from uncommitted failures

### Requirement: Historical reconstruction never guesses knowledge from Git dates
The system SHALL use verifiable availability observations, not Git or page dates,
to select explicitly observed content at a requested time.

#### Scenario: Legacy history or forged observations
- **WHEN** no readable verifiable observation supports a requested key and time
- **THEN** the result states that availability is unknown rather than inferring it from a backdated commit

#### Scenario: Conflicting observations share an instant
- **WHEN** different observed content for a key has the same latest eligible recorded instant
- **THEN** the result is explicitly ambiguous rather than choosing by filesystem order

### Requirement: Current authority constrains observed historical reads
The system SHALL recheck current source readability, lifecycle, classification,
tenant and key availability when returning historical observed content.

#### Scenario: Access is removed after observation
- **WHEN** a selected old version is no longer readable under current policy
- **THEN** its plaintext is not returned and an older version is not used to evade the restriction

#### Scenario: Reading availability
- **WHEN** an authorized caller queries a supported observation
- **THEN** exact verified committed content and observation limits are returned without new writes, model calls or automatic observation
