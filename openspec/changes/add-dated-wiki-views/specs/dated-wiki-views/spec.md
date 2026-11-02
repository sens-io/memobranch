## ADDED Requirements

### Requirement: Wiki revisions can be selected by explicit recorded time
The system SHALL accept exactly one full local commit hash or an ISO `at` timestamp, and SHALL return complete authorized committed content without inferring fact-effective dates or historical agent knowledge.

#### Scenario: A timestamp between two committed versions
- **WHEN** a reader selects a time between two versions
- **THEN** the first eligible current first-parent ancestor by committer timestamp is returned with its actual hash and normalized selection metadata
- **AND** no model call, canonical write, ref/index change or automatic approval occurs

#### Scenario: Invalid or ambiguous selection
- **WHEN** both selectors, neither selector, invalid dates or extra host authority fields are submitted
- **THEN** the input is rejected without returning partial content

### Requirement: Date resolution is deterministic and bounded
The system SHALL examine at most 2000 first-parent entries and SHALL not rely on author time, source dates or a chronology shortcut that hides eligible ancestors.

#### Scenario: Ties, non-monotonic clocks and merge ancestry
- **WHEN** committer clocks tie or run backwards, or a merge has a dated side parent
- **THEN** ancestry-first selection remains deterministic and side-parent entries are not separately selected
- **AND** the result warns that mutable Git clocks do not establish historical truth

#### Scenario: No matching version within the bound
- **WHEN** no examined entry is eligible
- **THEN** the request fails unavailable, or too large if the traversal bound was reached with older entries remaining
- **AND** it does not fetch or silently choose an unrelated version

### Requirement: Current authority and lifecycle govern dated reads
The system SHALL reuse the committed revision reader's current and historical provenance, keys, confidential selection and lifecycle constraints, including after asynchronous cleanup.

#### Scenario: Old content is no longer accessible
- **WHEN** the selected page or required support is withdrawn, expired, erased or unauthorized now
- **THEN** dated reads cannot restore or disclose it even when `at` predates the restriction

#### Scenario: Cancellation or concurrent external changes
- **WHEN** an invocation is cancelled while waiting/reading, or HEAD/managed state changes before final validation
- **THEN** no partial view is returned, owned resources are released and another owner's lock or writes are preserved

### Requirement: Adapters preserve explicit-hash behavior
The system SHALL expose recorded-time selection through the existing snapshot interfaces without changing prior hash-read output or result limits.

#### Scenario: A client explicitly reads a known hash
- **WHEN** an existing caller uses only `commit`
- **THEN** its previous complete result shape and validation remain supported without a recorded-time selection field
