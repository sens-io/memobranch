# Read pinned Wiki revisions without restoring old access

## Why
Developers need reproducible committed knowledge for comparisons and a foundation for version-pinned consumers. Existing source timelines and effective dates do not return old compiled Wiki text.

## What Changes
- Add an explicit local library/CLI read of 1–25 keys at a full local ancestor commit.
- Return complete historical dependency pages, source hashes and rule revisions, plus the current authority revision and clear historical warnings.
- Enforce both historical validation and current tenant, classification, lifecycle, source and key access under the existing reader/writer lock; never checkout or restore files.

## Non-goals
No share tokens, cross-account ACLs, offline exports, remote fetching, arbitrary refs, automatic approval, historical model answering, as-known-at date reconstruction, Web/MCP/Harness endpoints, pushes or publication. This is a local read-only revision view, not complete shared-vault support.
