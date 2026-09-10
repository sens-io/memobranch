## ADDED Requirements

### Requirement: Diagnostics respect invocation authorization
Body-derived diagnostics MUST authorize evidence using the invocation permission, tenant, scope and sensitivity before decryption or output.

#### Scenario: Restricted maintainer runs doctor
- **WHEN** inaccessible evidence contains a private link
- **THEN** it is not decrypted or included in returned diagnostics, while authorized evidence remains visible

### Requirement: Duplicate derivations preserve restrictions
Duplicate approval and consolidation MUST retain the strongest sensitivity, combined applicability conditions and earliest expiry, and regenerate provenance before persistence.

#### Scenario: A secret source reinforces a public statement
- **WHEN** the derivation is merged into existing knowledge
- **THEN** its new source association is protected by secret classification and encryption, not exposed to a public reader
