# Hybrid Memory Index Delta

## ADDED Requirements

### Requirement: Derived indexes are untrusted
Authorization metadata and returned snippets MUST be obtained or verified against canonical Markdown, and health MUST detect any mismatch in cached metadata or content.

#### Scenario: Cached clearance is lowered without changing content hash
- **WHEN** an index entry is modified from project/internal to user/public
- **THEN** doctor reports the index unhealthy and a user/public principal cannot retrieve the canonical record

### Requirement: Conflicts do not masquerade as facts
Conflicted memories MUST be excluded from ordinary retrieval unless an explicit conflict-aware interface is requested.
