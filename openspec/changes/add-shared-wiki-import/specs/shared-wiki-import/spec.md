## ADDED Requirements

### Requirement: Import must require separate explicit confirmation
The system SHALL prepare a signed immutable compiled-source copy without writing
knowledge, and SHALL require current read/write/review authority and explicit
confirmation before capturing that artifact. Knowledge integration SHALL require
its own signed preview and separate existing review approval.

#### Scenario: Preparation and import do not approve Wiki knowledge
- **WHEN** an authorized operator prepares and confirms a valid pinned source import
- **THEN** preparation changes no canonical files, confirmation captures one derived artifact, and no Wiki page or model call occurs
- **AND** exact retry rechecks access and source availability without another evidence/commit

#### Scenario: Unrelated knowledge expires before an exact retry
- **WHEN** an unrelated ordinary memory expires after the first import and the same valid artifact is confirmed again
- **THEN** the duplicate path does not rebuild generated projections or create a housekeeping commit
- **AND** concurrent identical imports still retain one artifact and one successful capture

#### Scenario: Reader, writer or forged plan cannot approve
- **WHEN** confirmation is absent, required permissions are missing, a plan is edited or belongs to another destination/config
- **THEN** import fails without partial evidence or knowledge writes

#### Scenario: Ordinary capture cannot bypass import confirmation
- **WHEN** a caller submits a complete artifact and reserved import URI through ordinary API, CLI or Agent capture
- **THEN** the request fails without writing import evidence, regardless of extra JSON fields
- **AND** only the trusted internal importer with runtime validation guards may capture the reserved format under current read/write/review authority

### Requirement: Origin and restrictions must survive integration
The system SHALL preserve complete fixed-version provenance and distinguish a
compiled-source copy from original-source verification. It SHALL enforce source
classification, conditions, uncertainty, conflict and lifecycle in all downstream
Wiki preparation, approval and readable knowledge.

#### Scenario: A model or author drops restrictions
- **WHEN** a proposed page omits conditions/uncertainty, lowers sensitivity, broadens scope or extends an imported source's lifetime
- **THEN** the program retains or refuses the restrictions before approval and current reads cannot expose weakened knowledge

#### Scenario: Ordinary memory attempts to bypass imported restrictions
- **WHEN** extraction, proposal, approval, consolidation or a preexisting ordinary memory references a compiled Wiki artifact as evidence
- **THEN** the ordinary-memory path refuses it instead of discarding imported uncertainty, conflict or expiry
- **AND** authorized inspection of the artifact and its separate Wiki workflow remain available

#### Scenario: Manual integration keeps local knowledge under review
- **WHEN** a human authors integration against an imported artifact and an exact current revision
- **THEN** the complete local/imported/proposed comparison and affected pages are previewed, existing provenance remains and only separate review can commit
- **AND** changed revisions or conflicting imported/local claims never silently overwrite the current target

### Requirement: Import must preserve source and destination boundaries
The system SHALL use current host-configured shared access, without concurrent
source/destination locks, arbitrary paths, network operations or automatic source
updates. It SHALL keep transaction, cancellation and time checks through the last
destination wait and existing safe commit boundary.

#### Scenario: Access changes between preview and approval
- **WHEN** the source pin/grant/key/content changes, selected support is withdrawn, or current authority is removed before a new approval
- **THEN** approval refuses rather than using copied preview plaintext or another version

#### Scenario: Final waiting crosses expiry or is cancelled
- **WHEN** a valid source read is followed by a real destination lock wait crossing expiry or cancellation
- **THEN** no artifact is committed before readiness, no partial mutation remains and an opposite-source operation cannot deadlock

#### Scenario: Another branch is explicitly configured
- **WHEN** the host configures a separate local checkout and full ancestor pin representing another branch
- **THEN** the same checks and separate import/integration approval apply without fetching, checkout, Git merge or grant changes

#### Scenario: Copies have explicit limits
- **WHEN** a complete source artifact or plan exceeds bounds, is malformed, or tries to include an attachment/credential
- **THEN** the operation refuses the complete result without truncation or execution
- **AND** accepted copies remain clearly identified as compiled material that cannot be recalled from offline recipients
