# Maintenance Service Delta

## ADDED Requirements

### Requirement: HTTP health reflects doctor health
The health endpoint MUST return an unavailable status when the latest completed doctor result is unhealthy, the cycle failed, or no completed health snapshot is available.

### Requirement: Provider work is bounded and cancellable
Maintenance shutdown MUST cancel pending provider requests and complete within a configured bound without leaking credentials or partial managed state.
