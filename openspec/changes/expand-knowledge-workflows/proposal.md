# Extend bounded context and source workflows

## Why
The first adoption phase is complete. The next roadmap phase needs whole-record context budgets and repeatable document imports before larger connectors and historical answering can be delivered safely.

## What Changes
- Token-budgeted context with replaceable local counting, whole citations/conditions, resident/retrieved allocation, deduplication and explicit omissions.
- Preview/apply imports for explicitly supplied local text/Markdown directories, bounded progress, cancellation and idempotent retries using existing evidence transactions.
- Authorized source-version timelines, recorded-time filters and affected-page/update reporting. Recorded time is not represented as fact-effective time.

## Non-goals
No automatic approval, arbitrary server-side file access, background daemon, PDF parser, cloud connector, shared-vault merge, or executable skill generation. General HTML/web crawling and fact-effective historical reconstruction remain separate increments; this change must not advertise them as complete.

## Impact
Additive library and CLI operations; existing recall/context adapters gain optional budgets. No required configuration, database, or vault-format migration. Existing encryption, source identity, tenant and operation permissions remain authoritative.
