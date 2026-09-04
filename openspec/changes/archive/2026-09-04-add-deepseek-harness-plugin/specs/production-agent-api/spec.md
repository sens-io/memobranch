# Production Agent API Specification Delta

## ADDED Requirements

### Requirement: DeepSeek Harness is a native supported integration
The package MUST provide an installable DeepSeek Harness bundle whose exported module follows the Cordis plugin lifecycle and registers tools through the Harness tool service.

#### Scenario: Bundle is installed into a profile
- **WHEN** a user installs the package with `dsh plugin --profile <name> add memobranch`
- **THEN** the package manifest contributes a patch that loads `memobranch/deepseek-harness`

### Requirement: Harness configuration is validated and deployment-owned
The plugin MUST export a Schemastery configuration schema, provide bounded deployment defaults, and MUST NOT accept identity, permissions, tenant, encryption keys, provider credentials, or remote credentials as tool arguments.

#### Scenario: Invalid numeric default is configured
- **WHEN** a configured search limit or context bound is outside the supported range
- **THEN** plugin loading fails before any tool is registered

### Requirement: Harness tool visibility follows least privilege
The plugin MUST register only tool categories granted to the server-owned principal and MUST retain vault authorization on every execution path.

#### Scenario: Read-only principal loads the plugin
- **WHEN** `AMEM_PERMISSIONS` grants only `read`
- **THEN** read tools are visible and write, review, sync, maintenance, and erase tools are absent

### Requirement: Harness tools use canonical bounded contracts
Every Harness tool MUST use the official typed tool definition API, return a schema-valid canonical JSON value or string, validate unsupported bounds before execution, normalize errors to stable redacted MemoBranch errors, and avoid unsafe concurrency claims.

#### Scenario: Model supplies an out-of-range limit
- **WHEN** a tool receives a limit outside the supported range
- **THEN** it fails with a typed validation error and does not invoke the vault operation

### Requirement: Harness cancellation reaches quiescence
The adapter MUST observe cancellation, cancel pending provider work owned by its vault, and wait for the invoked vault operation to settle before completing.

#### Scenario: Call is already cancelled
- **WHEN** a Harness execution signal is aborted before dispatch
- **THEN** the tool fails without reading or mutating the vault
