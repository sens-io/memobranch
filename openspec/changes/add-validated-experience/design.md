# Design

Traces and validation reports are strict, versioned JSON in ordinary immutable
evidence. A proposal is an expiring local signed artifact, not a new canonical
record type. It contains exact source hashes, current vault/config identity,
scope/sensitivity, procedure, applicability and limitations. Mixed nonpublic
scopes are refused; sensitivity can only increase from the source maximum.

The library accepts a trusted callback supplied by application code, never a
module path or executable supplied by an agent. The callback sees the exact
proposal and each bounded test case with a cancellation signal. It returns
observed output and a boolean for each declared criterion. Two distinct successful
source tasks, at least two held-out transfer tasks, a retained-behavior case and a
safety case are required. This enforces coverage and binding, not semantic truth:
the host chooses cases and evaluates actual behavior. Results cannot be supplied
as a prefilled passing JSON report.

Validation runs outside the vault write lock with an overall deadline and abort
propagation. Results are copied and bounded. Failures/timeouts prevent export;
errors must not expose callback exception text. Persisted reports bind the exact
proposal and suite using the existing local proof key. All source/config/access
checks repeat under the evidence mutation lock, including immediately before
commit. After asynchronous revalidation, a separate synchronous final callback
rechecks operation/read permissions and proposal time with no intervening await
before the ready transition. Existing Wiki final callbacks remain synchronous.
No nested read-to-write lock upgrade.

Final synchronous checks include the principal's current tenant, not only its
operation permission, scope and sensitivity. A completed ready transaction is not
rolled back because authority or proposal time changes during commit settlement.
The post-capture check refuses plaintext and attaches only `completedValidation`
(evidence ID and commit) to the normal error, so callers can distinguish a saved
validation from one never committed. Prepare/export repeat tenant checks after
actual asynchronous read cleanup.

Export requires review permission, explicit confirmation, complete passing checks,
current source readability, unchanged config and explicit confidential selection.
It returns `SKILL.md` and `references/validation.md`; it writes nothing and never
installs or executes. The skill includes applicability, limitations and authority
boundaries. Copies may contain confidential plaintext and cannot be revoked.
Source key erasure prevents a new export but cannot recall an existing copy.

Schemas reject unknown fields, malformed dates, ambiguous IDs and oversized data.
Old ordinary procedure approvals do not qualify for this export path. No database
or vault schema migration and no new required configuration.

## Agent adapters

MCP and Harness expose only `memory_experience_capture`,
`memory_experience_prepare` and `memory_experience_export`. Capture accepts a
structured `trace` plus optional classification; prepare accepts a `proposal`
using the core schema; export accepts a stored `validationId`, explicit
`confirm:true` and optional confidential selection. The server owns the vault,
identity and evaluator. No runner, executable, module, filesystem path, tenant,
permission override, automatic validation, approval or installation input exists.
The host may validate through the library separately.

Strict shared schemas reject unknown fields before use. Capture requires write;
prepare read/write; export read/review. Harness registration follows these
combined grants; MCP retains its existing visible-tool/runtime-denial convention.
Harness capture defaults come from its existing server configuration. Existing
invocation/shutdown cancellation and safe error behavior apply. Complete returned
JSON is bounded below the default MCP stdio allowance and is never truncated.

## Local management

The experience page separates immutable observations, proposal preparation,
trusted-host validation and separately confirmed plaintext export. A host may
pass an `experienceRunner` function to `startWebServer`; this is application code,
never a request/config executable path. The default server has no evaluator and
does not pretend to validate. HTTP callers provide cases, not passing results.
Existing core coverage, current-source, deadline and cancellation rules apply.

The page's evidence listing searches experience markers, not proof of authenticity
or a passing status. Sensitive/secret records require explicit selection before
decryption. The core validates signed records when preparing/exporting. No new
persistent entity, vault migration or required configuration is introduced.
The page owns cancellation and discards stale results on edits/navigation/logout.
Files are downloaded only after separate confirmation and explicit download clicks;
editing the proposal or confidential selection invalidates prior export controls.
Uncertain saves are not retried automatically. Safe completed-validation identifiers
may be reported without returning report or source plaintext.
