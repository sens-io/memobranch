## ADDED Requirements

### Requirement: Public web reads do not grant private network authority
Web source reads MUST require explicit HTTPS URLs on port 443, reject credentials/local-use destinations, validate every resolved address and redirect, pin the accepted connection address, verify TLS/peer identity and avoid ambient credentials/proxy/session state.

#### Scenario: A URL redirects to a private or downgraded destination
- **WHEN** a source returns a redirect to a non-public address, HTTP URL or nonstandard port
- **THEN** the read fails before connecting to that target and no evidence is captured

#### Scenario: DNS answers are mixed or change after validation
- **WHEN** resolution contains an inaccessible address or an accepted hostname would resolve differently later
- **THEN** mixed answers fail and an accepted connection uses only its validated pinned address

### Requirement: Source reads are bounded and cancellable
Source reads MUST bound URL count, total preflight time, per-source DNS/redirect/body time, response headers and source bytes, and release owned resolvers, sockets, agents and listeners on settlement. Only supported nonempty UTF-8 text is accepted.

#### Scenario: A response streams beyond the byte limit or stalls
- **WHEN** it exceeds a byte/time limit or the caller cancels
- **THEN** owned network work is stopped and the operation reports failure rather than saving partial content

### Requirement: Web import preserves reviewed source identity
Preview MUST contain fingerprints and provenance without bodies. Apply MUST check current authority before networking, validate every source against the manifest before its first capture, save a lossless UTF-8 envelope through existing immutable evidence transactions and never approve Wiki knowledge.

#### Scenario: A source body or redirect target changes after preview
- **WHEN** apply revalidates the manifest
- **THEN** it refuses before saving any source from that apply and requires a new preview

#### Scenario: A batch is cancelled after one capture and retried
- **WHEN** the unchanged manifest is retried
- **THEN** completed evidence is reused, missing sources can finish, and no source or Wiki page is silently overwritten
