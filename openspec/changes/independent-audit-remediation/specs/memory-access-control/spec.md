# Memory Access Control Delta

## ADDED Requirements

### Requirement: Confidential encoding is enforced at trust boundaries
Canonical reads, health checks, and remote synchronization MUST reject any `sensitive` or `secret` document that is not a valid authenticated envelope.

#### Scenario: Remote adds a plaintext secret page
- **WHEN** synchronization receives a Wiki document marked `secret` whose body is plaintext
- **THEN** validation fails, synchronization restores the pre-sync state, and the plaintext is not accepted into local history

### Requirement: Evidence identity binds authorization metadata
Evidence identity and integrity validation MUST bind scope, sensitivity, source URI, and body, and invalid evidence MUST NOT be returned or used for derivation.

#### Scenario: Evidence sensitivity is lowered
- **WHEN** committed evidence metadata changes from internal to public without recapture
- **THEN** doctor reports an integrity failure and a public principal cannot retrieve the evidence

### Requirement: Confidential identifiers remain opaque
Confidential logical keys MUST NOT appear in Git paths or generated commit subjects, and non-admin history results MUST NOT expose untrusted commit subjects.

#### Scenario: A secret memory is proposed
- **WHEN** a caller supplies a secret logical key
- **THEN** the key is absent from Git paths and commit subjects and is not returned to a public-clearance history caller

### Requirement: Unbound non-admin principals fail closed
A non-admin principal MUST present the configured tenant identity before any vault operation returns data or changes state.

#### Scenario: Read principal omits tenant identity
- **WHEN** a read-only principal has no tenant identifier
- **THEN** the vault returns an authorization error before loading or returning tenant data

### Requirement: Erasure reason commitment is truthful
Successful cryptographic erasure MUST commit a SHA-256 digest of the normalized supplied reason without storing the reason plaintext, and legacy recovery MUST NOT claim an unavailable reason was recorded.

#### Scenario: Administrator supplies an erasure reason
- **WHEN** a confidential memory is cryptographically erased
- **THEN** its tombstone contains the reason digest, excludes the plaintext reason, and truthfully reports that the reason was recorded
