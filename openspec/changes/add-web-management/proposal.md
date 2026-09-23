# Local Web management console

## Why
Operators need to browse and review durable memory, run the distinct Wiki workflows, and configure a vault without manually editing managed files.

## What Changes
- Add `memobranch web --root PATH --port 0`, a loopback-only, token-authenticated management console bundled in npm.
- Provide authorized record browsing/capture/proposals/review/revocation, Wiki catalog/ingest plans/query/explicit filing/lint/apply/rules, settings, history and maintenance actions.
- Add a strict, version-checked settings update through the existing journal and Git transaction boundary.
- Keep credentials, identity, tenant, encryption policy, remote URL configuration and irreversible erasure outside the browser. No hosted or multi-user service is introduced.

## Impact
- New HTTP/UI adapter and tests; bounded additions to MemoryVault and CLI.
- Existing CLI, MCP, Harness, Git persistence and Wiki approval semantics remain unchanged.
