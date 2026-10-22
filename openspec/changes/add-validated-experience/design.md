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

Export requires review permission, explicit confirmation, complete passing checks,
current source readability, unchanged config and explicit confidential selection.
It returns `SKILL.md` and `references/validation.md`; it writes nothing and never
installs or executes. The skill includes applicability, limitations and authority
boundaries. Copies may contain confidential plaintext and cannot be revoked.
Source key erasure prevents a new export but cannot recall an existing copy.

Schemas reject unknown fields, malformed dates, ambiguous IDs and oversized data.
Old ordinary procedure approvals do not qualify for this export path. No database
or vault schema migration and no new required configuration.
