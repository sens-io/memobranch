# Transactional Vault Specification

## Purpose

Define crash-recoverable mutations, single-writer coordination, schema migration, and repository integrity diagnostics.
## Requirements
### Requirement: Logical mutations are crash recoverable
The system MUST journal every multi-file mutation before modifying managed files and MUST either commit the complete mutation or restore the exact pre-mutation contents.

#### Scenario: Process stops before mutation is ready
- **WHEN** the service starts and finds an interrupted journal that was not marked ready to commit
- **THEN** it restores all recorded original files, removes files created by that mutation, rebuilds derived artifacts, and records a recovery audit event

#### Scenario: Process stops after mutation is ready
- **WHEN** the service starts and finds a journal marked ready whose Git commit was not completed
- **THEN** it replays the complete desired file set, creates the attributed Git commit, and clears the journal

### Requirement: Vault writes have a single-writer boundary
The system MUST serialize mutations across processes with an exclusive lock, detect dead or expired lock owners, and MUST NOT silently steal a live lock.

#### Scenario: Concurrent writer holds the lock
- **WHEN** a second writer attempts a mutation while the recorded owner process is alive
- **THEN** it waits for the configured bounded period and returns a typed lock-timeout error without changing the vault

### Requirement: Configuration is versioned and migrated
The system MUST validate the vault configuration, migrate supported older versions through explicit steps, create a backup before migration, and refuse writes for unknown future versions.

#### Scenario: Version 1 vault is opened for writing
- **WHEN** the current software opens a valid version 1 configuration
- **THEN** it writes a backup, migrates the configuration to version 2 without losing existing settings, and records the migration in Git

#### Scenario: Future schema version is encountered
- **WHEN** the configuration version is newer than the highest supported version
- **THEN** read-only diagnostics remain available and every mutation fails with an unsupported-version error

### Requirement: Repository integrity is diagnosable
The system SHALL validate the shadow repository, managed-file status, transaction state, configuration, and derived-index state in its health report.

#### Scenario: Shadow repository objects are corrupt
- **WHEN** Git integrity verification reports corruption
- **THEN** health is unhealthy, the failure is included without leaking credentials, and remote synchronization is disabled

### Requirement: Lock ownership is stable
A live writer MUST NOT lose its lock because of elapsed time, and a writer MUST remove a lock only when its owner token still matches.

#### Scenario: A mutation exceeds the stale threshold
- **WHEN** the recorded PID is still alive after the threshold
- **THEN** another writer waits or returns a typed timeout without entering the critical section

### Requirement: Erasure is recoverable
Cryptographic erasure MUST persist a non-secret intent and complete key destruction before committing the success tombstone and audit record.

#### Scenario: Key-store update fails
- **WHEN** wrapped-key deletion cannot be persisted
- **THEN** the operation fails without a success commit and can be retried or recovered safely

### Requirement: Evidence immutability is verified
Health, mutation preflight, and remote validation MUST verify captured evidence identity against its canonical hash and MUST NOT sweep unrelated managed changes into an operation commit.

#### Scenario: Captured evidence is modified out of band
- **WHEN** a canonical evidence file no longer matches its recorded hash
- **THEN** doctor reports the mismatch and subsequent mutations or remote validation fail closed

### Requirement: Lock reclamation is race-free
Dead-owner recovery MUST NOT remove a successor's lock, and concurrent stale-lock observers MUST elect only one process to acquire or reclaim the conventional writer lock.

#### Scenario: Many processes observe the same dead lock
- **WHEN** multiple writers concurrently encounter one stale lock
- **THEN** exactly one writer enters the critical section at any time and every live successor retains ownership until it exits

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
