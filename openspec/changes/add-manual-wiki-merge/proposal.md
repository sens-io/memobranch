# Explicit review of historical/current Wiki content

## Why
Committed Wiki reads can show an old page, but cannot produce a reviewable human-authored combination with the current page. Copying an old body directly risks dropping provenance, conditions and access restrictions.

## What Changes
- Add local API/CLI preparation of a signed manual merge from one supported local ancestor commit into an existing compiled Wiki page.
- Return the authorized historical graph, current target and ordinary full before/after preview; retain both versions' sources and stricter restrictions.
- Apply only through existing explicit review, with stale input refusal, atomic dependent-page updates and safe identical retry.

## Non-goals
No Git branch merge, foreign-vault import, cross-account sharing, automatic semantic merge, model call, conflict resolution, source approval, OCR, Web upload or new server file-reading tool. This is one same-vault manual review workflow, not complete private/shared-vault merge support.
