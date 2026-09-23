## ADDED Requirements

### Requirement: Local authenticated management
The console MUST bind only to loopback, authenticate every API request with a startup token, validate Host and Origin, bound input and concurrency, and propagate cancellation without breaking committed transactions.

#### Scenario: An unrelated website attempts a vault mutation
- **WHEN** a request lacks the token or has a foreign Origin or Host
- **THEN** it is rejected before any vault operation executes

### Requirement: Authorized memory lifecycle
The console MUST browse only authorized records and use existing vault methods for capture, proposals, review and revocation. Identity and tenant MUST be server-owned.

#### Scenario: A restricted reader browses the vault
- **WHEN** records have other scopes or higher sensitivity
- **THEN** neither their contents nor their counts appear and write actions are denied

### Requirement: Distinct Wiki workflows
The console MUST expose catalog, rules, ingestion planning, read-only querying and lint, with separate explicit approval for applying plans or filing query results.

#### Scenario: A user queries and then chooses to save
- **WHEN** a query returns a cited result
- **THEN** the query leaves canonical knowledge unchanged and filing produces a separately reviewable plan

### Requirement: Safe configuration changes
Settings MUST use an explicit non-secret allowlist and administrator authorization, validate values, reject stale revisions inside the transaction lock, and preserve tenant, encryption and raw evidence invariants.

#### Scenario: Another operator changes settings first
- **WHEN** a save supplies an outdated configuration revision
- **THEN** it fails without overwriting the intervening change

### Requirement: Usable packaged interface
The npm artifact MUST contain the interface and server. The UI MUST expose permission-aware controls, keyboard-operable forms, responsive layout and loading, empty and error states without interpreting stored content as HTML.

#### Scenario: A stored source contains executable markup
- **WHEN** an operator opens the source
- **THEN** the markup is displayed as text and no script or external resource executes
