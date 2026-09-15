# Design boundary

The project core design is defined in docs/design/llm-wiki-core.md. It adopts the persistent compilation pattern without prescribing the reference project's desktop shell or storage engine.

Use the existing evidence and transaction layers rather than a second authority. Compilation produces a bounded proposed multi-page change set with evidence references and base revisions. Applying it must reauthorize and compare revisions under the writer lock. The exact public API and metadata migration must be designed and tested before implementation is declared complete.

Read-only queries and semantic lint never silently mutate canonical knowledge. Saving answers and applying lint fixes are explicit writes with provenance restrictions, not extra evidence of truth. Model responses and raw source instructions are untrusted data.

Acceptance requires real observable artifacts, authorized provider inputs, unchanged evidence hashes, repeatable recovery, and an independent review. Existing test success is not proof that this new capability already exists.

## Implemented interface and storage decisions

The public API is `wikiCatalog`, `wikiRules`, `wikiSetRules`, `wikiMigrate`, `wikiIngest`, `wikiApply`, `wikiQuery`, `wikiFile`, `wikiLint`, and `wikiRevoke`. CLI/MCP/Harness use the same vault implementation and operation-specific read authority; explicit combined ingest/file apply requires both write and review. Existing administrative erase also supports encrypted Wiki pages.

Six typed page purposes live in `wiki/pages/` under stable opaque IDs. Versioned purpose/rules and compilation receipts live under `wiki/.meta/`; their metadata is validated independently from legacy memory documents. The migration is additive and does not repurpose raw evidence. Confidential documents use existing authenticated envelopes and retain encryption after policy relaxation.

Plans contain bounded targets, full proposed bodies, source IDs, authorized context keys, rule IDs and canonical input digests. Required dependent-page updates are part of the returned plan, not hidden writes at apply time. The vault's existing writer lock and recovery journal atomically apply pages, public catalog and append-only event log. Global `WIKI.md` only displays public/public knowledge with valid dependencies; authenticated catalogs include the caller's eligible records.

Query answers, plans and completed-compilation receipts carry a vault-local HMAC proof. Its 32-byte key is operational state outside Git. This binds model-only uncertainty and actual cited revisions across JSON round trips; it does not grant authority. Apply still revalidates current canonical state under the writer lock. Missing or foreign proof keys require regeneration; approved canonical pages remain Git-portable. Saved answer pages include generation metadata and keep model output distinct from independent evidence.

All source/rule/catalog text stays in the untrusted user payload of the model request. Catalog metadata contributes to output restrictions. Embedded local body links must be represented by allowed evidence or explicit page relationships. Context overflow fails explicitly. Structural lint remains available separately from unavailable or failed semantic analysis.

Implementation acceptance remains governed by the full matrix, not by this description of code structure.
