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
