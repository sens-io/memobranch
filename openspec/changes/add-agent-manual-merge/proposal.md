# Agent access to local Wiki revisions and manual merge preparation

## Why
The core, CLI and Web console can read committed Wiki revisions and prepare human-authored same-vault merges. MCP and DeepSeek Harness still lack these operations, forcing agents to use other entry points.

## Scope
Expose `memory_wiki_snapshot` and `memory_wiki_merge_prepare` through the existing two adapters. Reuse strict core input schemas and current identity, source, lifetime, confidentiality and transaction checks. Keep full results bounded and approval separate through the existing signed-plan preview/apply tools. Add actual protocol/SDK, cancellation and installed-package regressions.

No model rewriting, automatic approval, changed grants, cross-vault/branch import, persistent jobs, browser changes, configuration migrations or publication.
