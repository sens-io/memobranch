## ADDED Requirements

### Requirement: Git discovery preserves host command selection and execution bounds

On macOS the system MUST avoid spawning failed executable-search candidates for
ordinary Git calls by selecting the executable from the invocation's current
PATH and working directory. It MUST retain search order, executable permissions,
relative and empty entries, symlink traversal, the child environment and argv0.
It MUST NOT cache a selection across environment changes, retry an executed Git
operation, extend the configured total deadline or lose cancellation evidence.
Other platforms MUST retain their existing invocation behavior.

#### Scenario: Long inherited search path
- **WHEN** the original macOS Node 20 complete adapter collections run after repeated Git activity with the inherited application PATH
- **THEN** all original assertions pass under both actual Git defaults without a shortened PATH, preload, restart, longer waiter or changed skip condition

#### Scenario: Caller changes the selected Git
- **WHEN** PATH order, executable permissions or the working directory changes between Git calls
- **THEN** the next call selects the current first executable and retains its complete original child environment

#### Scenario: Relative and empty search entries
- **WHEN** PATH contains relative entries, an empty entry or a symlink followed by a parent-directory segment
- **THEN** lookup uses the child working directory and preserves filesystem traversal semantics

#### Scenario: Selected executable cannot start
- **WHEN** a selected executable fails before any process starts with a search-continuable failure
- **THEN** the original search may be delegated once within the remaining deadline, while an executed Git operation is never retried

#### Scenario: Discovery is interrupted before a push starts
- **WHEN** executable discovery is cancelled or reaches the configured deadline
- **THEN** no Git command starts, the original cancellation/timeout and commit evidence is preserved, and a push reports that it did not start

#### Scenario: Caller reuses an argument array
- **WHEN** the caller changes its argument array while executable discovery is pending
- **THEN** the invocation executes and classifies errors using the original argument values
