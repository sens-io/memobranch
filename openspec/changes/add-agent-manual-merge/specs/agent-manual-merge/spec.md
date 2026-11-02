## ADDED Requirements

### Requirement: Agents can inspect bounded local Wiki revisions
The system SHALL expose a read-only `memory_wiki_snapshot` tool in MCP and DeepSeek Harness using full local ancestor hashes, distinct bounded page keys and explicit confidential selection. Current authorization and source/lifetime checks SHALL remain effective.

#### Scenario: Historical content remains subject to current access
- **WHEN** an authorized reader requests an available revision
- **THEN** the complete historical body, provenance and current revision are returned without model calls or canonical changes
- **AND** current withdrawal, missing keys or insufficient authority prevent disclosure even with the historical hash

### Requirement: Agent merge preparation does not imply approval
The system SHALL expose `memory_wiki_merge_prepare` using read/write authority and manually authored text, returning the original signed plan and complete comparison. It SHALL reject caller authority, paths, signals and auto-apply fields.

#### Scenario: A reviewed plan is separately approved
- **WHEN** a reader/writer prepares a same-vault merge
- **THEN** no knowledge is applied or original source bytes changed
- **AND** only a separate authorized apply of the unchanged signed plan can commit it; altered or stale plans are refused

### Requirement: Review output and cancellation preserve core boundaries
The system SHALL refuse oversized complete reviews rather than truncate them, and SHALL propagate only host-owned cancellation without deferring core post-cleanup checks.

#### Scenario: A cancelled waiter does not disturb another operation
- **WHEN** a tool invocation waiting for the vault lock is cancelled
- **THEN** it removes only its own waiter, exposes no partial content and makes no canonical changes
- **AND** a later authorized invocation still succeeds

#### Scenario: Full review exceeds transport allowance
- **WHEN** the escaped complete result or original-plan approval envelope exceeds 9 MiB
- **THEN** the tool returns a content-too-large error and no partial plan
- **AND** the default MCP transport remains usable without a client buffer increase
