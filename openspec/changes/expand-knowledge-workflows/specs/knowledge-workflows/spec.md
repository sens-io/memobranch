## ADDED Requirements

### Requirement: Context preserves complete authorized records within budgets
Context MUST enforce character and optional token limits on the final rendered string, preserve complete references, conditions and uncertainty, deduplicate resident/retrieved identities, and identify estimation versus caller-supplied counting. Omission reporting MUST NOT expose unauthorized records.

#### Scenario: A record exceeds the remaining budget
- **WHEN** an authorized record does not fit
- **THEN** the entire record is omitted and the result reports a budget omission without truncating its conditions or citations

#### Scenario: A preference matches search and resident selection
- **WHEN** context is assembled with both sources
- **THEN** the record appears once and unused resident capacity can be used by retrieved knowledge

### Requirement: Imports are explicit bounded and retryable
Directory imports MUST require an explicit preview, verify content revisions before writing, restrict reads to regular UTF-8 text/Markdown files under the selected directory, and reuse existing evidence identity, permissions, encryption and transactions. Imports MUST NOT approve canonical knowledge.

#### Scenario: Source drift or symbolic link appears after preview
- **WHEN** apply revalidates the preview
- **THEN** it refuses before saving any source from that apply

#### Scenario: Import cancellation and retry
- **WHEN** cancellation interrupts a multi-file import
- **THEN** completed evidence commits remain identifiable and retrying unchanged sources does not duplicate evidence

### Requirement: Source history distinguishes recorded time from fact validity
Source timelines MUST use only authorized immutable evidence and authorized derived pages, support bounded recorded-time filters, preserve prior versions and explicitly label update-review status. They MUST NOT claim to reconstruct historical facts or restore erased knowledge.

#### Scenario: A document changes and is imported again
- **WHEN** an authorized user inspects its source timeline
- **THEN** both evidence versions remain available and pages still referencing older evidence are reported as needing review rather than silently overwritten

#### Scenario: A reader has narrower scope or sensitivity
- **WHEN** it requests a timeline
- **THEN** inaccessible source versions and pages do not appear in content, identifiers or counts
