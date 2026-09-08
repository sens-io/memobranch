## ADDED Requirements

### Requirement: Internal reads are authorized for the requested operation
Internal reads needed to deduplicate, extract, review, expire, erase or synchronize records MUST use the operation's permission and MUST retain tenant, scope and sensitivity enforcement. External reads MUST still require `read`.

#### Scenario: Writer captures the same evidence twice
- **WHEN** a principal has `write` but not `read` and captures identical authorized evidence twice
- **THEN** the second capture returns the existing record without creating a second evidence file

#### Scenario: Reviewer has no external read permission
- **WHEN** a review-only principal approves an authorized candidate
- **THEN** review succeeds while get, search, out-of-scope and over-clearance access remain denied

#### Scenario: Maintenance would synchronize automatically
- **WHEN** auto-sync is configured but the maintenance principal lacks sync permission
- **THEN** the cycle fails authorization before performing recovery or expiry mutations
