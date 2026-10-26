# Cloud sharing — development candidate

The user selected both a self-hosted service and Git remote sharing. The current
branch contains a **self-hosted read service**, a **cloud client** and a **Git cache candidate**.
Version 2 client bindings and existing read adapters have passed the [client checkpoint](cloud-client-verification-2026-10-26.md).
The [Git library and management checkpoint](git-shared-wiki-verification-2026-10-26.md)
also passed locally. Git-specific CLI/MCP/Harness checks and native service/setup
commands are implemented and under final verification. Whole-batch acceptance is
still pending. This is not a deployment or full
cloud-sharing acceptance.
See the [design and acceptance gates](../openspec/changes/add-cloud-shared-wiki/design.md)
and the [service verification checkpoint](cloud-read-service-verification-2026-10-26.md).

## Accounts and grants

The service uses existing initialized vaults. Each account names a broker vault
and its existing version 1 [local source-binding file](pinned-shared-wiki.md).
The account ID must match an explicit reader tuple in that file, using the broker
tenant. Each source binding independently fixes its source identity, full commit,
source key environment variable and classification ceiling. Nothing is granted
automatically. Account credentials are read-only, even when the host operator is
an administrator.

Create a private host account file; keep it outside tracked vault content. This is
an illustrative shape, not an account created by development:

```json
{
  "version": 1,
  "accounts": [{
    "id": "team-reader",
    "tokenSha256": "<64 lowercase hexadecimal characters>",
    "root": "/srv/memobranch/reader-broker",
    "vaultId": "<existing broker vault ID>",
    "tenantId": "<existing broker tenant ID>",
    "sharedWikiConfig": "/srv/memobranch/private/shared-wiki.json",
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

An operator can generate a random credential and its digest locally:

```sh
node --input-type=module -e 'import { randomBytes, createHash } from "node:crypto"; const token = randomBytes(32).toString("base64url"); console.log(JSON.stringify({ token, tokenSha256: createHash("sha256").update(token).digest("hex") }));'
```

Distribute the token privately. Store only its digest in the account file; do not
put either value in a repository, URL, screenshot or browser storage. Removing an
account or replacing its digest stops new reads. The account and source-binding
files reload during each request. Keep account IDs and digests unique. Files must
be regular UTF-8 files, not final-path symlinks; account configuration is limited
to 100 accounts and 100000 bytes. Update host files atomically.

## Native operator commands

These commands are in the development checkout; the published npm version is not
claimed to contain them. Build the checkout first. All four commands require
admin permission. A restricted agent's read/write policy does not authorize host
setup. Use an authorized operator environment; the commands do not change it.
Run the following examples from the repository root so they use this checkout's
`dist/cli.js`, regardless of any older global npm installation.

Generate an inactive credential and digest on the operator's private terminal:

```sh
node dist/cli.js cloud credentials
```

The JSON contains `token` and `tokenSha256`. Generation writes no file or grant.
Keep the token private and distribute it only to the intended reader. The service
file stores the digest only. Prepare a service-file template using that digest:

```sh
node dist/cli.js cloud account-template --id team-reader \
  --broker-root /srv/memobranch/reader-broker \
  --sources-config /srv/memobranch/private/shared-wiki.json \
  --token-sha256 '<64 lowercase hexadecimal characters>' \
  --scopes project --max-sensitivity internal
```

The broker must already exist and the account ID must match an existing source
reader tuple. Broker IDs are derived from the actual vault, never invented. The
template contains one account, host paths and a digest; treat it as private
configuration. Review it, then explicitly save the JSON with private permissions
(for example 0600) as your service file. For an existing file, explicitly add its
account entry while preserving the others. The command does not persist account
or grant changes; read-lock bookkeeping still uses the private runtime.

Check and run the foreground service:

```sh
node dist/cli.js cloud check --accounts /srv/memobranch/private/cloud-accounts.json
node dist/cli.js cloud serve --accounts /srv/memobranch/private/cloud-accounts.json
```

Check validates broker identities and reports account IDs and current readable alias counts. A zero count
is reported as zero; it does not prove page availability or decryption. Output
does not include account digests or roots. Source brokers accept local bindings
only. Unknown/duplicate flags, missing flag values and extra positional arguments
are refused. `SIGINT`/`SIGTERM` stop the service and its owned work, including
startup checks. No background service installation is performed.

`cloud serve` prints only `status` and `url`. Optional flags are `--host`, `--port`,
`--public-origin`, `--tls-certificate`, `--tls-key`, `--request-timeout-ms`,
`--max-concurrent`, `--per-account-concurrent`, `--requests-per-minute` and
`--per-account-requests-per-minute`, using the library's bounds/defaults below.
Non-loopback listeners need both TLS files and an explicit HTTPS origin. The
service keeps a validated copy of the operator's tenant/scope/sensitivity ceiling;
an account file widened later cannot exceed it. Changing this fixed ceiling needs
a restart. Library hosts can also set the optional `operator` principal; existing
trusted hosts that omit it retain their account-file authority.

For rotation, generate a new credential, explicitly replace that account's digest
with an atomic private-file update and privately update its client's environment.
For revocation, explicitly remove the account. Accounts and source bindings reload
per request; a file change also invalidates work assembled under its old version.
Templates never merge into an existing file automatically.

## Library startup

Build this checkout with `npm run build`. A host program can import its local
build; this example does not claim the published npm version contains the feature:

```js
import { startCloudWikiServer } from './dist/index.js';

