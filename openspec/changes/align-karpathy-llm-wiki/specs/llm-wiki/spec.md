## ADDED Requirements

### Requirement: Wiki compilation produces persistent linked knowledge
Ingest MUST read immutable evidence, applicable rules and authorized existing knowledge, then propose a persistent interlinked set of Markdown pages rather than only indexing raw chunks or extracting isolated statements.

#### Scenario: A second source adds knowledge about an existing entity
- **WHEN** two sources discuss the same entity with complementary facts
- **THEN** compilation updates the shared page, retains both source references, creates or updates relevant synthesis, and leaves both raw evidence bodies unchanged

### Requirement: Compilation plans are authorized and atomic
Applying a compilation plan MUST validate paths, schemas, citations, tenant, operation permission, scope, sensitivity and base revisions. Page changes, navigation and chronological log entries MUST commit atomically and preserve recovery semantics.

#### Scenario: The Wiki changes while a model prepares a plan
- **WHEN** a referenced page revision changes before apply
- **THEN** the stale plan is rejected or explicitly regenerated and never silently overwrites the intervening edit

#### Scenario: Repeated ingest sees unchanged inputs
- **WHEN** source hash, rules and relevant page revisions are unchanged
- **THEN** ingest reuses the completed result without redundant provider work or duplicate commits

### Requirement: Queries navigate the Wiki and save only explicitly
Query MUST use an authorized content catalog and relevant canonical pages, cite actual sources, and distinguish supported claims from uncertainty. Ordinary querying MUST NOT write canonical knowledge. Explicit answer filing MUST preserve citation restrictions without treating generated text as independent evidence.

#### Scenario: A user elects to keep a comparison answer
- **WHEN** an authorized user explicitly saves a cited comparison
- **THEN** a reviewable query or comparison page is linked into the Wiki and retains the strongest restrictions of its supporting sources

### Requirement: Lint separates deterministic health and semantic suggestions
Lint MUST check structure and support evidence-linked suggestions about contradictions, stale claims, missing concepts and knowledge gaps. It MUST report unavailable semantic analysis truthfully and MUST NOT apply repairs without separate authorization.

#### Scenario: Two pages disagree
- **WHEN** semantic lint finds incompatible claims
- **THEN** it identifies the affected page versions and evidence, returns a review suggestion, and leaves both canonical pages unchanged

### Requirement: Rules and catalogs guide all Wiki workflows
Ingest, Query and Lint MUST consume the applicable rule and purpose documents within authorization and context budgets. Navigation MUST provide page categories, links and short summaries; chronological logs MUST remain append-only and parseable.

#### Scenario: Embeddings are disabled
- **WHEN** no vector provider is configured
- **THEN** catalog navigation, lexical retrieval, ingestion and deterministic lint remain usable without making a vector service authoritative
