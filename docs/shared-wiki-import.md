# Explicit compiled Wiki imports (development candidate)

The library copy operation is implemented. Human-authored library integration is
implemented and under verification; CLI/MCP/Harness/Web import adapters are still pending. This is not
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
The signed `integrate` plan keeps its artifact ID, classification and private
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
Old programs reject the new plan kind. The library signal cancels owned work,
including actual destination waits. CLI/agent/Web preparation adapters and their
batch acceptance remain pending.

Bounds: 25 requested/50 dependent pages, complete artifact and plan each at most
1,000,000 UTF-8 bytes, destination's lower evidence limit, 100 inherited conditions/
uncertainties and existing field bounds. Content is returned completely or refused.
Long ordinary-memory support is allowed when it fits the whole-artifact limit.

Compatibility: imported evidence uses a distinct hash domain and `digestVersion: 4`.
Older software rejects the format rather than silently treating it as ordinary raw
evidence. Stop older readers/writers before enabling imports. Stripping the version,
URI or inherited format fails validation. Existing ordinary/PDF records keep their
format; no database, automatic data migration or vault configuration version change.
No real grant, push, publication, deployment or exported-skill installation occurred.
