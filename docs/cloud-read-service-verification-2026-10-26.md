# Self-hosted Wiki read-service candidate — 2026-10-26

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Service candidate: `ccad1cbf50782d6d3f157a352692a241733aa599` (includes the earlier
service and response-delivery fix). Installed-check candidate:
`4aa6f7db468728f516f13df4feacef4ea3c38c93`.

## Scope and status

The user selected both self-hosted and Git remote sharing. This checkpoint covers
the **self-hosted read-service library** and its candidate verification only. It
does not accept the whole cloud-sharing batch. Cloud client bindings, owned Git
cache transport, CLI setup, existing tool/management adapters and native browser
acceptance remain pending. Existing local sharing remains available.

The service derives read-only principals from a bounded host account file and
existing local source bindings. It supports fixed-pin catalog/snapshot reads,
server-side scope/sensitivity attenuation before decryption, current access and
lifecycle checks, native TLS for public listeners, bounded complete envelopes,
request budgets, cancellation and shutdown. It has no account/grant editor or
knowledge mutation endpoint. No production account, grant, certificate, service,
deployment, push or npm publication was created.

## Verification

| Check | Observed result |
| --- | --- |
| Build and test type checking | Passed with the final service fixes. |
| Service plus retained local/import/Web tests | 52/52 passed, zero skipped/cancelled. `.scratch/cloud-shared-wiki-server-targeted-4.log`. |
| Minimum runtime, Node 20.0.0 | Final 17/17 service tests passed as compiled JavaScript with Git default `master`; no development TypeScript loader required. `.scratch/cloud-shared-wiki-server-node20-final.log`. |
| Final full checks, Git default `main` | 917 retained checks passed: 893 functional + 14 release-script + 10 evaluation checks, zero failed/skipped/cancelled. |
| Final full checks, Git default `master` | The same 917 retained checks passed: 893 functional + 14 release-script + 10 evaluation checks, zero failed/skipped/cancelled. |
| Strict OpenSpec and production dependency audit | 31/31 specification items passed; production audit reported zero vulnerabilities. |
| Same installed tarball, Node 22.17.0 / Node 20.0.0 | Both passed: 426 packed entries, Git defaults `main` / `master`, unchanged tarball SHA-256 before/after both final runs. |
| Independent code/design review | Fixed-candidate reviews covered every changed file. Confirmed design and service issues below were fixed and reviewed again. Final checkpoint text review pending. |

Full-check logs are `.scratch/cloud-shared-wiki-server-full-final-main.log` and
`.scratch/cloud-shared-wiki-server-full-final-master.log`; strict validation and
audit are `.scratch/cloud-shared-wiki-server-final-specs.log` and
`.scratch/cloud-shared-wiki-server-audit.json`. These checks ran on this local
macOS host; no claim is made about a remote GitHub CI run. Source and test files
did not change from the reviewed `ccad1cbf` candidate during the final runs.

Tests use actual synthetic vaults, HTTP/HTTPS sockets and source-lock waits. They
cover wrong credentials and host/origin, mandatory cloud pin, stale pin, broker
identity mismatch, current source withdrawal, key erasure and private opt-out
before decryption. A waiting request refuses after its account is removed;
rotating the digest changes which credential works. Disconnect/deadline/stop remove
the actual source waiter without holding the broker lock. Rate/concurrency,
malformed UTF-8, escaped duplicate JSON keys, duplicate authorization headers,
oversized complete responses and send failures are covered.

The slow-reader regression pauses a real 10 MB HTTP response: a second request is
refused while the first still sends, the deadline closes the incomplete response,
and the concurrency slot becomes usable again. Independent fixed-source tests
also observed `[200,429,429]` at concurrency one and no unhandled rejection after
an injected stream error. This is evidence for the tested boundaries, not a claim
of arbitrary load capacity or external network security testing.

