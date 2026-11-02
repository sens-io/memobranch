# Explicit shared Wiki import and reviewed integration

## Why
Pinned shared reads do not copy knowledge into the caller vault. Operators need
to deliberately retain selected compiled source material, inspect its origin and
classification, and integrate it without making another Wiki's prose independent
raw evidence or silently replacing local knowledge.

## What Changes
- Add a host-configured importer using the accepted shared reader. Preparation is
  read-only and signs an exact bounded artifact; confirmed application captures
  one immutable derived-source artifact through the existing transaction.
- Keep source identity, fixed commit, page versions/full bodies, source hashes,
  rule references and compiled-source limitations. Preserve all classification,
  conditions, uncertainty, conflict and effective-time restrictions in downstream
  Wiki compilation, manual integration, preview, approval and reads.
- Add human-authored integration preparation against an imported artifact and a
  current expected local revision (zero means create). Return a normal signed Wiki
  plan and full comparison; ordinary separate preview/review approval applies.
- Support CLI, MCP, Harness and Web with strict request schemas and distinct
  preparation, import confirmation and knowledge approval. No auto-apply flag.
- An explicitly configured separate local checkout can represent another branch.
  Never fetch, check out, Git-merge, resolve branch conflicts or change grants.

## Impact
No cloud accounts, real grants, network/model calls in import or manual integration,
publication or deployment. Existing capture envelopes and Wiki plans/transactions
are reused. Ordinary raw evidence and historical/current manual merge keep their
existing behavior. New reserved import-artifact source URI/body is validated as
derived material; no vault schema/data migration is run.
