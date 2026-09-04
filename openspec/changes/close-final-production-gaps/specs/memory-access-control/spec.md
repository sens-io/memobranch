## ADDED Requirements

### Requirement: Effective encryption policy is enforced

Every sensitivity listed in `policy.requireEncryptionFor` MUST use an authenticated envelope for managed storage and MUST be excluded from plaintext indexes and generated projections.

#### Scenario: Internal records are configured for encryption

- **WHEN** an operator adds `internal` to `policy.requireEncryptionFor` and writes an internal record
- **THEN** its Git-tracked document contains an encrypted envelope and no logical plaintext

#### Scenario: Configured internal record is migrated and erased

- **WHEN** an operator expands the policy, migrates existing internal plaintext, and later erases that memory
- **THEN** the migration journal contains no plaintext, the original data key is destroyed, and any encrypted tombstone uses a different key reference

### Requirement: Runtime secrets are excluded from enclosing repositories

Initialization and subsequent migrations MUST preserve existing ignore rules and add an effective `.amem/` rule so runtime keys, journals, indexes, audit, and metrics are not collected by a Git repository enclosing the vault.

#### Scenario: Vault is initialized inside an existing repository

- **WHEN** the project already has a `.gitignore`
- **THEN** its rules remain intact and outer Git status does not list `.amem/`
