# Cloud sharing design

## Common contract

All modes select a host-configured source alias and 1–25 distinct page keys. New
cloud/Git transports require a complete displayed commit precondition; the accepted
version 1 local API retains its optional precondition. The precondition refuses a
changed pin; it cannot choose an arbitrary revision. Preserve current tenant, reader grant,
scope, sensitivity, explicit private selection, key, dependency, withdrawal,
conflict and time checks. Source identity and relative provenance remain visible;
absolute roots, credentials, host account lists and environment variable names do
not enter results or errors. No automatic local knowledge write occurs.

Version 1 local binding files keep their behavior. A separate, strict version 2
binding format will discriminate local, cloud and Git transports. Old programs
must reject version 2 rather than partially interpreting a remote binding as local.
Host files are bounded regular UTF-8 files with replacement/symlink checks. Inputs
and responses are parsed strictly and cloned before asynchronous work. Catalogs
only list configured readable aliases; availability is checked on an explicit read.

## Self-hosted service

Provide a separate Node service, initially through the library, then a CLI command.
It serves only `POST /v1/shared-wiki/catalog`, `POST /v1/shared-wiki/snapshot` and a
minimal `GET /healthz`. There is no management shell, upload, mutation, raw-file,
model, credential creation or grant editing endpoint. Do not expose the local Web
management server on a public interface.

A host-owned service file (version 1, at most 100 accounts and 100000 bytes) maps
each account ID and SHA-256 bearer-token digest to one existing broker vault,
expected vault/tenant IDs, its existing local source-binding file, allowed scopes
and maximum sensitivity. IDs and token digests are unique. Accounts have only read
authority; removing an account or rotating its digest revokes subsequent reads.
The operator generates a random credential and distributes it privately; no
password database or automatic registration is added. Stored digests are not
encryption keys. Tokens never come from request JSON or query strings.

Each request supplies attenuation containing scopes and maximum sensitivity; these
can only reduce the server account's authority. The server creates its own
principal from the matched account and derives source authority through the
existing reader. Request fields cannot select another account, tenant, root, host
binding, environment key, model URL or callback. Server-side source bindings are
local-only in this version, preventing recursive cloud requests and credential
forwarding. The broker vault identity must match the account's expected identity.

Authenticate before opening a broker or source. Reload and compare the service
file, account/token and source binding after asynchronous reads and before a fully
buffered response is written. Keep source time checks live until that write.
Bound input to 65536 UTF-8 bytes and output to 21000000 UTF-8 bytes; never truncate
an otherwise valid view. Enforce finite request/header/body deadlines, global and
per-account request budgets and concurrent-request limits. Reject browser Origin
headers, unsupported methods, content types, paths and duplicate credentials.
Errors expose a stable safe code and generic message, not internal exception text.
Disconnect, deadline and stop cancel ongoing vault/Git work; stop drains owned
requests and connections. Requests do not perform canonical mutations.

Default binding is loopback HTTP. A non-loopback listener requires native HTTPS
with host-provided bounded certificate/key files and an explicit HTTPS public
origin. Do not trust forwarded headers or add an insecure public HTTP switch.
Clients use normal certificate validation; a self-signed local fixture is trusted
only by that fixture's client. TLS material changes require a service restart;
account and source grants are reloaded per request.

The snapshot envelope carries the complete view, combined historical/current
support and a short remaining validity interval (at most 30 seconds), calculated
from the final server check and earliest source expiry. A client measures this
interval conservatively from its monotonic request start, so network delay and
clock skew cannot extend server-side validity. New approvals fetch again; a lease
is not a reusable authorization token. An already delivered consistent read may
precede a concurrent revocation. Previously copied plaintext cannot be recalled.

## Cloud client

A host binding fixes HTTPS origin, remote source alias, expected vault/tenant,
full pin, local reader tuples, ceilings and a credential environment variable.
An optional host-owned `caFile` provides a private service's CA certificate without
disabling normal certificate/hostname verification. Its bounded regular-file
contents are checked again and included only as a hash in private import-proof
context; they are never returned as source metadata.
Only explicit loopback development bindings allow HTTP. Reject URL credentials,
queries, fragments, redirect responses, oversized or malformed envelopes and
identity/pin mismatches. Never forward tokens on redirects. A failed or cancelled
read returns an error, never a cached view. Local caller ceilings are sent as
attenuation, before server-side decryption; local ceilings are checked again.

Returned runtime guards retain the short lease, local identity/config and selected
credential hash while import proof work or destination lock waits proceed.
Credential hashes stay in private proof context, never serialized review plans.
Source and destination locks are never held together. Existing CLI/MCP/Harness/Web
catalog/snapshot entry points use the transport selected by the host file. The
browser never receives or stores cloud credentials.
The service constructs readers with host-only `localOnly: true`, rejecting cloud
and Git bindings before endpoint access. Version 2 accepts `local`, `cloud` and
the owned-cache `git` candidate. Whole-batch delivery remains pending.

## Git remote

The concrete cache, limits, key provisioning and recovery contract is specified
in [the owned-cache design](git-cache.md).

A host binding fixes a credential-free HTTPS/SSH Git URL, one explicit branch,
full pinned ancestor, expected vault/tenant, reader tuples and classification
ceilings. Native host Git credentials and SSH trust remain operator managed.
Never accept host keys automatically or run source-selected commands. A dedicated
cache, owned beneath the broker's runtime directory, has a sentinel and rejects
symlinks, replacement and foreign state. It is not a user's working checkout.

An explicit remote read refreshes that branch before validation; a failed fetch
or lost access refuses, even if an old cache exists. Current remote branch state
governs withdrawal and classification, while the selected pin remains unchanged.
Force-pushed history that no longer contains the pin refuses. Cache refresh may
update its own refs/index/files, never source or destination canonical knowledge;
no push, Git merge or automatic pin update occurs. Refresh locking must not nest
with a caller lock and must not lose separately provisioned decryption keys.

Do not use ordinary whole-vault sync as a shortcut: a public shared read must not
require decryption of unrelated secret records. Validate a bounded managed tree
before materialization; reject symlinks, submodules, unsupported paths, hooks and
filters, then let the selected Wiki reader validate/decrypt the required graph.
Encrypted Git content still requires separately provisioned master/per-record
keys; repository access alone does not grant plaintext. Bound command time,
output, managed files and cache size. These checks are not an operating-system
disk quota; document that large pack transfers need host resource limits too.

## Delivery gates

Finish service, both clients, adapters, bilingual setup and the compatibility
contract before accepting this batch. Tests cover actual HTTP/HTTPS and bare Git
fixtures, authorization and private-data boundaries, revocation during waits,
deadlines/cancellation/shutdown, complete bounded responses, current restrictions,
force-push/fetch failure, unchanged canonical data, source evidence and keys.
Retain both Git defaults, the same installed artifact on Node 20/22, actual browser
checks, strict OpenSpec, production dependency audit and independent fixed-commit
review. Passing a server-only candidate is not full cloud-sharing acceptance.
