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

#### Scenario: Unchanged page observed with different companions
- **WHEN** repeated observations at one recorded instant include different companion pages or request orders but the requested page and its dependencies are identical
- **THEN** it remains reconstructible and unrelated documents or built-in rules are not mistaken for a conflict or rule change

### Requirement: Current authority constrains observed historical reads
The system SHALL recheck current source readability, lifecycle, classification,
tenant and key availability when returning historical observed content.

#### Scenario: Access is removed after observation
- **WHEN** a selected old version is no longer readable under current policy
- **THEN** its plaintext is not returned and an older version is not used to evade the restriction

#### Scenario: Reading availability
- **WHEN** an authorized caller queries a supported observation
- **THEN** exact verified committed content and observation limits are returned without new writes, model calls or automatic observation

### Requirement: Adapters preserve explicit observation and host authority
The CLI, MCP, Harness and local Web adapters SHALL reuse strict core selection and current
authority, keep cancellation host-owned and distinguish writes from historical reads.

#### Scenario: An agent records an observation
- **WHEN** the caller has current read/write authority and explicitly confirms selected keys
- **THEN** only immutable availability evidence is saved, without caller-supplied time, identity, executable or automatic knowledge approval

#### Scenario: A read-only or cancelled caller attempts to observe
- **WHEN** observation lacks read/write authority or confirmation, or cancellation occurs before the transaction's ready-to-commit decision, including while waiting for a lock
- **THEN** it cannot save an observation and the adapter remains usable for later authorized requests

#### Scenario: Cancellation overlaps an already-decided commit
- **WHEN** cancellation or authority loss is reported after the transaction has entered commit settlement
- **THEN** the caller can distinguish a saved observation by safe evidence/commit identifiers, without assuming cancellation recalls an already-completed save

#### Scenario: An operator changes or leaves a Web selection
- **WHEN** the page's selection changes, a request is stopped, or the operator navigates away or disconnects
- **THEN** stale results and unconfirmed writes cannot revive through late responses, and no automatic observation or retry occurs

#### Scenario: Complete adapter results exceed the transport budget
- **WHEN** complete escaped content exceeds the adapter's result limit
- **THEN** the operation reports an error rather than silently truncating content or showing an incomplete historical view
