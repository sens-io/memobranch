# Import explicitly selected public web sources

## Why
Directory imports and source-version inspection are available, but users still have to copy public documentation into local text files. Add a bounded public-web source path without turning the vault into a general-purpose network proxy or automatically approving knowledge.

## What Changes
- Public HTTPS-only source reads with address validation, pinned connections, verified TLS, bounded redirects, time, headers and body bytes.
- Preview/apply manifests for at most 20 explicitly selected URLs, with original/final URLs, media type and source-byte hashes; apply re-fetches and validates every source before the first capture.
- Lossless UTF-8 source envelopes saved through existing immutable evidence transactions, preserving provenance and idempotency.
- Library and CLI entry points with owned cancellation, progress and resumable duplicate-safe capture.

## Non-goals
No crawler, JavaScript execution, article extraction, login/cookies, custom headers, proxies, binary/PDF ingestion, background queue or automatic Wiki approval. Do not expose arbitrary network reads through Web/MCP/Harness in this increment.

## Impact
No database, required config, vault-format or dependency changes. Existing directory imports, source timelines, policy, encryption and Wiki review continue to apply.
