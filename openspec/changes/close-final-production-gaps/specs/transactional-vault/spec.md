## ADDED Requirements

### Requirement: Managed documents have complete schemas

Evidence, candidates, canonical memories, and erasure tombstones MUST satisfy their complete type schema before ordinary reads, health checks, generated projections, or remote synchronization accept them.

#### Scenario: Remote memory omits required fields

- **WHEN** a synchronized active memory lacks confidence, timestamps, evidence, conditions, tags, or revision
- **THEN** synchronization fails canonical validation and restores the previous local state

### Requirement: Legacy evidence migrates without breaking references

The explicit migration command MUST recognize evidence produced by the supported legacy digest, convert it to the authorization-bound digest, and preserve its existing ID, path, and references.

#### Scenario: Vault contains valid legacy evidence

- **WHEN** an operator runs explicit migration with all required decryption keys
- **THEN** the evidence receives a valid v2 digest, its ID and path remain stable, and normal health checks pass
