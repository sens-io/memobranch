## ADDED Requirements

### Requirement: Guarded stable publication
The release command SHALL default to no upload, reject dirty trees, invalid or existing versions and the wrong publishing identity, and require successful regression, audit, specification and installation checks before explicit publication.

#### Scenario: A verification gate fails
- **WHEN** any required validation fails
- **THEN** no npm publication is attempted

#### Scenario: Default invocation
- **WHEN** the command runs without publication approval
- **THEN** it validates and performs only an npm dry run

### Requirement: Artifact identity
The release command SHALL smoke-test the same tarball it uploads and verify registry integrity and the stable tag after upload without automatically retrying publication.

#### Scenario: Registry mismatch
- **WHEN** the registry artifact differs from the tested artifact
- **THEN** the command reports verification failure and requests inspection before retrying
