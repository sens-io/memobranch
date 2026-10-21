## ADDED Requirements

### Requirement: Preview-bound local PDF evidence
Only explicit local selections MAY be imported. Apply MUST revalidate the complete source and extraction preview before writing and MUST preserve exact original bytes separately from page-labelled text, with immutable digest validation and existing confidentiality/transaction boundaries.

#### Scenario: The source or a page hash changes after preview
- **WHEN** the user applies that preview
- **THEN** no evidence or canonical knowledge is written and a new preview is required

### Requirement: Bounded interruptible extraction
PDF parsing MUST run outside the caller event loop with enforceable time, source-byte, page, JavaScript-heap and text limits. Cancellation MUST terminate owned parsing without cancelling another invocation. Embedded actions and network access MUST NOT execute. The implementation MUST NOT present thread heap limits as an operating-system sandbox or a guarantee about all native allocations.

#### Scenario: Parsing exceeds its deadline or the caller cancels
- **WHEN** the worker is still running
- **THEN** it is terminated before the operation returns and no capture starts

### Requirement: Honest provenance and model inputs
Extracted text MUST retain page numbers, parser identity and extraction warnings. Completely textless or encrypted PDFs MUST NOT be reported as successfully parsed. Original bytes MUST NOT be included in model source or context payloads.

#### Scenario: An authorized PDF evidence source is compiled into Wiki
- **WHEN** model input is constructed
- **THEN** it contains the page-labelled extracted text and source identity, not the encoded original, and approval remains a separate operation
