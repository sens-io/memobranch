# Design and delivery

## Context
Keep the existing search and canonical readers instead of introducing a second index or a model summarizer. Assemble complete authorized records. A named caller-provided counter can use a model tokenizer; the built-in UTF-8-byte counter is a conservative estimate, not measured model usage. Count the final joined string, including separators. Enforce both the character cap and token cap. Reserve a configurable fraction for resident knowledge, then use unused space for retrieved and remaining resident records. Only authorized input omissions may be reported.

## Imports
Use a deterministic preview manifest rather than another persistent task database. A CLI caller explicitly chooses a directory. Ignore hidden entries and common dependency/build directories; reject symbolic links and non-text files. Preview contains source identities, content hashes and sizes, never bodies. Apply revalidates the complete bounded manifest before any write. Existing immutable capture makes retries idempotent; a changed file requires a new preview. Each capture is an existing recoverable transaction. Progress reports only completed commits; cancellation may leave completed evidence but never a partially approved Wiki. Compiling and approving stay separate commands. Do not expose directory import through the Web/MCP server.

## Source versions
Derive source histories from authorized immutable evidence instead of changing stored evidence identities. Versions are grouped by exact source URI and ordered by recorded timestamp plus path. Timeline date bounds refer only to recorded time. Affected-page reporting includes only authorized pages and their actual evidence references. A new source version is an update requiring review, not automatic invalidation or automatic approval of every page sharing a URI. Legacy sources remain readable. Permission narrowing must not leak other classifications or counts.

## Alternatives
Persistent background jobs and full remote connectors would support unattended imports but require encrypted job payloads, transport security and durable ownership. Defer these rather than store secret source bodies in a plaintext runtime queue. Model-generated compression could pack more text but risks dropping conditions; omit complete records with an explanation instead.

## Verification and rollout
Use synthetic vaults, retained regressions, failure/permission/cancellation and file-drift tests. Check minimum supported Node using installed JavaScript. Review fixed committed candidates independently. No real documents, client settings, deployment, npm publishing or push is part of this implementation request. Roll back code without rewriting evidence; imported evidence remains auditable and generated knowledge still requires review.
