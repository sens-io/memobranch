# Make approved memory easier to use and review

## Why
The competitor research identified three useful first-stage improvements: connect an agent without repetitive setup, understand proposed knowledge changes before approval, and measure whether retrieval improves representative tasks. The approved scope is the first stage of `docs/competitor-research-2026-10-20.md`.

## What Changes
- Preview-first client setup, verification and removal, preserving unrelated configuration.
- Opt-in Harness recall of approved memories and Wiki pages, plus bounded completed-turn evidence capture.
- Authorized, version-checked Wiki before/after previews, correction-to-evidence planning and actual retrieval signal explanations.
- A reproducible synthetic evaluation dataset, offline protocol checks and explicitly enabled live-model evaluation with budgets and honest result labels.

## Impact
Existing permissions, immutable evidence, approval, source restrictions, cancellation and transaction recovery remain authoritative. No database or required vault schema migration. No automatic publication, deployment, credential storage or approval of generated knowledge.
