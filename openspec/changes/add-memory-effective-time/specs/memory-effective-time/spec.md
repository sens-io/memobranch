## ADDED Requirements

### Requirement: Reviewer-controlled effective intervals
Ordinary memories MAY have explicit start-inclusive/end-exclusive effective timestamps independent of recorded time. Annotation MUST require current review authority and the expected current revision in the canonical transaction. It MUST NOT change raw evidence, statement or lifecycle, or revive a revoked/erased record.

#### Scenario: Two reviewers annotate the same revision
- **WHEN** concurrent requests use the same expected revision
- **THEN** at most one distinct change succeeds and the other is refused as stale

### Requirement: Dated views preserve current authority and uncertainty
A dated read MUST use current retained records and current authorization, evidence access and lifecycle checks. It MUST NOT restore old Git content or erased keys. Missing effective intervals MUST be unknown, not inferred from recorded time, and excluded unless explicitly requested. Superseded/conflicted records MUST carry warnings.

#### Scenario: A record is withdrawn or has inaccessible evidence
- **WHEN** a reader requests a date at which its former interval applied
- **THEN** the record and its metadata/count contribution remain absent

### Requirement: Current context respects effective intervals
Current search, recall, resident context and Wiki dependencies MUST exclude not-yet-effective or ended ordinary memories before content reaches a provider or caller. Returned records MUST retain explicit temporal conditions.

#### Scenario: A legacy memory supporting a Wiki page is outside its interval
- **WHEN** current retrieval, navigation or query reads the knowledge
- **THEN** neither that memory nor a page dependent on it is eligible as current knowledge

#### Scenario: A provider wait crosses the effective end
- **WHEN** a later embedding batch, retry, or answer would reuse the earlier context
- **THEN** ended content is not sent again, stale answers are refused, and ended matches do not consume current result slots

### Requirement: Time contracts are explicit across adapters
Supported adapters MUST validate timezone-bearing ISO timestamps with at most millisecond precision and distinguish dated retained-record views from historical knowledge reconstruction. Reads MUST NOT mutate canonical knowledge or call a model. HTTP annotation MUST require explicit confirmation.

#### Scenario: A caller supplies a calendar-invalid date or ambiguous timezone
- **WHEN** annotation or dated read is requested
- **THEN** it fails before any canonical mutation
