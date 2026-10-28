# Explicit compiled Wiki imports (development candidate)

The library, CLI, MCP and Harness copy/integration operations are implemented.
The agent/CLI adapters and Web import controls are under verification. This is not
batch acceptance, an npm release, Git branch merge or a cloud sharing service.

Reuse the [host-owned pinned sharing configuration](pinned-shared-wiki.md). Do not
give requests source paths, keys, identities or grants. Configuring real access
is a separate operator action; development fixtures do not configure real vaults.

```ts
import { MemoryVault, SharedWikiReader, SharedWikiImporter } from 'memobranch';
const vault = new MemoryVault('/absolute/destination', { principal });
const options = { configPath: '/absolute/host/shared-wiki.json' };
const reader = new SharedWikiReader(vault, options);
const selected = (await reader.catalog()).sources.find(source => source.id === 'team-wiki');
if (!selected) throw new Error('No configured readable source');
const importer = new SharedWikiImporter(vault, options);
const { plan } = await importer.prepare({
  sourceId: selected.id, expectedCommit: selected.commit, pageKeys: ['concept:deployment'],
  // includeSensitive: true, includeSecret: true,
  signal: new AbortController().signal,
});
// Inspect the COMPLETE plan, source, bodies and destination classification first.
const captured = await importer.apply(plan, { confirm: true, signal: new AbortController().signal });
```

Preparation requires read/write; confirmed application separately requires
read/write/review. An exact successful retry rechecks current source access and
returns the existing artifact with `duplicate: true`, `commit: null`; unrelated
expiry does not turn it into a projection-refresh commit. Concurrent identical
confirmations retain one artifact. Preparation may initialize the existing local
proof key but changes no canonical content. Plan files contain confidential full
text and must stay private; signatures do not encrypt them or grant source access.

The copy preserves the fixed commit, page revisions/full bodies, original-source
IDs/hashes, rule references and a clear warning: this is compiled Wiki material;
original raw sources were not copied or independently verified, and offline
plaintext cannot be recalled. It does not copy PDF originals, source keys or absolute
source-root paths. Relative page/evidence paths remain part of provenance.
Support restrictions combine selected historical and current pages. Default
destination scope/sensitivity are conservative; optional stricter values cannot
broaden scope or lower sensitivity. An old internal page whose current support is
secret must be imported as secret, with explicit private selection and destination
encryption keys. Conditions, uncertainty, conflict and earliest expiration survive
Wiki compilation even when a model drops them. Expired evidence remains inspectable
as history, but cannot support currently readable Wiki knowledge.

Import alone captures evidence, without model calls, extraction or Wiki approval.
The existing separate `wikiIngest` → `wikiPreview` → `wikiApply` workflow can use
the artifact under the new restrictions. The human-authored library operation below
needs no model call. Ordinary-memory extraction, proposal, approval,
consolidation, validation and reads refuse imported-artifact support rather than
losing its restrictions. A separately configured local checkout can represent
another branch; this feature does not fetch, checkout or Git-merge it.

Approval reads the source again and checks its exact stable artifact and pin,
current grants/keys, destination config and proof. Changed host binding/key selection,
edited/foreign plans, current withdrawal/expiry, dirty sources and missing keys
refuse rather than using preview plaintext. Source and destination locks are not
held together; final destination waits cannot outlive source validity. Once a
transaction is ready, existing safe commit/recovery rules apply; inspect committed
operation details before retrying cancelled work. A post-capture authority/time
failure includes safe `completedImport` identifiers, never artifact plaintext.
Completed offline copies are not
automatically withdrawn by later source changes.

## Human-authored integration (library candidate)

After the separate import, prepare an authored target against its exact revision:

```ts
const integration = await vault.wikiIntegrationPrepare({
  evidenceId: captured.evidenceId,
  pageKey: 'concept:deployment', expectedRevision: 0, // Zero creates; use the current revision to update.
  title: 'Reviewed deployment guidance', summary: 'Human-authored integration.',
  body: 'The reviewed guidance, including any unresolved differences.',
  // sensitivity: 'secret', includeSecret: true,
  // status: 'conflicted', conditions: ['Only for this project'], uncertainty: ['Still needs validation'],
});
// Inspect the COMPLETE imported artifact, current target, proposed pages and dependents.
console.log(integration.comparison, integration.preview);
// Only a separate authorized review writes Wiki knowledge:
await vault.wikiApply(integration.plan);
```

Preparation requires read/write permission; ordinary separate Wiki application
requires review permission. It calls no model and writes no canonical content.
The signed `integrate` plan keeps its artifact ID, classification, time bounds and private
selection. It adds a grounded source summary when absent, retains existing local
evidence/links and keeps source/local conditions, uncertainty, conflict and expiry.
Authors may add restrictions or raise sensitivity; lowering input classification
or resolving an existing conflict through this operation is refused or preserved.
Confidential inputs and outputs require their explicit selection flags and keys.
The comparison includes the complete retained import and current target; no
semantic contradiction detection or independent verification is claimed.

Creation uses revision zero; updating requires the actual current revision and
cannot change a page's purpose. Changed, foreign or edited plans refuse. An exact
successful retry returns no pages/commit while checking the local artifact and
current permissions, keys, configuration and time. The original remote grant is
not needed after an explicit offline copy; it cannot recall retained plaintext.
Signed completion records bind the actual affected pages and their support. A
retained target origin hash alone does not establish an unchanged result. Exact
replay rolls back pre-action housekeeping before projection rebuilds; unrelated
later knowledge/expiry cannot turn it into a new commit. Old programs reject the
new plan kind and integration-tagged completion record; stop older processes
before enabling this operation. The library signal cancels owned work,
including actual destination waits. Adapter and whole-batch acceptance remain pending.

