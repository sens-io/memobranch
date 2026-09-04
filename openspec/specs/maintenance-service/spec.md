# Maintenance Service Specification

## Purpose

Define reliable one-shot and daemon maintenance, lifecycle controls, health reporting, and bounded observability.
## Requirements
### Requirement: Maintenance is available as one-shot and daemon execution
The system SHALL run recovery, expiry processing, incremental reindexing, health checks, and configured synchronization as an idempotent maintenance cycle, either once or on a bounded interval.

#### Scenario: Maintenance cycle repeats without changes
- **WHEN** two maintenance cycles run against an unchanged healthy vault
- **THEN** the second cycle creates no managed-file commit and reports zero changed index documents

### Requirement: File changes trigger debounced reindexing
The daemon SHALL watch managed content, coalesce bursts, and update the index after external editor changes without treating runtime files as content changes.

#### Scenario: Human edits several Wiki files rapidly
- **WHEN** multiple filesystem events occur within the debounce window
- **THEN** one incremental reindex pass runs after the burst

### Requirement: Service lifecycle is graceful
The daemon MUST publish its process state, avoid duplicate live instances for one vault, and finish or safely journal an in-flight mutation before exiting on termination signals.

#### Scenario: Second daemon starts for the same vault
- **WHEN** a healthy daemon PID already owns the service lease
- **THEN** the new process exits with a typed already-running error

### Requirement: Health and metrics are machine readable
The service SHALL expose a JSON health snapshot and Prometheus-compatible metrics on a loopback HTTP endpoint with configurable port and no confidential labels or content.

#### Scenario: Health endpoint is requested
- **WHEN** an operator calls `/healthz`
- **THEN** it receives configuration, Git, index, recovery, and maintenance status with an appropriate healthy or unavailable HTTP status

#### Scenario: Metrics endpoint is requested
- **WHEN** an operator calls `/metrics`
- **THEN** it receives bounded counters and gauges without memory bodies, keys, source URIs, credentials, or unbounded record IDs

### Requirement: HTTP health reflects doctor health
The health endpoint MUST return an unavailable status when the latest completed doctor result is unhealthy, the cycle failed, or no completed health snapshot is available.

#### Scenario: The latest doctor run is unhealthy
- **WHEN** a health request follows a completed doctor cycle that reported an integrity failure
- **THEN** the endpoint returns an unavailable status and does not claim the service is healthy

### Requirement: Provider work is bounded and cancellable
Maintenance shutdown MUST cancel pending provider requests and complete within a configured bound without leaking credentials or partial managed state.

#### Scenario: Shutdown interrupts a pending provider request
- **WHEN** maintenance stops while a provider request is still waiting
- **THEN** the request is cancelled and shutdown completes within the configured bound

### Requirement: Lease release is owner protected

The system MUST allow only the service instance whose owner token is recorded in the active lease to update or remove that lease.

#### Scenario: Unstarted instance is stopped

- **WHEN** an unrelated service object for the same vault is stopped
- **THEN** the active daemon lease remains intact and a second daemon receives the typed already-running error

#### Scenario: Lease publication fails after the server starts

- **WHEN** the daemon cannot publish its final host and port into its owned lease
- **THEN** it closes its server and watchers, releases only its own lease, and another instance can start

### Requirement: Operational counters preserve concurrent updates

Audit rotation/append and metrics read-modify-write operations MUST be serialized across processes.

#### Scenario: Many operations increment one counter concurrently

- **WHEN** one hundred accepted increments execute concurrently
- **THEN** the resulting counter increases by one hundred without malformed state or lost updates
