## MODIFIED Requirements

### Requirement: Harness cancellation reaches quiescence
The adapter MUST own cancellation per invocation, cancel only that invocation's provider and Git work, await cleanup before completion, and cancel and await all owned invocations on plugin unload. It MUST NOT dispatch follow-up extraction or mutations after cancellation. Already committed effects MUST be disclosed by safe commit receipts.

#### Scenario: Call is already cancelled
- **WHEN** a Harness execution signal is aborted before dispatch
- **THEN** the tool fails without reading or mutating the vault

#### Scenario: One of two independent sessions is cancelled
- **WHEN** two calls share one plugin and one call is cancelled during provider execution
- **THEN** only the cancelled call stops and the other call can complete normally

#### Scenario: Capture is cancelled during its ready commit
- **WHEN** cancellation arrives after a capture transaction is ready but before its commit finishes
- **THEN** the commit settles, its receipt is returned with the cancellation error, and extraction never starts

## ADDED Requirements

### Requirement: Harness peer range includes the verified runtime
The declared optional Harness tool peer range MUST accept the tested `0.1.2-rc.1` version under default npm semver rules and MUST reject unverified minor release families.

#### Scenario: npm checks prerelease compatibility
- **WHEN** the actual semver matcher evaluates `0.1.2-rc.1` against the peer range
- **THEN** it accepts without enabling includePrerelease or forcing peer installation
