## ADDED Requirements

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

