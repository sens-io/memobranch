# Production Agent API Specification

## Purpose

Define stable CLI and MCP contracts, operational discoverability, compatibility, and production release gates.
## Requirements
### Requirement: CLI behavior is automation safe
Every CLI command MUST support a stable JSON result, typed error code, non-zero failure exit status, bounded input, and deterministic argument validation.

#### Scenario: Invalid command input is supplied
- **WHEN** a required argument is absent or exceeds its limit
- **THEN** stderr receives a JSON error when `--json` is active, the process exits non-zero, and no mutation occurs

### Requirement: MCP tools expose least privilege contracts
MCP tools MUST declare read-only, idempotent, and destructive annotations accurately, enforce server principal permissions, bound payloads and result sizes, and return typed errors without terminating the server.

#### Scenario: Read-only principal calls review tool
- **WHEN** an MCP server configured without `review` permission receives `memory_review`
- **THEN** the tool returns an authorization error result and remains available for subsequent permitted calls

### Requirement: Operational controls are discoverable
The CLI and MCP interfaces SHALL expose version, effective non-secret configuration, principal permissions, health, recovery, reindex, remote status/sync, maintenance, and cryptographic-erasure operations.

#### Scenario: Operator inspects effective configuration
- **WHEN** configuration is requested
- **THEN** the result includes resolved policy and feature state but redacts keys, credentials, and confidential record metadata

### Requirement: Compatibility is explicit
The package MUST require a supported Node.js version, validate external Git availability, document the vault schema and environment contract, and retain backward-compatible reads for version 1 vaults through migration.

#### Scenario: Required Git executable is unavailable
- **WHEN** initialization or mutation cannot execute Git
- **THEN** the operation fails with an actionable dependency error before claiming success

### Requirement: Production verification gates release
The project MUST pass build, unit, MCP integration, local-remote Git synchronization, crash recovery, authorization, encryption, and bounded performance tests before the production change is archived.

#### Scenario: Verification suite has a failure
- **WHEN** any required production test fails
- **THEN** OpenSpec verification reports a critical issue and the change is not archived

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
