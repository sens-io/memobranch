## ADDED Requirements

### Requirement: Recall includes approved Wiki with bounded references
Recall MUST include only authorized active memory and eligible Wiki pages with their actual revisions, evidence, conditions and uncertainty. Whole reference blocks MUST fit the configured budget; omissions are explicit and neither hidden records nor their counts are exposed.

#### Scenario: An agent starts a new session
- **WHEN** it requests automatic recall after an earlier authorized Wiki approval
- **THEN** it receives relevant approved ordinary knowledge and Wiki references without approving new content or requiring a model call

### Requirement: Client setup is reviewable and reversible
Client configuration changes MUST be previewed and revision checked, preserve unrelated data and avoid persisting secret provider credentials or encryption keys. Removal MUST affect only unchanged entries owned by MemoBranch.

#### Scenario: Configuration changes after preview
- **WHEN** setup attempts to apply an old preview
- **THEN** it refuses without overwriting the intervening configuration

### Requirement: Host automation is opt-in and owned
Automatic recall/capture MUST use supported host lifecycle interfaces, server-owned permissions and bounded inputs. Capture MUST retain evidence or candidates only, ignore unsuccessful turns and deduplicate repeated delivery. Unload MUST cancel and await owned work.

#### Scenario: Automatic capture is disabled or a turn fails
- **WHEN** the host emits a completed-turn event
- **THEN** disabled capture and failed/aborted turns do not add evidence or canonical knowledge

### Requirement: Review shows actual authorized changes
Wiki previews MUST validate signatures, authority and stale inputs and show canonical before/after versions, source restrictions, diffs and explicit affected pages. Corrections MUST preserve raw user evidence and produce separately approved plans; explanations MUST reflect actual retrieval signals rather than invented reasoning.

#### Scenario: A reviewer prepares a correction
- **WHEN** the user provides a correction to an accessible page
- **THEN** their words are captured as evidence, a bounded signed plan is proposed and no Wiki page changes until separately approved

#### Scenario: A plan is stale or belongs to a more privileged reader
- **WHEN** another user requests its preview
- **THEN** it fails before returning hidden current or proposed content

### Requirement: Evaluation distinguishes protocol from model quality
Evaluation MUST reset case state, identify dataset/model/configuration and report mechanical correctness, citations, latency and observed usage separately. Fixture mode MUST NOT claim real-model quality. Live mode requires explicit enablement and bounded requests/time/output; unknown cost remains unknown.

#### Scenario: A fixture comparison or exhausted live budget completes
- **WHEN** a report is generated
- **THEN** its mode, skipped/failed cases and unavailable semantic/cost assessment are explicit and no fabricated pre/post improvement is claimed
