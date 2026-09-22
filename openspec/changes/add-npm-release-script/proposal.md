# Safe one-command npm releases

## Why
The Web console needs a versioned npm release with repeatable validation and protection against publishing an untested artifact.

## What Changes
- Add a dry-run-by-default release command and explicit publication mode.
- Verify the exact packed artifact before upload and read back registry integrity.
- Document maintainer authentication, immutable versions and ambiguous failure handling.

## Impact
- Release tooling, package version, package smoke tests and bilingual installation instructions.
- No change to canonical memory or Wiki authorization behavior.
