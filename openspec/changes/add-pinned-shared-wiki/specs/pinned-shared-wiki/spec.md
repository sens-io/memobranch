## ADDED Requirements

### Requirement: Sharing requires explicit host-owned bindings
The system SHALL serve only preconfigured local Wiki sources to explicitly listed
current reader identities, with no cloud account service or caller-selected roots.

#### Scenario: An unauthorized reader asks for a source
- **WHEN** the current caller tenant/actor tuple is absent, foreign or no longer granted
- **THEN** no source content, root, credential or other reader identity is returned

#### Scenario: A caller attempts a source or identity override
- **WHEN** an agent or HTTP request supplies a path, commit, tenant, principal or executable
- **THEN** the strict adapter rejects the override before reading shared content

### Requirement: Shared reads preserve fixed versions and current authority
The system SHALL read the configured complete local ancestor commit while enforcing
both current caller limits and current source integrity, lifecycle and keys.

#### Scenario: The source advances after a pin is configured
- **WHEN** an authorized reader requests selected pages and all current checks pass
- **THEN** the complete result contains the configured committed version and origin, not silently newer content

#### Scenario: Selected source content becomes unreadable
- **WHEN** current scope, sensitivity, keys, withdrawal, expiry or source identity no longer permits the read
- **THEN** no old plaintext or fallback revision is returned

#### Scenario: A host binding changes during a read
- **WHEN** the configured grant, pin, caller authority or source key selection changes before returning
- **THEN** the old result is refused and no new permission is inferred

### Requirement: Sharing remains a bounded read workflow
The system SHALL keep catalog/reading separate from import, merge, approval and
permission configuration, with existing cancellation and complete-output limits.

#### Scenario: Two callers read opposite configured vaults
- **WHEN** concurrent reads use opposite caller/source vault pairs
- **THEN** they do not deadlock through nested vault locks and perform no canonical mutation

#### Scenario: An operator stops or leaves a shared Web read
- **WHEN** selection changes, a request is stopped, navigation occurs or the session ends
- **THEN** old content cannot reappear through a late response or automatic retry

#### Scenario: A local source is unavailable or an output budget is exceeded
- **WHEN** complete local objects, valid bounded configuration or complete result capacity are unavailable
- **THEN** an explicit error is returned without network fetching, truncation or permission changes
