## ADDED Requirements

### Requirement: Cached retrieval is bound to canonical source state

Before reusing an in-memory search snapshot, the system MUST verify that the canonical Wiki file set and source identities still match the indexed state. Returned hits MUST be reread through the authorized canonical reader before snippets are emitted.

#### Scenario: Canonical clearance changes without an index update

- **WHEN** an indexed public document becomes internal while a public reader retains an in-memory index
- **THEN** the next query rebuilds or fails closed and does not return the document

#### Scenario: Revocation commits but index refresh fails

- **WHEN** a memory revocation commits and the following index persistence fails
- **THEN** the mutation may report its durable commit but subsequent retrieval does not use the stale snapshot

### Requirement: Encrypted retrieval stays out of semantic providers

Documents stored in an encrypted envelope MUST NOT be sent to an embedding provider, even when their sensitivity is later removed from `policy.requireEncryptionFor`. Inactive encrypted documents MUST be removed before ranking so they cannot consume the result limit.

#### Scenario: Encryption policy is relaxed after a document was encrypted

- **WHEN** hybrid search decrypts the document ephemerally for authorized lexical search
- **THEN** the document remains absent from embedding batches and revoked encrypted records cannot displace active hits
