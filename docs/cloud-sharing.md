# Cloud sharing — development candidate

The user selected both a self-hosted service and Git remote sharing. The current
branch contains a **self-hosted read-service library candidate**. Cloud client
bindings, remote Git caches, CLI setup and management/agent adapter integration
are still pending. This is not a deployment or full cloud-sharing acceptance.
See the [design and acceptance gates](../openspec/changes/add-cloud-shared-wiki/design.md).

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

## Run the library candidate

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

## Boundaries and remaining work

Source grants, keys and withdrawal are checked on the server. An already delivered
consistent read can precede concurrent revocation; copied plaintext cannot be
recalled. Account files contain digests, not encryption keys. Encrypted source
access still needs the source's separately provisioned keys.

No real account, grant, service, certificate installation, deployment, push or npm
publication is performed by the development loop. Remaining delivery work is
tracked in [the roadmap](remaining-roadmap.md), including both selected transports,
adapters, installed-package/runtime checks and independent acceptance review.
