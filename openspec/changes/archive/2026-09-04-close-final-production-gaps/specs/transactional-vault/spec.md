## ADDED Requirements

### Requirement: Managed documents have complete schemas

Evidence, candidates, canonical memories, and erasure tombstones MUST satisfy their complete type schema before ordinary reads, health checks, generated projections, or remote synchronization accept them.

#### Scenario: Remote memory omits required fields

- **WHEN** a synchronized active memory lacks confidence, timestamps, evidence, conditions, tags, or revision
- **THEN** synchronization fails canonical validation and restores the previous local state

#### Scenario: Managed metadata contains forged relationships or duplicate identity

- **WHEN** a candidate cites missing evidence, lifecycle references are unresolved, or two managed files share one ID
- **THEN** health is unhealthy, synchronization rejects the state, and automatic consolidation cannot use fake evidence counts

### Requirement: Managed paths cannot escape through symbolic links

Managed evidence, candidate, and Wiki traversal MUST reject symbolic-link files and directories before reads, health acceptance, synchronization, or writes can follow them.

#### Scenario: Remote adds a managed symbolic link

- **WHEN** synchronization checks out a symbolic link under a managed directory
- **THEN** canonical reconciliation fails, the local snapshot is restored, and the link target is unchanged

### Requirement: Legacy evidence migrates without breaking references

The explicit migration command MUST recognize evidence produced by the supported legacy digest, convert it to the authorization-bound digest, and preserve its existing ID, path, and references.

#### Scenario: Vault contains valid legacy evidence

- **WHEN** an operator runs explicit migration with all required decryption keys
- **THEN** the evidence receives a valid v2 digest, its ID and path remain stable, and normal health checks pass
