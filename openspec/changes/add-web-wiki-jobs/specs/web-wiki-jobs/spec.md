## ADDED Requirements

### Requirement: Authenticated task management preserves authority
The local console MUST preserve the current startup identity, tenant and operation authority. Inspection, execution and review MUST require coverage of the job's original scope/sensitivity ceiling. Cancel/remove MUST require current tenant/read/write authority and the original owner, but MAY clean up that owner's job after its context scope narrows without disclosing the old context. Read operations MUST NOT start compilation or approve knowledge. Credentials and caller-controlled identities MUST NOT be accepted.

#### Scenario: A reader or foreign identity tries to mutate a task
- **WHEN** an authenticated request lacks the operation's current authority or names a foreign job
- **THEN** it is refused without model calls, canonical changes or content disclosure

### Requirement: Explicit server-owned execution
Only an explicit confirmed request MAY start a bounded attempt. A Web handle MUST bound owned attempts and stop/await them on shutdown. Browser disconnection MUST NOT cancel an accepted attempt or cause automatic retries.

#### Scenario: Browser closes or two start requests race
- **WHEN** the browser closes after acceptance or another start is submitted
- **THEN** at most one owned attempt runs, its persisted state remains observable, and no second model invocation is automatically started

### Requirement: Review binds approval to the displayed plan
Plan and canonical comparison MUST be read consistently. Approval MUST match the displayed proof and revalidate current review authority, original execution ceiling and source/knowledge lifecycle.

#### Scenario: A ready task is cancelled and retried after preview
- **WHEN** the user approves the earlier proof while the job retains a different plan
- **THEN** approval is refused and the new plan is not applied

### Requirement: Task interface reports persisted state safely
The task interface MUST show real stages, attempts and safe errors, distinguish queued/ready/applied outcomes, keep explicit mutation controls, and stop polling on navigation/logout or while hidden. Stale responses MUST NOT repopulate a disconnected session.

#### Scenario: A list response or preview arrives after leaving the page
- **WHEN** its page or session is no longer current
- **THEN** it cannot render content or approval controls, and no automatic work starts
