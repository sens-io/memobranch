## ADDED Requirements

### Requirement: Server-owned read accounts
The self-hosted service MUST authenticate host-managed bearer credentials and MUST
derive read-only authority from the current account configuration, existing broker
identity and current source grants. Request-selected authority MUST be rejected.

#### Scenario: Account removed while a request waits
- **WHEN** an authenticated source read waits and its account or token is removed
- **THEN** the service refuses the assembled content before writing a successful response

#### Scenario: A lower client ceiling
- **WHEN** client attenuation is lower than the server account ceiling
- **THEN** source decryption and output are limited by the intersection

### Requirement: Fixed versions with current remote restrictions
Every transport MUST preserve the configured full pin and current access,
classification, lifecycle and provenance checks. Failed remote access MUST NOT
silently return previously cached content.

#### Scenario: Current branch withdraws an old pinned page
- **WHEN** a Git cache refresh obtains a withdrawal on the configured branch
- **THEN** reading the old pin refuses without advancing that pin

#### Scenario: Remote cannot be refreshed
- **WHEN** the configured Git fetch fails despite an existing cache
- **THEN** the read returns a transport error and no cached view

### Requirement: Bounded private transport
Cloud requests MUST use bounded complete envelopes, cancellation/deadlines and
server-owned endpoints. Public listeners MUST require TLS. Credentials, roots and
host account configuration MUST NOT be exposed in returned data or errors.

#### Scenario: A redirected cloud endpoint
- **WHEN** a configured endpoint returns a redirect
- **THEN** the client refuses without sending credentials to the redirect target

#### Scenario: Response expires in transit or a destination wait
- **WHEN** the conservative remaining validity interval elapses
- **THEN** retained read/import work refuses and requires a new remote read

### Requirement: Separate knowledge approval and preserved local mode
Cloud and Git transports MUST NOT automatically write or approve destination
knowledge and MUST retain existing local sharing behavior. Cloud acceptance MUST
include both selected transports and all documented delivery gates.

#### Scenario: Successful remote snapshot
- **WHEN** a reader retrieves a shared page
- **THEN** source/destination canonical data and grants remain unchanged and no model runs

#### Scenario: Only a server candidate is verified
- **WHEN** service tests pass but client, Git or adapter work remains
- **THEN** the roadmap records a partial candidate and does not claim cloud acceptance
