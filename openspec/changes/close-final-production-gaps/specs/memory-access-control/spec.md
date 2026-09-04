## ADDED Requirements

### Requirement: Effective encryption policy is enforced

Every sensitivity listed in `policy.requireEncryptionFor` MUST use an authenticated envelope for managed storage and MUST be excluded from plaintext indexes and generated projections.

#### Scenario: Internal records are configured for encryption

- **WHEN** an operator adds `internal` to `policy.requireEncryptionFor` and writes an internal record
- **THEN** its Git-tracked document contains an encrypted envelope and no logical plaintext
