## ADDED Requirements

### Requirement: The Web workbench provides exclusive explicit historical selection
The system SHALL default to full-hash selection and SHALL allow an explicit ISO recorded-time selector with timezone through the existing authenticated route, without guessing local time or submitting an inactive selector.

#### Scenario: Selecting a date between retained versions
- **WHEN** a reader chooses date mode and submits a valid timestamp
- **THEN** only `at` is sent for the historical read and only the returned authority `commit` is sent for the current read
- **AND** normalized requested time, selected committer time, actual historical hash and mutable-clock limitations are visible with complete authorized text

#### Scenario: Invalid, unavailable or unauthorized selection
- **WHEN** a date is empty, invalid, unavailable or not currently authorized
- **THEN** no comparison, preparation or approval is made available from that read
- **AND** the interface does not substitute today's content, guess a timezone or auto-retry

### Requirement: Date browsing does not change manual merge authority
The system SHALL prepare using the actual historical hash returned by the read and SHALL preserve the current explicit signed-plan preview and separate approval.

#### Scenario: Preparing and approving after a date read
- **WHEN** an authorized writer edits the displayed content and prepares a proposal
- **THEN** preparation uses the resolved full hash, not the date or a second date resolution
- **AND** read-only users cannot prepare, non-reviewers cannot approve and only separate confirmation may write

#### Scenario: Retrying an uncertain approval
- **WHEN** a reviewer explicitly retries the retained original signed plan
- **THEN** only that exact plan is retried without a new date resolution or automatic approval

### Requirement: Selection changes invalidate outstanding work
The system SHALL apply existing cancellation, draft preservation and cleanup rules to both new controls.

#### Scenario: Mode or date changes while reading or reviewing
- **WHEN** a selection changes or the page/session closes
- **THEN** owned requests are cancelled, late results and detached approval controls cannot act, and old date metadata is cleared
- **AND** an unsaved draft remains accessible until replacement is confirmed

#### Scenario: Approval is in progress
- **WHEN** a confirmed approval request is pending
- **THEN** both selector controls are disabled along with existing editable inputs
- **AND** closing the page does not claim to undo a completed commit
