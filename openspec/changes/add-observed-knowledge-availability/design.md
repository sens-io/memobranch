# Design

An explicit write operation observes 1–25 selected keys at current clean HEAD.
The existing read-only snapshot mechanism checks current permissions, lifecycle,
source integrity, decryption keys and complete local ancestry. A bounded manifest
binds exact page/source/rule documents, vault/tenant/config identity, local host
observation time and commit. A separate domain-tagged local signature prevents a
caller-pasted marker from becoming trusted availability evidence. Store it as
ordinary immutable evidence, without duplicating source bodies or adding a database.

Observation is not automatic promotion or a read side effect. Incompatible private
scopes cannot be mixed, and the record cannot have lower sensitivity than its
dependencies. Source/config/HEAD and current authority checks repeat before save,
including synchronous final checks after asynchronous revalidation. A completed
save remains identifiable if access changes during commit settlement.

An as-known-at request considers only readable, explicitly selected confidential
observations. Each requested key uses its latest verifiable observation not later
than the requested time; conflicting documents at the same recorded instant are
unknown, not resolved by filename order. Exact committed content is reconstructed
through current snapshot/source/key/lifecycle checks and matched against the signed
manifest. Do not fall back to an older version after current access is withdrawn.

Each requested page records its own complete dependency membership and built-in
rule fingerprint. Shared document bodies are not duplicated; bounded indices point
into the manifest. Conflict checks normalize only that page's required documents,
not unrelated requested pages or their order. A mixed legacy/Wiki observation must
not attach another page's built-in rules to a legacy-only reconstruction.

Missing legacy evidence, a lost local proof key or forged markers must not be
reinterpreted as when the system first knew a fact. Local clock correctness is not
externally guaranteed. This is partial observation coverage, not a complete model
thought history or a claim of physical first availability. Existing Git-date views
remain a distinct API. Query never records availability or calls a model.

Adapters keep identity and vault roots host-owned. CLI/API and agent management
must make observing a write explicit and distinguish observed, unknown and denied
results. Current access applies to historical reads; copied plaintext is not
revocable. No key recovery, automatic grant or cloud service is introduced.
