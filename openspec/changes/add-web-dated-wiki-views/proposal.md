# Web recorded-time Wiki selection

## Why
The existing snapshot API supports recorded-time selection, but the Web merge workbench only accepts a full commit hash. Readers need an explicit date entry point that makes the selected hash and the limits of mutable Git clocks visible before any manual merge.

## Scope
Add an exclusive commit/date selector to the existing workbench. Date input is an ISO timestamp with explicit timezone, validated by the existing fixed-vault snapshot route. Read current content by the returned authority hash without resending the date. Prepare against the actual resolved historical hash, never resolve the date again during preparation or approval. Preserve current authorization, complete text, confidential selection, separate approval, cancellation and draft invalidation.

No new route, public type, model request, configuration, browser persistence, date-based automatic merge, shared access, as-known-at reconstruction, push or release.
