# Remote Git Sync Specification

## Purpose

Define safe remote configuration, explicit status, complete bidirectional synchronization, and delegated Git authentication.

## Requirements

### Requirement: Remote configuration is safe
Administrators SHALL configure a named Git remote and branch, while the system MUST reject remote URLs containing embedded credentials and MUST never persist transport secrets.

#### Scenario: Credential-bearing URL is provided
- **WHEN** a remote URL contains a username, password, or access token component
- **THEN** configuration fails with a typed validation error and the URL is redacted in audit output

### Requirement: Synchronization status is explicit
The system SHALL report local commit, remote commit, ahead count, behind count, divergence, conflicts, and last successful synchronization.

#### Scenario: Local and remote histories diverge
- **WHEN** neither branch tip is an ancestor of the other
- **THEN** status reports `diverged` and no push occurs without a successful merge

### Requirement: Bidirectional synchronization preserves complete states
Synchronization MUST recover local transactions, require a clean managed worktree, fetch, fast-forward or perform a normal Git merge, rebuild derived artifacts, commit generated changes if necessary, and push only after local integrity checks pass.

#### Scenario: Remote is ahead without conflicts
- **WHEN** the configured remote branch contains new commits and local has no unique commits
- **THEN** the local branch fast-forwards, derived artifacts are rebuilt, health checks pass, and the new state becomes available to search

#### Scenario: Merge produces conflicts
- **WHEN** divergent histories cannot be merged cleanly
- **THEN** the merge is aborted, the pre-sync local state is restored, conflict paths are returned, and no push occurs

### Requirement: Git authentication is delegated
The system MUST use the installed Git credential and SSH mechanisms and MUST NOT accept, log, or store remote tokens in CLI or MCP parameters.

#### Scenario: Git authentication fails
- **WHEN** fetch or push cannot authenticate
- **THEN** synchronization returns a redacted typed transport error and leaves local history and managed files unchanged