The installed check imports the public library and types from the actual installed
package, uses real HTTP, verifies the old pin after the source advances and checks
account/source revocation. Its read-state comparison covers both vault HEADs,
refs and indexes, one named source raw-evidence file and one broker raw-evidence
file, plus the fixture model-call counter. It does not hash every evidence file or
test unpublished cloud clients/Git/adapters.

The same archive was retained at
`.scratch/cloud-service-package.bzQkhf/memobranch-1.1.0.tgz`, SHA-256
`6be1164689da9bd457ed4b21727c630712a9be8bd0975c8c37a57b8fb8f62c1c`.
It was packed from `ad9be6d6`; service runtime matches `ccad1cbf`. The corrected
`4aa6f7db` installed-check fixture is a separately copied test runner, not changed
package content. This checkpoint report was written after packing and is not in
that archive. Logs: `.scratch/cloud-shared-wiki-server-package-final-node22.log`
and `.scratch/cloud-shared-wiki-server-package-final-node20.log`.

## Findings and correction history

| Source branch | Candidate and finding | Resolution |
| --- | --- | --- |
| `kevin/knowledge-expansion` | `2b4bb5c8`: requiring a pin precondition for all modes conflicted with accepted optional v1 behavior. | `65aaf927`: mandatory for new cloud/Git transports; preserve v1 optional behavior. Independently closed. |
| `kevin/knowledge-expansion` | `2b4bb5c8`: new remote imports conflicted with the prior unconditional no-network import wording. | `65aaf927`: only new host-configured remote bindings may make bounded read requests/fetches; local v1 stays offline; push/arbitrary commands remain forbidden. Independently closed. |
| `kevin/knowledge-expansion` | `ab1cbac1`: `res.end()` released request concurrency/deadline before a slow response finished. | `926bb2b`: await finish/close/error and close unfinished sends at the deadline. Fixed-source independent reproduction and retained regression passed. |
| `kevin/knowledge-expansion` | `926bb2b`: the small-response wrapper discarded the new sending Promise, allowing unhandled rejection on a failed error response. | `ccad1cbf`: return the Promise; failed-send regression plus independent fixed-source reproduction passed. Both service issues independently closed. |
| `kevin/knowledge-expansion` | `ad9be6d6`: installed fixture did not answer an existing navigation request on its second ingest. | `4aa6f7db`: answer navigation from the actual catalog, retain all assertions; static re-review and both actual installed runs passed. |

The first service targeted run had one failing test because `fetch` did not send
the requested Host override. It was replaced by an actual native HTTP Host-header
request, retaining the assertion that no resource was opened. A direct TypeScript
test attempt on Node 20.0.0 failed at the development loader, before service code;
the compiled-JavaScript run then passed all 17 final tests. The first full `main`
run overlapped a code correction, so it is not used as final fixed-candidate proof.
Initial installed execution exposed the fixture issue above; it is not counted as
a passing package run. No production behavior or retained assertion was weakened.

Review coverage: design `2b4bb5c8` 5/5, wording correction `65aaf927` 2/2; service
`ab1cbac1` 2 core + 5 delivery files; `926bb2b` 2/2; `ccad1cbf` 2/2; installed
checks `ad9be6d6` 2/2 and fixture correction `4aa6f7db` 1/1, with zero skipped.
OCR supplied deterministic file/rule selection only, with its existing older-Git
warning retained; no external review model was called.

## Changes and next work

- Database changes: none. No database was added.
- Data migration: none. No existing vault record or schema was migrated.
- Configuration: optional new host-owned cloud account file and service options;
  real host configuration remains unchanged. Native TLS files are operator-provided.
- Push/publication/deployment: none; all commits are local.
- Next: cloud client and version 2 binding dispatch, Git remote cache, import
  guards/setup/adapters, then all remaining roadmap and final acceptance gates.

Instructions: [English](cloud-sharing.md), [中文](cloud-sharing_CN.md).
Remaining scope: [roadmap](remaining-roadmap.md).
