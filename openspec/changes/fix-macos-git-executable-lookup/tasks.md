## Implementation

- [ ] Resolve macOS Git from current PATH/cwd without failed candidate launches or stale caching; preserve child environment and argv0.
- [ ] Preserve unavailable/changed executable semantics and safe failed-start fallback without retrying an executed Git operation.
- [ ] Include discovery/fallback in the existing deadline and cancellation boundary, including accurate push-not-started evidence.

## Verification

- [ ] Verify executable priority/permissions, path changes, spaces, relative/empty entries and symlink traversal through public Git operations.
- [ ] Verify failed-interpreter fallback, absent Git, cancellation/deadline before launch and existing transport/cleanup/commit regressions.
- [ ] Pass original full 38/37-case macOS Node 20 collections under both actual Git defaults in the original inherited environment, with no preload or assertion/deadline/skip change.
- [ ] Run affected checks on Node 20/22, appropriate full checks, same archive consumers, strict OpenSpec and current production dependency audit.
- [ ] Independently review committed repair and final acceptance candidates, fix confirmed issues and retain all prior failures and diagnostic baselines.
