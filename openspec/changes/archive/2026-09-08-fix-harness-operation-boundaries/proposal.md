# Fix Harness operation boundaries

## Why

The independent Harness review reproduced five gaps despite the previous 63-test gate: write-only capture could miss deduplication, review-only operations could not resolve records, cancellation could continue extraction after capture committed, cancelling one call could abort another call's provider work, Git subprocesses could outlive cancellation without a deadline, and the peer range excluded the tested prerelease (the first two permission symptoms share one root cause).

## What Changes

- Authorize internal canonical reads against the permission of the requested operation, without granting external reads or bypassing tenant, scope, or clearance checks.
- Give each invocation its own cancellation context and commit receipts; roll back pre-ready writes and safely settle ready commits, erasure, and recovery.
- Bound Git execution and terminate owned subprocesses on cancellation; preserve already-pushed revisions.
- Declare the tested Harness compatibility range and add real-registry, process, and least-privilege regressions.

## Impact

Affected specifications: production-agent-api, memory-access-control, transactional-vault, remote-git-sync. CLI and MCP keep their public signatures. No remote migration or user data rewrite is required.
