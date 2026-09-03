## ADDED Requirements

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

