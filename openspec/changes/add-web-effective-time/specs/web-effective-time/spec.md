## ADDED Requirements

### Requirement: Explicit time presentation
The Web console MUST distinguish ordinary-memory lifecycle from interval applicability, expose unknown endpoints without inferring dates, and label timestamp controls as UTC while preserving millisecond precision.

#### Scenario: An approved record has a future start or ended interval
- **WHEN** its list row or detail is displayed
- **THEN** the time warning remains visible despite its active lifecycle status

### Requirement: Review-bound annotation
Only current reviewers MAY submit ordinary-memory time changes. Both nullable bounds, the displayed canonical revision and explicit confirmation MUST be sent. Failed or ambiguous writes MUST require a fresh read before another attempt.

#### Scenario: A concurrent edit changes the displayed revision
- **WHEN** a reviewer confirms the old form
- **THEN** the server refuses it, the UI does not automatically retry and the next attempt requires rereading the current record

### Requirement: Honest dated reads
The dated panel MUST use the existing authorized retained-record API, distinguish it from historical reconstruction, preserve status/source/uncertainty, default unknown inclusion off and paginate with the returned limit.

#### Scenario: The vault caps results below the UI's requested page size
- **WHEN** the reader requests the next page
- **THEN** the offset advances by the actual returned limit, using the last submitted criteria

### Requirement: Owned asynchronous UI work
Late reads MUST NOT overwrite newer results or disconnected sessions. Closing an editor MUST NOT trigger a deferred write. A successful commit MUST NOT be reported as failed merely because a later refresh fails.

#### Scenario: An older query completes after a newer query or logout
- **WHEN** its response arrives
- **THEN** it cannot render, restore prior session content or initiate a mutation
