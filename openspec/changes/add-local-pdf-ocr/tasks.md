## Implementation

The [internal processing checkpoint](../../../docs/pdf-processing-core-verification-2026-10-28.md)
has code, related/runtime tests and one actual native image-only control. The later
[local import checkpoint](../../../docs/pdf-processing-import-verification-2026-10-29.md)
adds public library/CLI save/read code, immutable encrypted media and actual mixed
native save/read evidence. Keep full tasks below open until Windows ownership,
integrated behavior, complete gates and final review are verified.

- [ ] Define host-owned local processor configuration, strict opt-in page selection and bounded provenance.
- [ ] Implement owned rendering/OCR with complete output, cancellation, deadlines and private temporary cleanup.
- [ ] Preserve immutable original/page bytes and extraction under existing evidence/encryption/transaction rules with explicit compatibility.
- [ ] Add local library/CLI operations, authorized media retrieval and complete output bounds without server file readers.
- [ ] Add bilingual setup, coverage, dependencies, limits and compatibility instructions.

## Verification
- [ ] Actual synthetic scanned/mixed PDFs: exact original/page provenance and explicit unprocessed/empty-page reporting.
- [ ] Actual installed local renderer/OCR; unavailable tools/languages, malformed files and profile/source/output drift refusal.
- [ ] Real process waits/cancellation/excessive output, owned cleanup and another operation's files/process survival.
- [ ] Classification, keys, permission/tenant changes, DTO/model blob omission and strict server-field refusal.
- [ ] Actual transaction readiness/recovery, immutable retries and old-format compatibility.
- [ ] Same installed archive on Node 20/22, both Git defaults, strict OpenSpec and production dependency audit.
- [ ] Independent read-only review of committed candidates; close confirmed findings and preserve all failed attempts.
