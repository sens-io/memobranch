## Implementation
- [x] Add bounded worker parsing with cancellation and honest page extraction limits.
- [x] Bind immutable originals and page text to existing evidence/encryption/transaction rules.
- [x] Add local preview/apply, original retrieval and CLI commands without server file reads.
- [x] Exclude original bytes from model inputs and document source-only compatibility.

## Verification
- [x] Cover parsing, limits, drift, tampering, cancellation, retries, authority and encryption.
- [x] Verify page provenance and original bytes through an installed consumer on Node20/22.
- [x] Run both Git defaults, strict specifications and dependency audit.
- [x] Independently review committed candidates and resolve confirmed findings.

Evidence and limitations: [verification record](../../../docs/pdf-import-verification-2026-10-21.md).
