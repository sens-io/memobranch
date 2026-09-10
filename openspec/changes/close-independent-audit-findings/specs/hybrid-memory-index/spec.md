## ADDED Requirements

### Requirement: Embedding refresh is invocation authorized
All implicit and explicit semantic refreshes MUST filter provider inputs by tenant, invocation permission, scope and sensitivity before dispatch regardless of cache or model state. Inactive and encrypted documents MUST remain excluded.

#### Scenario: Cold search includes a globally indexed internal record
- **WHEN** a public reader requests semantic retrieval
- **THEN** the inaccessible body never enters an embedding request and authorized lexical and semantic retrieval remain available

#### Scenario: A maintenance-only principal reindexes
- **WHEN** it has no external read permission
- **THEN** only maintenance-authorized documents enter provider batches, without truncating the shared lexical index