const service = await startCloudWikiServer({
  configPath: '/srv/memobranch/private/cloud-accounts.json',
  // Defaults: host 127.0.0.1, an available port, read-only HTTP on loopback.
});
console.log(service.url); // No token or account details are returned.
process.once('SIGINT', () => { void service.stop(); });
```

Non-loopback listeners require native TLS and an explicit public HTTPS origin:

```js
const service = await startCloudWikiServer({
  configPath: '/srv/memobranch/private/cloud-accounts.json',
  host: '0.0.0.0', port: 8443,
  publicOrigin: 'https://memory.example.com:8443',
  tls: {
    certificatePath: '/srv/memobranch/private/fullchain.pem',
    keyPath: '/srv/memobranch/private/privkey.pem',
  },
});
```

Certificate/key files must be regular files of at most 1000000 bytes each. A
certificate change requires restarting the service. Clients must trust its
certificate normally; do not disable certificate checks. The advertised origin
also fixes the accepted Host header. Forwarded headers are not trusted. Direct
browser Origin headers are refused; credentials belong in a host client, not a
browser. The separate local management Web server remains local.

## Read protocol

Only the following routes exist:

| Route | Body and behavior |
| --- | --- |
| `GET /healthz` | Minimal unauthenticated health status; no account or vault details. |
| `POST /v1/shared-wiki/catalog` | Bearer credential and `{"attenuation":{"scopes":["project"],"maxSensitivity":"internal"}}`; configured readable aliases and pins only. |
| `POST /v1/shared-wiki/snapshot` | Same attenuation plus `sourceId`, 1–25 distinct `pageKeys`, mandatory full `expectedCommit`, optional `includeSensitive` / `includeSecret`. |

POST requests require `Content-Type: application/json` and exactly one
`Authorization: Bearer …` header. Attenuation only reduces account authority.
The account, binding and caller ceilings apply before private content is
decrypted. Roots, accounts, grants, tenants, command strings and credentials cannot
be supplied in JSON. Unknown fields, duplicate JSON keys and malformed UTF-8 refuse.

Snapshots return the complete shared `view`, combined historical/current `support`
restrictions and `validForMs` of at most 30000. This interval is not a reusable
credential; a future client must measure it from its monotonic request start.
Every import confirmation must perform a fresh authorized read. Read responses
do not copy evidence, merge knowledge, update pins or approve anything.

Default limits are 65536 input bytes, 21000000 complete output bytes, 30 seconds per
request, 16 concurrent requests, 2 concurrent requests per account, 120 requests
per minute globally and 60 per account (token buckets allow the initial burst).
Health checks also consume the global budget. Host-only `limits` can lower these
or set bounded higher values: request timeout 100–120000 ms, concurrency 1–32,
per-account concurrency 1–8, global rate 1–6000/minute, per-account rate 1–600/minute.
The server cancels work on disconnect, deadline or stop. Error responses contain
safe codes, not internal roots or raw exception messages. Oversized output fails
as a whole; no truncated page is returned.

## Configure a cloud client candidate

Use a separate private host file for the client. Requests select its alias and
page keys; they cannot provide endpoints, credentials, roots, grants or identities.
For example:

```json
{
  "version": 2,
  "sources": [{
    "transport": "cloud",
    "id": "team-wiki",
    "title": "Team Wiki",
    "origin": "https://memory.example.com:8443",
    "remoteSourceId": "published-team",
    "credentialEnv": "TEAM_WIKI_TOKEN",
    "commit": "<full configured source commit>",
    "vaultId": "<source vault ID>",
    "tenantId": "<source tenant ID>",
    "readers": [{ "id": "local-reader", "tenantId": "<local client tenant ID>" }],
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

Set the existing host `AMEM_SHARED_WIKI_CONFIG` to that absolute file path and
provide `TEAM_WIKI_TOKEN` privately in the host environment. Use the existing
`wiki shared-list` / `wiki shared-snapshot … --expected-commit …` commands and
`memory_shared_wiki_catalog` / `memory_shared_wiki_snapshot` agent tools, or the
local management page. Cloud snapshots require the full displayed commit;
omitting it refuses. The configured source identity refers to the original source
vault, not the service's broker vault. Catalogs list local configured aliases and
make no network request; successful catalog listing does not establish remote
availability. A snapshot performs a fresh remote read with the intersection of
local caller/binding limits sent as attenuation.

Optional host fields: `timeoutMs` (100–120000, default 30000) and absolute `caFile`
(regular CA certificate file, at most 1000000 bytes). Certificates and hostnames
remain verified. Only explicit `allowLoopbackHttp: true` permits development HTTP
origins on literal `127.0.0.1` or `::1`. Origins contain no trailing slash, path,
credentials, query or fragment. Redirects are refused without forwarding a token;
there is no retry or cached content fallback. Credentials and CA hashes stay out
of serialized views and import plans. Changing a selected credential, binding or
CA invalidates retained work. The short remote lease continues during later local
lock waits; approval still performs a new remote read.

Version 2 also supports existing local bindings by adding `"transport":"local"`.
Version 1 files retain their existing local behavior and optional pin precondition.
Older programs reject version 2: stop older processes before using it. No vault
record or schema is migrated. Service-side readers refuse cloud and Git bindings,
so an account cannot turn the service into a recursive forwarding proxy.

## Configure the Git cache candidate

Use the same version 2 host file and existing shared read adapters. A Git source
fixes a remote, short branch name and a full immutable pin independently:

```json
{
  "version": 2,
  "sources": [{
    "transport": "git",
    "id": "team-git",
    "title": "Team Git Wiki",
    "remote": "ssh://git@git.example.com/team/wiki.git",
    "branch": "published",
    "commit": "<full configured source commit>",
    "vaultId": "<source vault ID>",
    "tenantId": "<source tenant ID>",
    "readers": [{ "id": "local-reader", "tenantId": "<local client tenant ID>" }],
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

Normal remotes are credential-free HTTPS, SSH or `git@host:path`. Git uses the
operator's native credential/SSH configuration with interactive prompts disabled;
do not place credentials in the URL. Absolute local paths or `file:` URLs need an
explicit host-only `allowLocalFile: true` and an independently trusted local
repository. Request bodies cannot select commands, remote paths or branches.
Git repository access is separate from the configured local reader grant.

Catalog listing makes no remote request. Each snapshot requires `expectedCommit`,
fetches the configured branch and requires the pin to remain in its full history.
Current branch withdrawals, classification and expiry still apply to an old pin.
Unavailable remotes, a removed pin, unsafe trees or failed refreshes refuse; an
existing cache is never an offline fallback. Pin updates require a host file edit
and a new displayed-version selection. No Git push, merge or checkout is used.

The disposable cache is fixed under the caller vault's
`.amem/shared-cache/<id>/vault/`. Its owner file binds the caller, source IDs,
remote and branch. Reusing an alias for a different source refuses; after stopping
all readers, an operator may reset that disposable slot or use a new alias.
Keep private key material separately before a reset. Never use this cache as a
working checkout. Successful refreshes replace only validated managed files and
preserve private runtime, including `.amem/keys.json`. A following explicit read
rebuilds interrupted replacements after another fresh fetch.

For confidential pages, separately provision the source's wrapped record-key file
into that cache's `.amem/keys.json`, with private filesystem permissions, and add
`masterKeyEnv` naming the corresponding host environment variable. The Git remote
must never contain that key file or the master key. A missing/erased key prevents
new decryption, even if ciphertext was fetched earlier. Unrelated confidential
records are not decrypted for a permitted non-confidential selection. Git cannot
discover a remote key erasure that was never communicated to the cache operator;
use the self-hosted service when every read needs live source-side key checks.
Neither mode can recall plaintext already copied by a reader.

Limits: `timeoutMs` 100–120000 (default 30000) covers refresh and snapshot work;
`maxCacheBytes` 64000–1073741824 (default 536870912) bounds the cache with checks
before/after work and monitoring during fetch. Monitoring can overshoot between
checks; use host storage/process limits as well. Current trees are limited to
5000 files, 10 MB each and 100 MB total, with existing selected-graph limits also
applied. Symlinks, submodules, runtime paths, Git attributes and ambiguous portable
paths refuse. Objects are copied by verified bytes with hooks and transformations
disabled; source instructions are not executed. Confirmed library imports fetch
again and retain separate read/write/review and explicit confirmation checks.

## Boundaries and remaining work

Source grants, keys and withdrawal are checked on the server. An already delivered
consistent read can precede concurrent revocation; copied plaintext cannot be
recalled. Account files contain digests, not encryption keys. Encrypted source
access still needs the source's separately provisioned keys.

No real account, grant, service, certificate installation, deployment, push or npm
publication is performed by the development loop. Remaining delivery work is
tracked in [the roadmap](remaining-roadmap.md), including both selected transports,
adapters, installed-package/runtime checks and independent acceptance review.
