# Implementation checkpoint

Status: **in progress, not release-approved**. Source of truth is the current worktree and fresh command output; this checkpoint is not completion evidence.

- Branch: `codex/deepseek-harness-plugin`; starting commit: `172d0e5`.
- Implemented draft: six page purposes, rules, catalog-first compilation/query, explicit filing/apply, structural/semantic lint, dependency-aware permissions, encrypted persistence, legacy-memory navigation, public catalog, and CLI/MCP/Harness entry points.
- Verified on the working candidate before the next proof-binding changes: strict build/test typing; five core integration tests; seven real CLI/MCP/official Harness Wiki adapter tests; twenty retained memory/permission/provenance/embedding tests. These are partial gates, not the complete acceptance matrix.
- Early audit fixes already written: body links cannot bypass explicit dependencies; catalog metadata participates in output restrictions; doctor/sync inspect Wiki provenance; lint retains structural results on model failure; dependent-page changes are included in the reviewable atomic plan.
- Active work: authenticate query results/plans/receipts against tampering; idempotent explicit filing; installed-package Wiki gate; encrypted Wiki erasure; more schema, concurrency, lifecycle, cancellation and recovery tests.
- Still required: map all 44 acceptance criteria to executed evidence; update user documentation; all retained/new tests; supported Node/Git-default/platform matrix; production dependency audit; strict OpenSpec and package gates; split local commits; isolated read-only review of the exact committed candidate and repairs until no confirmed issue remains.
- No push/publication authorized by this goal. No implementation commit or final independent approval yet.

Environment: use explicit working directory `/Users/imac/code/memobranch` because the original task directory was removed. Supported local verification runtime is Node 22.17.0. Write approvals briefly failed for exhausted workspace credits and later recovered; do not route around a rejected approval.
