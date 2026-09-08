# Verification: Harness operation boundaries

Date: 2026-09-08
Base: `582b1a03463536ddad946ce6104a9761e8d75202`

## Scope and evidence

This change closes the five findings from the Harness review: operation-specific read authorization, post-commit cancellation, cross-session cancellation, unbounded Git transport, and a peer range that excluded the tested prerelease. It does not claim to prove absence of unrelated or future defects.

The earlier `2026-09-04-add-deepseek-harness-plugin` verification overstated prerelease compatibility and cancellation coverage. This report supersedes those assertions: default semver matching and real registry invocation are now explicit gates.

## Automated gates

- Clean `npm ci --ignore-scripts --no-audit --no-fund` installed locked dependencies into the independent persistent worktree, without changing the original repository's dependencies.
- `npm run check`: final build and **87/87 tests passed**, no skips (20.1 seconds). The full run was permitted to use loopback listeners for the existing maintenance/provider tests. The earlier pre-acceptance run passed 86/86 before the additional push/pipe-close regression was added.
- The **24 new boundary regressions passed independently** in acceptance: 7 permissions, 7 Git, 5 real Harness runtime, 3 recovery/erasure/provider, and 2 semver checks. The original 23-test boundary set also passed a separate repeat run before the final Git case.
- The five new TypeScript test files passed a separate strict no-emit typecheck with the NodeNext module mode and Node types.
- `npm audit --omit=dev --json`: **0 known production vulnerabilities** at verification time.
- `npm pack --dry-run --json`: **68 package entries**, including the bundle patch, compiled Harness entry point and declarations, and the operation context module. npm used a disposable cache because sandbox access to the user's cache was denied; no cache permission changes were made.
- Compiled self-exports `memobranch` and `memobranch/deepseek-harness` loaded into the actual Cordis/SystemPrompt/ToolRuntime registry. A write-only principal had two visible tools and successfully captured evidence.
- Strict OpenSpec validation: active change plus six canonical specifications passed.
- `git diff --check` passed.

## Boundary and retention coverage

The new tests assert actual evidence count and hashes, candidate counts, committed HEADs, transaction journal and lock cleanup, provider signal ownership, helper process liveness, absence of late helper writes, peer-range matching, and plugin unload completion. Permission tests retain external-read denial during ongoing encrypted writes and enforce tenant, scope, sensitivity and provenance.

The preexisting 63 tests remain unchanged and cover CLI, MCP, vault schema migration, encryption, evidence immutability, cross-process cache invalidation, canonical validation, Git synchronization/rollback, lock safety, maintenance health, provider bounds and representative-corpus search performance. The original post-commit index failure injection remains effective.

## Independent acceptance

Read-only acceptance used isolated reviewer context, actual code and independent deterministic probes. The reviewer reproduced an additional P1: Git push had exited successfully, but a helper retained stderr until timeout; the local sync then incorrectly rolled back the revision already accepted by the remote. A separately reproduced regression failed before the fix. The runner now preserves an already-observed successful exit during timeout cleanup, and the added test verifies matching local/remote reconciliation commits, receipt, helper termination and absence of late writes.

The second acceptance pass approved the five requested fixes with no remaining actionable findings in this bounded review. It independently reran all 24 boundary tests, with zero failures or skips. No tests, source files or evidence were edited by the reviewer.

## Limitations and rollout

- No real external model request or production remote was used; deterministic provider gates and disposable local remotes exercise the boundaries without credentials.
- POSIX process-group cleanup was executed on macOS. The Windows `taskkill` fallback is implemented but not executed in this environment.
- A push interrupted before Git reports success can have an uncertain remote outcome. Confirm remote state before retrying; local cancellation is not a promise of remote rollback.
- Compatibility is verified against locked Cordis `4.0.2` and dsh-tools `0.1.2-rc.1`, not all future releases.
- Changes remain local on the existing feature branch until the user authorizes a push. No production vault data was changed.
