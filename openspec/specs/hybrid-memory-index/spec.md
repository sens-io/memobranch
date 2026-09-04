# Hybrid Memory Index Specification

## Purpose

Define persistent, multilingual, optionally semantic memory retrieval while preserving authorization boundaries.
## Requirements
### Requirement: Search uses a persistent derived index
The system SHALL persist a versioned, atomically written search index outside Git and update only documents whose content hash, authorization metadata, or deletion state changed.

#### Scenario: One canonical page changes
- **WHEN** reindexing runs after one of many Wiki pages changes
- **THEN** only that page and graph relationships affected by it are reparsed while unchanged indexed entries retain their content hash

#### Scenario: Index is missing or corrupt
- **WHEN** search opens a missing, invalid, or unsupported index
- **THEN** it rebuilds the index from authoritative Markdown and records a rebuild metric without losing vault content

### Requirement: Lexical retrieval supports English and CJK text
The lexical ranker MUST index normalized Latin terms and CJK characters/bigrams and MUST produce deterministic ranking for an unchanged vault.

#### Scenario: Chinese preference is queried
- **WHEN** a canonical Chinese memory is searched with overlapping Chinese terms
- **THEN** it is returned without requiring an embedding provider

### Requirement: Semantic retrieval is optional and bounded
The system SHALL support OpenAI-compatible embeddings, cache them by content hash and model, exclude confidential documents by default, and fall back to lexical search when the provider is unavailable.

#### Scenario: Embedding provider fails
- **WHEN** hybrid search cannot obtain a query embedding
- **THEN** the request succeeds with lexical and graph ranking and reports semantic status as degraded without exposing provider credentials

### Requirement: Hybrid ranking preserves authorization
The system MUST apply authorization filters before lexical scoring, vector scoring, link expansion, and snippet generation.

#### Scenario: Authorized public hit links to secret memory
- **WHEN** graph expansion encounters a linked secret document above the principal clearance
- **THEN** the secret neighbor is omitted and does not influence the returned ranking or snippet

### Requirement: Derived indexes are untrusted
Authorization metadata and returned snippets MUST be obtained or verified against canonical Markdown, and health MUST detect any mismatch in cached metadata or content.

#### Scenario: Cached clearance is lowered without changing content hash
- **WHEN** an index entry is modified from project/internal to user/public
- **THEN** doctor reports the index unhealthy and a user/public principal cannot retrieve the canonical record

### Requirement: Conflicts do not masquerade as facts
Conflicted memories MUST be excluded from ordinary retrieval unless an explicit conflict-aware interface is requested.

#### Scenario: A memory enters conflict
- **WHEN** contradictory candidates leave a memory in conflicted status
- **THEN** ordinary search and context assembly omit that memory until the conflict is resolved

### Requirement: Search cache observes completed external mutations
A long-lived process MUST invalidate its trusted in-memory index before the next query when another process has completed an index replacement.

#### Scenario: Another process revokes a cached memory
- **WHEN** one vault process completes revocation after a second process cached the active record
- **THEN** the second process's next query reloads trusted state and does not return the revoked memory

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
