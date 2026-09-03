# Maintenance Service Delta

## ADDED Requirements

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