## CLI and Agent tools (development source)

The host supplies `AMEM_SHARED_WIKI_CONFIG` using the existing local/cloud/Git
sharing configuration. Requests never select that file, a source root, a network
endpoint, identity, grant or encryption key. Copy preparation and integration
preparation need read/write; copy confirmation needs read/write/review; ordinary
Wiki application needs review plus the plan's current read access.

```sh
# Use your already configured destination and host identity.
amem wiki shared-list --root "$DESTINATION"
amem wiki import-prepare team-wiki concept:deployment --root "$DESTINATION" \
  --expected-commit "$CATALOG_PIN" > "$PRIVATE_COPY_FILE"
# Inspect the COMPLETE copy proposal before confirming it.
amem wiki import-apply --root "$DESTINATION" --file "$PRIVATE_COPY_FILE" --confirm

# Write an integration JSON object with the returned evidenceId, pageKey,
# expectedRevision, title, summary and body; use the library example's fields.
amem wiki integration-prepare --root "$DESTINATION" --file "$PRIVATE_DRAFT_FILE" \
  > "$PRIVATE_INTEGRATION_FILE"
amem wiki preview --root "$DESTINATION" --file "$PRIVATE_INTEGRATION_FILE"
# Inspect all comparison/preview pages, then approve in a separate operation.
amem wiki apply --root "$DESTINATION" --file "$PRIVATE_INTEGRATION_FILE"
```

The variables above name operator-selected private files; keep them outside
versioned knowledge with owner-only access. Preparation does not save a proposal
file automatically. `import-prepare` requires the exact full catalog pin and
1–25 distinct keys, with optional tighter `--scope` / `--sensitivity` and private
selection flags. `integration-prepare` accepts the strict human-authored JSON
fields shown above and optional private selection flags; it never accepts an
apply option. An explicit flag overrides the corresponding file selection.
Copy confirmation and integration input require bounded local JSON files, not
stdin. Their saved representation is limited to 9 MiB (including formatting),
while canonical signed plans retain the stricter 1,000,000-byte bound. Existing
directory/experience import file limits remain 1 MB. Complete escaped reviews and
approval envelopes must also fit 9 MiB; oversized results are refused, never cut.
SIGINT/SIGTERM cancels owned source/destination waits under existing safe commit
rules; it does not kill another operation's lock owner.

MCP and DeepSeek Harness provide:

| Tool | Arguments and effect |
| --- | --- |
| `memory_shared_wiki_import_prepare` | `sourceId`, required `expectedCommit`, `pageKeys`, optional classification/private selection. Returns the complete signed copy `plan`; no capture. |
| `memory_shared_wiki_import_apply` | `{ plan, confirm: true }`. Rechecks the current remote/local source and retains evidence only. |
| `memory_wiki_integration_prepare` | The strict library input without a JSON `signal`. Returns the complete artifact/current-target comparison, preview and signed integration plan. |
| `memory_wiki_preview` / `memory_wiki_apply` | Existing separate Wiki review/application with `{ plan }`. Never submit a copy plan here. |

The copy tools are registered only when host sharing is configured and the current
principal has the required preparation/confirmation permissions. Harness also
hides integration preparation without read/write; MCP rechecks authority on the
registered tool. Integration of an already retained artifact works without remote
sharing configuration. Transport/lifecycle cancellation belongs to the host; JSON
`signal`, roots, principals and extra apply/authority fields are refused.

## Management UI (development source)

Open “知识导入” after connecting to the local management UI. Shared browsing stays
read-only. First preview the configured source/pin and complete copy material;
check the review box and explicitly confirm to retain evidence only. Then enter
that evidence ID (or a previously retained import), target key and exact revision,
and author the integration. Inspect the complete source/current/proposed contents,
check the second review box and separately approve Wiki changes. No automatic
integration, model call or approval follows copying.

Source/form/classification changes clear stale approval; stopping, navigating or
logging out cancels owned work and clears late results. Drafts/plans are not saved
automatically. Uncertain saves require inspecting records/history first; any retry
is explicit and uses the unchanged signed plan. Web keeps its existing 16 MiB
complete review/request allowance in addition to the core's lower canonical plan
limit. [HTTP/DOM and actual-browser verification](shared-wiki-web-verification-2026-10-28.md)
is recorded; final minimum-runtime/package and whole-batch acceptance are still pending.

Bounds: 25 requested/50 dependent source pages; a complete import artifact, copy
plan or signed manual integration plan is at most 1,000,000 UTF-8 bytes. Integration
has at most 40 affected pages, a 100,000-character authored body and 100 conditions/
uncertainties of at most 4000 characters each, still subject to the complete byte
limit. The destination's lower evidence limit and existing protocol bounds also
apply. Content is returned completely or refused.
Long ordinary-memory support is allowed when it fits the whole-artifact limit.

Compatibility: imported evidence uses a distinct hash domain and `digestVersion: 4`.
Older software rejects the format rather than silently treating it as ordinary raw
evidence. Stop older readers/writers before enabling imports. Stripping the version,
URI or inherited format fails validation. Existing ordinary/PDF records keep their
format; no database, automatic data migration or vault configuration version change.
No real grant, push, publication, deployment or exported-skill installation occurred.
