## ADDED Requirements

### Requirement: Git subprocess execution is bounded and cancellable
All Git subprocesses MUST have a finite execution deadline, disable terminal credential prompts, and terminate owned transport subprocesses on cancellation or timeout. Cleanup and necessary rollback MUST finish before the caller releases its vault lock. Successful pushes MUST not be locally rolled back after late cancellation.

#### Scenario: SSH transport does not exit normally
- **WHEN** a Git transport exceeds its deadline or its invocation is cancelled
- **THEN** the Git process and owned helper processes are terminated and cancellation or timeout is not swallowed by allow-failure probes

#### Scenario: Cancellation follows a successful push
- **WHEN** Git has reported push success and the invocation is then cancelled
- **THEN** local HEAD remains at the pushed revision and the cancellation result discloses the completed commit

#### Scenario: A successful push leaves a helper holding its output pipe
- **WHEN** the Git leader has exited successfully but an owned helper holds a pipe until the deadline
- **THEN** cleanup terminates the helper without reclassifying the completed push as a pre-push failure, and local HEAD and its commit receipt remain consistent with the remote
