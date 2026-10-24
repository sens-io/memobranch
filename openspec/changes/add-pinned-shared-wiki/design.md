# Design

Use a small `SharedWikiReader` composed with the existing caller `MemoryVault`.
It reads a host-owned absolute JSON configuration path, supplied through trusted
application options or `AMEM_SHARED_WIKI_CONFIG`. No request body can set that path.
The file is versioned as a format, not a new identity database: at most 20 sources
and 100,000 UTF-8 bytes. Refuse symlink/non-regular files and unstable/oversized reads.

Each strict source binding names a stable ID/title, absolute local root, complete
40/64-character pinned commit, expected source vault/tenant IDs, explicit reader
tuples (caller tenant and actor ID), allowed scopes and maximum sensitivity. Reader
tuples are bounded and distinct. An optional environment-variable name supplies a
source-specific master key; credentials never appear in API results or examples.
Absent source key configuration must not fall back to the caller's master key.

First obtain current caller configuration/authorization in its own read snapshot.
Match both caller tenant and actor against the binding even for local admins; no
admin bypass of a missing sharing grant. Source scopes and sensitivity are the
intersection of caller authority and the configured sharing ceiling. The source
principal keeps the caller identity but is bound to the configured source tenant
and has read permission only. Never create ambient local-admin source authority.

Use the source vault's existing snapshot checks within its own coherent read:
current configuration must match the binding, pinned commit must exist locally and
be an ancestor of current source HEAD, managed content must be clean, and current
page/source/rule access, keys, lifecycle and expiry must pass. No checkout, fetch,
ref/index change, model call, proof-key export or canonical mutation is initiated.
Pending transactions/erasures are errors requiring existing explicit recovery.

Do not hold caller and source locks together: cross-configured sources must not
deadlock through opposite lock ordering. After reading, recheck caller authority,
current configuration and host binding/key selection within the final caller read
snapshot. Reject a changed/revoked
grant rather than returning old material or silently selecting a newer commit.
Retain the core's consistent-read semantics for overlapping later source changes;
future reads must honor withdrawal. Retain the source snapshot's existing synchronous
time/cancellation validation callback and run it after the final asynchronous caller /
binding check and lock cleanup. It must check both historical and current page
expiry/fact validity; extra waiting must not make a now-expired page readable.
Use a small internal snapshot-with-validation method, without exposing the callback
or private document hash list through tool/HTTP results. Stop signals remain host-owned and bounded
file/snapshot operations share the existing operation cancellation context. Source
errors expose stable codes rather than absolute roots or transport details.

A catalog reveals only readable configured IDs/titles and pins, without roots,
credentials, other readers or an assertion that all source content is available.
A result identifies the configured source vault/tenant/pin and contains the complete
existing Wiki view plus sharing limits. It is a read result, not an import token or
offline revocation mechanism. All page bodies remain untrusted plain text.

Library, CLI, MCP, Harness and Web adapters reuse strict core schemas. Host config
is optional and off by default; a missing setup is explicit. The local UI lists
authorized configured sources, reads only after selection, clears stale results
on edits/stop/navigation and never edits sharing grants. Complete escaped output
must fit existing agent/Web transport budgets; fail rather than truncate.
