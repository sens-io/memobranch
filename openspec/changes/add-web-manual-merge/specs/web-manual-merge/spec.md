## ADDED Requirements

### Requirement: Historical comparison preserves current authority
The Web console SHALL expose only bounded explicit local revision views, with current source, scope, sensitivity, tenant, lifecycle and key checks.

#### Scenario: An operator loads two versions
- **WHEN** a reader chooses an existing compiled page and full local ancestor commit with explicit confidential selections
- **THEN** the console shows full old/current content and inherited conditions without a model call or canonical mutation
- **AND** incompatible current heads/revisions require a reload rather than a misleading comparison

### Requirement: Manual approval remains separate and current
The console SHALL prepare only for a current reader/writer and apply only with review authority through an unchanged signed plan after complete preview.

#### Scenario: Draft or context changes
- **WHEN** selection, authored text, navigation or session changes during preparation or review
- **THEN** stale responses cannot restore an old approval control and no automatic application occurs

#### Scenario: A reviewer explicitly approves
- **WHEN** the reviewer accepts the inspected unchanged proposal and confirms application
- **THEN** existing atomic provenance-preserving application occurs and the returned commit is displayed
- **AND** uncertain outcomes are distinguished from success without automatic retries

### Requirement: Web transport cannot bypass core safety
The adapter SHALL reject unbounded or foreign fields and responses that cannot fit the existing review transport.

#### Scenario: A request or dependency becomes unsafe
- **WHEN** a request exceeds limits, supplies a foreign root or automatic application, lacks authority, is cancelled, becomes stale or loses eligible support
- **THEN** it fails without partial canonical mutation or exposing excluded content
