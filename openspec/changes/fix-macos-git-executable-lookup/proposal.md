# Fix macOS Git executable lookup

## Why

The retained macOS Node 20 complete adapter collections fail after repeated Git
activity. Ordinary-user controls preserve the executable and original tests:
the inherited 43-directory PATH yields a 7.7-second version-only launch, while
the same Git invoked by absolute path with the original environment yields
17 ms. A temporary short-PATH full matrix passes all four original collections,
but changing the user's PATH is not the product repair or acceptance condition.
See [the diagnosis](../../../docs/macos-git-path-diagnosis-2026-11-02.md).

## What changes

- On macOS, locate the first executable Git in the invocation's current search
  path and working directory without launching failed search candidates.
- Invoke that path with the original child environment, argument vector,
  cancellation, output bounds, deadlines and owned-process cleanup.
- Preserve command-selection and missing/changed executable failure behavior,
  including a safe original-search fallback after a confirmed failed start.
- Retain existing platform behavior outside macOS; add no dependency, runtime
  version requirement, host configuration or security exception.

## Impact

Git runner and public-behavior regressions; updated verification records. No
schema, permission, transport authentication, remote, database, migration or
configuration change. Publication/pushing/deployment remain out of scope.
