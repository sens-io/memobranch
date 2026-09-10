## Implementation

- [x] Authorize evidence diagnostics before decryption.
- [x] Authorize every semantic provider batch.
- [x] Preserve merged derivation restrictions and rendered provenance.
- [x] Isolate unrelated staged changes from operation commits.
- [x] Keep remote configuration compensation inside the writer lock.
- [x] Make test branch selection explicit and add CI environment coverage.
- [x] Add actual package installation and Harness runtime smoke gate.
- [x] Resolve independent-review finding: durable sync rollback survives restoration failure.
- [ ] Resolve follow-up finding: remote-configuration compensation and index cleanup survive failure and restart.

## Verification and acceptance

- [x] Verify the first candidate with 105/105 tests on macOS/Node 22 and Linux/Node 20.
- [x] Independently review the first candidate and record its rejection.
- [x] Re-run focused, full, cross-environment and installed-package gates on candidate 727bdef.
- [x] Strictly typecheck new regression files.
- [x] Validate all OpenSpec changes and specs.
- [ ] Independently approve the final committed candidate with no unresolved confirmed finding.
- [ ] Record final evidence and limitations; keep commits local unless separately authorized to push.
