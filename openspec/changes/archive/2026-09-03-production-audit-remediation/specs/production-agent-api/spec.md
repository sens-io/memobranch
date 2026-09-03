# Production Agent API Delta

## ADDED Requirements

### Requirement: Tool metadata matches possible side effects
MCP read-only, idempotent, and destructive annotations MUST conservatively describe every execution path, including index refresh, extraction, recovery, and expiry.

#### Scenario: A nominal read can refresh derived state
- **WHEN** an MCP operation may rebuild an index or perform recovery before returning data
- **THEN** its metadata does not advertise that operation as read-only

### Requirement: Provider requests are bounded
LLM and embedding operations MUST enforce total timeouts, bounded response sizes, finite retries, and validated output collection sizes.

#### Scenario: A provider exceeds a configured bound
- **WHEN** a provider times out, returns an oversized body, or repeatedly fails
- **THEN** the request terminates with a typed error after no more than the configured retry budget
