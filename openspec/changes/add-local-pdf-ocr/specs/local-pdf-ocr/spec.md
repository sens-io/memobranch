## ADDED Requirements

### Requirement: Local page processing must be explicitly selected
The system SHALL keep existing text-only PDF behavior unchanged by default.
Rendering and OCR SHALL require explicit selected page numbers and host-provisioned
local processors, without request-selected commands or network/model access.

#### Scenario: A scanned page is selected for OCR
- **WHEN** an operator explicitly selects a scanned page and an installed permitted language
- **THEN** local rendering and OCR produce a reviewable derived extraction with exact page and processor provenance
- **AND** the original PDF is retained byte-for-byte and capture does not approve Wiki knowledge

#### Scenario: A dependency or language is unavailable
- **WHEN** rendering/OCR is selected but its configured processor or language data is missing or invalid
- **THEN** processing refuses with an honest dependency error and performs no installation, download or partial evidence capture
- **AND** the existing unselected text-only workflow remains available

### Requirement: Originals and derived page content must remain distinguishable
The system SHALL bind exact original bytes, selected page image bytes, recognized
text, processor/config/language-data identities and extraction coverage in immutable
evidence. Existing classification, encryption, authority and transaction checks
SHALL cover the complete record, including images and hidden original content.

#### Scenario: A result or processor changes before capture
- **WHEN** original bytes, selected page output, processor binary, configuration or language data changes after preview
- **THEN** application refuses the old preview without accepting a changed result or modifying existing evidence

#### Scenario: The selected extraction is incomplete
- **WHEN** only some pages are processed or OCR misses text, ordering, diagrams or tables
- **THEN** the result identifies exact selected/unprocessed/empty pages and labels recognized text as unverified extraction
- **AND** no claim of complete visual understanding or verified factual correctness is added

#### Scenario: An older program opens processed evidence
- **WHEN** an older reader does not support the new processed-PDF evidence format
- **THEN** it rejects the format rather than treating derived OCR as the old text-only format
- **AND** existing ordinary and text-only PDF evidence is not silently migrated

### Requirement: Owned processing must stop within explicit limits
The system SHALL bound source bytes, pages, selected pages, output dimensions,
decoded pixel counts, image bytes, recognized characters, process output and
execution time. Cancellation and failures SHALL stop and await owned processors,
clean owned temporary files and leave source/canonical data unchanged before
transaction readiness. Limits SHALL distinguish output/work limits from any
unavailable hard operating-system memory guarantee.

#### Scenario: Actual processing is cancelled or exceeds limits
- **WHEN** a real renderer/OCR process blocks, emits excessive output or exceeds a declared limit
- **THEN** owned processing is terminated and awaited, complete results are refused rather than truncated, and no partial evidence is captured
- **AND** another operation's process and files remain intact

#### Scenario: Cleanup follows a safely committed capture
- **WHEN** cancellation occurs after the existing safe commit boundary
- **THEN** durable work is settled and its actual commit is reported under existing capture/recovery rules
- **AND** exact retry and authorized original/page retrieval preserve immutable bytes

### Requirement: Local processing must preserve adapter and disclosure boundaries
Local library/CLI use MAY accept operator-selected paths; MCP/Harness/Web requests
SHALL NOT gain arbitrary filesystem readers, executable choices, credentials,
grant editing or automatic model calls through this capability. Public/Agent
DTOs and model inputs SHALL omit encoded original and page image blobs unless a
separately authorized bounded media read explicitly requests them.

#### Scenario: A server caller attempts a local file or executable override
- **WHEN** a request supplies a local source path, processor path, arbitrary command, output path or model URL through a server tool
- **THEN** the unsupported fields are rejected before local file access or process execution
- **AND** normal authorized evidence inspection retains existing redaction and size limits
