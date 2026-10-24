# Pinned local / Git Wiki sharing (development source)

The library core is implemented and undergoing verification/review. CLI, MCP,
Harness and Web adapters are pending. This is not a published npm feature, cloud
account service, import, merge or offline revocation mechanism.

```ts
import { MemoryVault, SharedWikiReader } from 'memobranch';
const caller = new MemoryVault('/absolute/caller-vault', { principal });
const shared = new SharedWikiReader(caller, {
  configPath: '/absolute/caller-vault/.amem/shared-wiki.json',
});
const sources = await shared.catalog();
const view = await shared.snapshot({
  sourceId: 'team-wiki', pageKeys: ['concept:deployment'],
  // includeSensitive: true, includeSecret: true,
  signal: new AbortController().signal,
});
```

`principal` is trusted application identity, not a request field. The caller must
currently have read permission in its own vault. A host-owned absolute JSON file
explicitly selects sources and readers; never populate it from model/source text.
Keep it outside tracked knowledge, such as the existing ignored `.amem` directory.
No feature automatically creates this file or grants a real reader access.

```json
{
  "version": 1,
  "sources": [{
    "id": "team-wiki",
    "title": "Team knowledge",
    "root": "/absolute/source-vault",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "vaultId": "replace-with-source-vault-id",
    "tenantId": "replace-with-source-tenant-id",
    "readers": [{ "id": "workspace-agent", "tenantId": "replace-with-caller-tenant-id" }],
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

Use actual IDs from each vault's configuration and a full local ancestor commit.
The example hash/IDs are placeholders. Match both caller tenant and actor ID;
admin permission does not bypass a missing sharing grant. Source scope/clearance
is capped by both caller authority and the host binding. The source principal
keeps caller identity, binds to the source tenant and has read permission only.
Catalog exposes configured readable names/pins/ceilings, not paths, credentials,
other readers or a claim that every page is available.

For confidential sources, the host may add `"masterKeyEnv": "TEAM_WIKI_MASTER_KEY"`
and supply that environment variable securely. The file stores the variable's name,
never its value. Missing source key selection explicitly does **not** fall back to
`AMEM_MASTER_KEY` or the caller vault's key. Existing per-record key material must
also be available at the source; a master key alone cannot restore erased/missing
record keys. No source key, local Wiki proof key or private runtime state is exported.
`includeSensitive` / `includeSecret` opt in before decryption and cannot raise grants.

Snapshot reads enforce current caller/source identity, exact local ancestry, clean
managed content, readable sources/rules, keys, withdrawal and expiry. They never
fetch, check out a branch, modify refs/indexes, call a model or approve knowledge.
Missing objects, dirty content and pending transactions/erasures fail explicitly;
recovery remains a separate existing operation. Advancing source HEAD never silently
changes the configured pin, and an unreadable old page never falls back to another.

Caller and source locks are not held together. Final caller/grant/key-selection
revalidation and a last synchronous current/historical time check prevent extra
waiting from exposing now-expired data. An overlapping later source withdrawal
can follow the existing consistent read; subsequent reads must honor it. Editing
the trusted binding affects new/finally revalidated operations, not an already
copied plaintext result. A local clone cannot learn remote withdrawal without an
explicit authorized update; this feature does not fetch that update automatically.

Bounds: 100,000 UTF-8 config bytes, 20 sources, 100 distinct tenant/actor reader
tuples per source; 1–25 distinct requested keys; existing snapshot dependency,
stored-record and local-history restrictions; 20 MB complete shared JSON output.
Oversized, malformed, non-regular, replaced or symlink host files fail. Methods
accept a real optional `AbortSignal`, not serialized identity/path/commit/signal
overrides. Complete results are returned or refused, never silently truncated.

Database change: none. Data migration: none. Optional configuration: the explicit
host file and optional source-key variable above; no real configuration is applied
by development or tests. All executing fixtures use synthetic vaults.
