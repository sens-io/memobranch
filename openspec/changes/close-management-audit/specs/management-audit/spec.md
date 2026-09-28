## ADDED Requirements

### Requirement: Web configuration is a nested public projection
The Web interface MUST disclose only explicitly named operational fields at every nesting level and preserve unrelated configuration extensions when saving settings.

#### Scenario: Existing configuration contains an extra secret field
- **WHEN** an operator reads or saves Web settings
- **THEN** the extra field is not sent to the browser, is not editable there and is not deleted on save

### Requirement: Reviewable Web results fit their write-back route
The Web adapter MUST accept review and filing payloads up to 16 MiB while limiting other requests to 1 MiB, and MUST reject oversized generated previews before presenting them as usable plans.

#### Scenario: A valid Unicode multi-page plan exceeds 1 MiB
- **WHEN** an authorized operator generates and explicitly approves the plan
- **THEN** the Web adapter applies it transactionally within the review transport budget

### Requirement: Wiki budgets include mandatory context
Ingest MUST count existing mandatory source summaries against the caller's maxPages budget without silently omitting them.

#### Scenario: Mandatory summaries exceed the requested budget
- **WHEN** navigation plus source summaries exceeds maxPages
- **THEN** compilation is rejected before sending full page bodies to the model

### Requirement: Explicit repairs can resolve conflicts
An explicitly approved signed repair MAY replace the conflict status of repaired targets. Ordinary compilation MUST NOT clear old conflicts, and unresolved supporting pages MUST continue to propagate conflicts. Evidence, access restrictions, conditions, uncertainty and history MUST be retained.

#### Scenario: An operator approves a resolving repair
- **WHEN** the repair proposes active target pages and all supporting conflicts are resolved in the same approved plan
- **THEN** the new revisions become active without deleting prior evidence or history

### Requirement: Adapters share the configured question limit
CLI, MCP and Harness MUST allow questions through the maximum supported configuration range and let the core enforce the actual vault limit.

#### Scenario: A vault allows 9000 characters
- **WHEN** each adapter receives an 8001-character question and then a 9001-character question
- **THEN** the first succeeds and the second is rejected without canonical writes

### Requirement: Packaged documentation and runtime promises are executable
The npm artifact MUST contain locally linked design and acceptance documentation and the README logo. Signal cancellation MUST work on Node 20.0 without AbortSignal.any.

#### Scenario: A consumer installs the tarball
- **WHEN** package verification runs at the declared runtime floor
- **THEN** packaged entry points and cancellation operate and required documentation exists
