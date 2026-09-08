# Design

## Authorization

Private lookup/directory/document helpers receive an explicit operation permission, defaulting to `read`. Write, review, maintenance and sync workflows use only their own permission. Public get/search/context/history remain read-gated. Derived index refresh and sync health validation have permission-aware internal entry points; no mutable permission field is consulted by read authorization.

## Cancellation ownership

AsyncLocalStorage owns a signal and completed-commit receipts per invocation. Provider requests combine the invocation signal with their own timeout. The plugin lifetime aborts and awaits only calls it owns; cancelling a single invocation cannot cancel sibling sessions.

Every mutation checks cancellation before writes and before the transaction enters ready phase. Before ready, rollback runs with cancellation shielded. Once ready, Git commit and journal cleanup settle with cancellation shielded, under finite Git deadlines. Cancellation then prevents extraction or subsequent transactions and returns only safe operation/commit receipts. Erasure intent, key destruction and tombstone completion form one shielded irreversible section. Started recovery settles before returning.

Git commands have finite deadlines and owned process groups on POSIX. Cancellation and timeouts terminate transport descendants and await cleanup before releasing the vault lock. Rollback is shielded. Once a push reports success, local HEAD must not be reset even if later work is cancelled. An interrupted push can have an uncertain remote outcome; subsequent status verification is required before retrying, not a claim of automatic remote rollback.

## Verification and rollout

Boundary tests reproduce each failure plus neighboring cancellation timings. Existing vault, encryption, recovery, authorization, MCP, CLI and local-remote suites are retention gates. Real Cordis/ToolRuntime calls validate the adapter rather than a mocked registry alone. No paid provider or real production remote is needed; provider gates and local Git fixtures are deterministic.

Changes are committed on the existing feature branch only after verification; no push is implied. Rollback is by reverting these commits, not resetting a user vault.
