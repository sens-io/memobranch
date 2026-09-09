# Design boundary

The project core design is defined in docs/design/llm-wiki-core.md. It adopts the persistent compilation pattern without prescribing the reference project's desktop shell or storage engine.

Use the existing evidence and transaction layers rather than a second authority. Compilation produces a bounded proposed multi-page change set with evidence references and base revisions. Applying it must reauthorize and compare revisions under the writer lock. The exact public API and metadata migration must be designed and tested before implementation is declared complete.

Read-only queries and semantic lint never silently mutate canonical knowledge. Saving answers and applying lint fixes are explicit writes with provenance restrictions, not extra evidence of truth. Model responses and raw source instructions are untrusted data.

Acceptance requires real observable artifacts, authorized provider inputs, unchanged evidence hashes, repeatable recovery, and an independent review. Existing test success is not proof that this new capability already exists.
