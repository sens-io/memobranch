## ADDED Requirements

### Requirement: Semantic results have valid identity and geometry
Semantic batches MUST map each input to exactly one uniquely indexed nonzero finite vector with consistent dimensions. Invalid provider output MUST degrade to lexical retrieval, and invalid derived caches MUST be rebuildable.

#### Scenario: Duplicate provider indices or mismatched dimensions
- **WHEN** a provider repeats an index or a query vector has different dimensions from document vectors
- **THEN** no mismatched semantic score is returned as ready and lexical results remain available

### Requirement: Management reads observe settled state
Management reads MUST wait for an active vault writer and MUST NOT expose a partial or rolled-back canonical publication. Cancellation MUST remain effective while waiting. Unresolved recovery MUST block content reads rather than expose partial files.

#### Scenario: Approval rolls back while a reader waits
- **WHEN** approval pauses after writing a canonical page and subsequently fails
- **THEN** the reader never returns the temporary page and observes the settled rollback state

### Requirement: Content and evidence boundaries are unambiguous
Web capture and proposal content MUST honor core-configured character limits subject to the documented HTTP byte budget. Evidence identity MUST NOT silently conflate distinct accepted source/content pairs.

#### Scenario: Source URI contains an identity delimiter
- **WHEN** a source URI contains a NUL delimiter
- **THEN** capture and imported evidence validation reject the ambiguous input without treating a distinct source as a duplicate

#### Scenario: Re-proposal strengthens derivation restrictions
- **WHEN** the same fact is proposed with different sensitivity, conditions, expiry, confidence, explicitness or tags
- **THEN** it remains a distinct reviewable candidate; exact authorized retries retain their existing identity and inaccessible candidates are not exposed by deduplication

#### Scenario: Candidate fields contain delimiter characters
- **WHEN** distinct keys and statements contain NUL characters at different boundaries
- **THEN** both candidate and canonical identities remain distinct and the complete raw statement is preserved

### Requirement: Remote data cannot replace local runtime state
Incoming Git trees MUST be validated before checkout or merge. Only supported managed files and regular Markdown records may be imported; runtime state and unsupported paths MUST remain local.

#### Scenario: Remote tree contains a runtime path
- **WHEN** a fetched commit tracks a path under `.amem/`
- **THEN** synchronization rejects it before materializing files and leaves local runtime state and canonical data unchanged
