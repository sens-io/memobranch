# Memory Access Control Specification

## Purpose

Define authoritative identity, pre-access authorization, envelope encryption, and auditable cryptographic erasure.
## Requirements
### Requirement: Server identity is authoritative
The MCP server MUST derive principal identity and permissions from server configuration and MUST NOT accept actor identity or permissions from tool arguments.

#### Scenario: Caller invokes a write tool
- **WHEN** an MCP caller captures or modifies memory
- **THEN** the Git author and audit principal are the server-configured principal regardless of caller-provided content

### Requirement: Authorization precedes content access
Every read and write MUST enforce permission, allowed scope, and maximum sensitivity before document content is loaded into a result, prompt, snippet, or embedding request.

#### Scenario: Principal searches above its sensitivity clearance
- **WHEN** a principal with `internal` clearance searches for text present only in a `secret` record
- **THEN** the result is indistinguishable from no matching record and no secret text is loaded into the returned context

#### Scenario: Principal writes outside its allowed scope
- **WHEN** a principal limited to `user` scope proposes `team` memory
- **THEN** the operation returns a typed authorization error and creates no managed-file or Git change

### Requirement: Confidential records use envelope encryption
The system MUST encrypt the full logical metadata and body of `sensitive` and `secret` evidence, candidates, and memories with a per-record data key; Git-tracked files MUST contain only a minimal non-sensitive envelope.

#### Scenario: Confidential evidence is captured
- **WHEN** a writer captures `secret` evidence with a configured master key
- **THEN** neither the plaintext body nor source URI appears in the working-tree Markdown, Git objects, generated indexes, logs, or metrics

#### Scenario: Encryption key is unavailable
- **WHEN** a confidential record is written or read without the required master key
- **THEN** the operation fails closed with a typed key-unavailable error

### Requirement: Cryptographic erasure is explicit and auditable
An administrator SHALL be able to destroy the local wrapped data key for an encrypted record, replace the working-tree record with a non-sensitive tombstone, and record the erasure without claiming that external backups were deleted.

#### Scenario: Administrator erases an encrypted memory
- **WHEN** an authorized administrator confirms cryptographic erasure
- **THEN** current and historical ciphertext can no longer be decrypted with the vault key store, normal retrieval returns no record, and the audit entry identifies the record ID but not its plaintext

### Requirement: Derived knowledge preserves provenance restrictions
An extracted or proposed memory that cites evidence MUST NOT have a broader scope or lower sensitivity than that evidence, regardless of model output.

#### Scenario: Model attempts to downgrade secret evidence
- **WHEN** an extractor returns a public candidate from secret evidence
- **THEN** the persisted candidate remains secret and no plaintext enters Git or generated artifacts

### Requirement: Every read is tenant-bound
Every document, history, resident-context, search, and answer operation MUST validate the configured vault tenant before returning or sending content.

#### Scenario: Principal belongs to another tenant
- **WHEN** a principal with otherwise sufficient permissions calls get, history, context, or answer
- **THEN** the request fails with an authorization error before content is returned or sent to a provider
