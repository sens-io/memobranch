# Explicit availability core — verification, 2026-10-24

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Initial core: `5f1f6141b3a02f1c01dfcf82b1c2b50411243e41`.
Runtime fix: `c2a00677616533d50f5bed25c9af68f3f0c44e06`.
Dependency security fix: `362fc3faf44b4d776f605301b3037f5ad55aabad`.
This checkpoint covers the library core, not the still-pending CLI/agent/Web adapters.
The core's retained, installed and independent review checks passed locally.
Adapter work and the overall roadmap remain open.

An explicit confirmed write records selected committed pages, exact source/rule
dependencies and a signed local observation time as immutable evidence. Queries
use those observations rather than Git dates, and retain current permissions,
confidential selection, source keys, withdrawal and expiry. Missing or ambiguous
observations remain unknown. The host clock and local proof key are trusted inputs;
this does not prove when an agent first learned, understood or believed a fact.

## Findings and corrections

| Source branch | Finding | Correction / independent recheck |
| --- | --- | --- |
| `kevin/knowledge-expansion` | P2: same-time `[A]` / `[A,B]` observations falsely conflicted for unchanged A | `c2a0067` binds and compares each key's own dependency documents, normalized by path; real filesystem regression and independent memory-port counterexample passed |
| `kevin/knowledge-expansion` | P2: a companion Wiki page's built-in rule hash incorrectly applied to a legacy-only view | `c2a0067` stores a rule hash per requested key; mixed legacy/Wiki and transitive/custom-rule independent checks passed |
| `kevin/knowledge-expansion` | Newly reported high-severity Zod constrained-collection advisory affected inherited 4.5.4 | `362fc3f` requires `^4.6.6`, locks 4.6.7, changes no other dependency version; two regression checks and production audit passed; see [security record](security-zod-2026-10-24.md) |
| `kevin/knowledge-expansion` | Low: English conflict wording still described an entire manifest | `c9c1024` states that the requested key's required documents/rules are compared; independent recheck passed |

The initial fixed-candidate review covered all 13 files, including documentation
excluded by OCR defaults. Runtime re-review covered both changed code/test files,
with no skipped file. Security plus design/document review covered eight files;
the wording recheck also passed. Reviewers used fixed commits and small independent
memory substitutes, not fresh full-suite or installed-package execution. Their
results do not replace the executing checks below. No confirmed core defect remains
from those reviews.

## Actual checks

| Check | Result / retained evidence |
| --- | --- |
| Build and test types | Passed on Node 22.17.0 |
| Related core/snapshot/date and collection checks | 51/51, failure/cancellation/skip 0; `.scratch/knowledge-availability-per-page-final-targeted.log` |
| Full Node 22 / Git main after runtime and dependency fixes | 804 functional + 14 release + 10 evaluation = 828 passed, failure/cancellation/skip 0; `.scratch/availability-fixed-full-main.log` |
| Full Node 22 / Git master after both fixes | Same 828 passed, failure/cancellation/skip 0; `.scratch/availability-fixed-full-master.log` |
| Strict cached OpenSpec 1.0.2 | 28 passed, 0 failed; `.scratch/availability-fixed-specs.log` |
| Production audit after combined checks | 0 known production vulnerabilities; `.scratch/availability-fixed-audit.json` |
| Same installed artifact on Node 22.17.0 / Git main and exact minimum Node 20.0.0 / Git master | Both passed, 381 packed entries; `.scratch/availability-fixed-package-node22.log`, `-node20.log`; before/after SHA-256 files compare equal |

Installed artifact: `.scratch/availability-fixed-package.k4nlw5/memobranch-1.1.0.tgz`.
SHA-256: `cddcae1f7dfcdd7e697b1e5c1b0642b2e7b1fd4afe39bf1c8680f4b172d7f314`.
It contains the fixed core and patched dependency declaration. Its bundled copy of
this work record predates these completed-check rows; runtime bytes are unchanged.
The minimum-Node run reports the existing npm 11 CLI's Node support warning, but
the script and all installed runtime/type consumers execute with exact Node 20.0.0
and finish successfully. This is local evidence, not hosted CI or publication.

The executing tests use real files, Git, transactions and encryption with synthetic
data and a deterministic compiler substitute. They actually change the page to
version 2 before reconstructing version 1; immutable source/observation bytes,
query HEAD and model-call count remain unchanged. They cover backdated Git commits,
forged markers/indices, lost proof keys, current revocation, conflicting timestamps,
mixed scopes/foreign tenants, opt-out before decrypt, erased selected source keys,
cleanup authority changes, source/config drift, explicit cancellation, expiry and
safe IDs after an already-completed save. The installed consumer's cancellation
checks cover pre-aborted signals; do not present them as mid-operation cancellation
or commit-race evidence.

Earlier authoring failures are retained in the numbered targeted logs. Corrections
fixed option forwarding, exact evidence-marker headings, the revoke key, an
idempotent test fixture that had not actually advanced the page, post-withdrawal
test-inspection authority and missing imports. No assertion, concurrency, content
budget or permission check was weakened. Both Git-default full runs on the initial
candidate passed 825 each, but its production audit failed on Zod; these older
results do not substitute for verification of the fixes.

Reads use a consistent snapshot while the read lock is held. An overlapping later
withdrawal cannot recall plaintext already read; new reads after withdrawal must
be refused. This boundary is documented, not a claim that asynchronous post-read
changes can be checked forever. Local proof material is never shared through Git.

Push/publication/deployment: none. Database change: none. Data migration: none.
Required/persisted configuration change: none. No real vault grants or external
model/service calls. Next: finish independent review of this checkpoint text, then
complete CLI/agent/Web adapters and the remaining roadmap.
