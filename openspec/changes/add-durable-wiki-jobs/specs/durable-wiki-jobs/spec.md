## ADDED Requirements

### Requirement: Compilation is explicit and separate from approval
The system MUST persist local compilation jobs from authorized existing evidence, report actual state and retain only encrypted operational payloads outside canonical Git. It MUST NOT fetch sources or automatically approve Wiki plans.

#### Scenario: A queued job completes after the submitter exits
- **WHEN** a separately invoked worker compiles the saved evidence IDs
- **THEN** it saves an encrypted signed plan for explicit inspection and leaves evidence/Wiki/Git unchanged

### Requirement: Jobs preserve current authority and source validity
Jobs MUST bind vault, tenant, owner and enqueue-time context ceilings, check current authority before provider calls, and validate signed proposals against current state before returning content.

#### Scenario: Permissions or knowledge change after submission
- **WHEN** a worker runs or a caller reads a completed plan
- **THEN** lost authority or changed snapshots fail safely, while increased authority cannot expand the queued context

### Requirement: Workers are bounded and recoverable
Jobs MUST bound attempts, retained state and attempt time, uniquely claim active work, distinguish live/dead workers, and persist cancellation. Dead claims MUST NOT be automatically retried or stolen from live processes.

#### Scenario: A worker dies or cancellation races with completion
- **WHEN** a subsequent worker examines the claim or the active worker publishes its result
- **THEN** token/current-cancellation checks prevent late publication and explicit retry remains distinct from automatic retry

### Requirement: Erasure clears cached derived content
Canonical cryptographic erasure MUST invalidate retained proposals and in-flight jobs before canonical key destruction, destroy cached-plan data keys and prevent a late result from restoring erased content.

#### Scenario: Erasure interrupts a job-key rotation
- **WHEN** recovery resumes with an unreadable old job file
- **THEN** it discards the unreadable cache rather than restoring plaintext or blocking canonical erasure forever

#### Scenario: A killed publication leaves an unpublished temporary plan
- **WHEN** a ready temporary file was synchronized before process death, the visible job was recovered as failed, and canonical erasure runs
- **THEN** erasure rotates every retained job key so the temporary plan is unreadable, while preserving content-free queued and failed records' status and metadata
