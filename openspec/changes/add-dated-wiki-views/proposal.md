# Recorded-time Wiki revision selection

## Why
Committed Wiki reads currently require a full hash. Users need a bounded way to select a local version by a stated recorded time, without confusing it with fact-effective dates or what an agent truly knew.

## What changes
Extend the existing snapshot operation with an exclusive `at` selector across the library, CLI, MCP, Harness and authenticated HTTP. Resolve only within current HEAD first-parent history using committer timestamps, then reuse all current revision-view checks and complete-result bounds. Return the actual commit and explicit selection metadata/warnings. Retain existing full-hash input/output behavior.

No historical model answer, date inference, new evidence, checkout, fetching, grants, background task, browser UI change or publication.
