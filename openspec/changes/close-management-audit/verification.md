# Management audit: local acceptance

Date: 2026-09-29. Baseline: `e13bbc6`. Final runtime candidate: `759af31` on `codex/web-management`.

The confirmed findings in this audit are closed. This is bounded local acceptance, not proof that unknown defects or feature gaps cannot exist. No remote push, merge, deployment or npm publication was performed as part of this remediation.

## Scope and disposition

| Area | Confirmed gap and required outcome | Fix |
| --- | --- | --- |
| Maintenance ownership | Stop must cancel only its own cycle and retain its lease until in-flight cleanup finishes; stopping during asynchronous startup must not leave a late listener. | `24cf399`, `759af31` |
| Runtime cancellation | Signal composition must work on the declared Node 20.0.0 floor without `AbortSignal.any`, preserve cancellation reasons and dispose listeners. | `24cf399` |
| Wiki adapters | MCP and Harness must not reject questions over 8,000 characters when allowed by the configured core limit; the core limit remains authoritative. | `24cf399` |
| Wiki context budget | Mandatory existing source summaries count toward the requested page budget; overflow is refused before compilation or writes. | `83a1f98` |
| Wiki conflict repair | Explicit approved repair may resolve old conflicts, while ordinary compilation and unresolved supporting pages retain conflict state and provenance. | `83a1f98` |
| Settings privacy | Public nested settings expose only allowed fields; updating allowed values preserves private extensions without returning them. | `96332fd` |
| Web review transport | Bounded generated plans can be resubmitted for approval, including Unicode payloads; oversized plans are rejected before reporting success. | `96332fd` |
| Installed package | Ship linked documentation, design/specification records and the logo; verify compiled workflows on the exact minimum runtime. | `057a2d6` |
| Verification portability | Package resolution and recursive evidence traversal must work on Node 20.0.0 without dropping assertions. | `057a2d6`, `9ea7b23` |

Existing evidence, operation permissions, tenant/scope/sensitivity filters, explicit Wiki approval and transactional behavior remain retention and safety requirements. The full suite and installed API/CLI/MCP/Harness exercises supplement the targeted failure regressions; this audit does not redefine the core Wiki design or claim quality equivalence to a live model.

## Final executable evidence

Host: Darwin 24.5.0 arm64. Full source checks used Node 22.17.0; installed-artifact checks used Node 20.0.0. Temporary vaults and provider fixtures isolate tests from user knowledge stores.

| Check | Result |
| --- | --- |
| Build, type checks, maintenance lifecycle / production / audit regressions | 52/52 passed; no skipped or cancelled tests |
| Full `npm run check`, Node 22.17.0, implicit Git default `master`, runtime candidate `759af31` | Build and type checks passed; 470/470 functional tests and 14/14 release-script tests passed |
| Installed tarball, Node 20.0.0, implicit Git default `master`, runtime candidate `759af31` | Passed; 182 packed entries before this documentation-only closeout |
| Isolated final lifecycle review against a `git archive` snapshot of `759af31`, Node 22.17.0 | 6/6 original and independent diagnostic cases passed |
| OpenSpec 1.0.2 strict validation after documentation closeout | 11/11 items passed |
| Production dependency audit on 2026-09-29 | `npm audit --omit=dev`: 0 reported vulnerabilities |

The installed check covered authenticated Web console/assets, package exports, bundle patch, real Harness capture and permission visibility. API, CLI, MCP and Harness each exercised provider-backed Wiki plan/apply, persistent pages, query, explicit filing/repair and least-privilege refusal. Provider-backed here means a controlled HTTP provider fixture, not a commercial live model quality evaluation.

Reproduction commands (select the stated Node executable on `PATH`):

```sh
npm run build
npm run test:types
node --import tsx --test test/maintenance-lifecycle.test.ts test/production.test.ts test/audit-regressions.test.ts
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=master npm run check
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=master npm exec --yes --package=node@20.0.0 -- node scripts/verify-package.mjs
OPENSPEC_TELEMETRY=0 npx --yes @fission-ai/openspec@1.0.2 validate --all --strict
npm audit --omit=dev
```

Additional earlier retention evidence: the pre-final-lifecycle candidate passed 469 functional and 14 release tests on Node 26 with default `main`, and on Node 23 with default `master`. An executable initially assumed to be Node 22 actually reported Node 23.11.0; it is not counted as Node 22 evidence. The final Node 22.17.0 run above supersedes that assumption. The final lifecycle change was not followed by another full `main` run.

Local raw logs at verification time were `/private/tmp/memobranch-lifecycle-review2.log`, `/private/tmp/memobranch-node22-master-final.log` and `/private/tmp/memobranch-759af31-node20-package.log`. These temporary files are not durable release artifacts; the results, commands, revisions and limitations are recorded here instead.

## Independent review decisions

Reviewers received committed artifacts and acceptance criteria in isolated contexts. They could inspect and run tests, but did not modify the main repository, evidence collectors, permissions or acceptance gates. Review cycles were bounded to three rounds.

1. **Wiki review of `057a2d6`: accepted within scope.** Independent cases checked ordinary compilation preserving conflicts, partial repair retaining unresolved support, full repair preserving sources/labels/conditions/uncertainty, and mandatory-summary budget rejection before compilation. Configured adapter-limit regressions passed. The 100,000-character schema ceiling was inspected, not exhaustively exercised end to end.
2. **Package review: initially returned.** On `057a2d6`, the minimum-runtime verifier used recursive `readdir` unsupported by Node 20.0.0. `9ea7b23` uses explicit directory traversal while retaining the same evidence-tree assertion. The reviewer inspected the fix and successful installed-package evidence and reported no remaining actionable finding. Independent packing found linked documentation/assets present; all 14 release guard tests passed.
3. **Management review: initially returned.** A delayed localhost DNS lookup could complete after stop, leave a listener alive and lose its cleanup handle. `759af31` makes shutdown await startup settlement and closes resources under retained ownership. Final isolated review accepted the fix after 6/6 cases: delayed DNS success/failure, concurrent start refusal, repeated stop, stop during initial configuration/lease update, and cleanup ownership. Listener, timers, watchers and lease were checked for cleanup.

These are isolated agent reviews with additional executable evidence, not a claim of an external human audit or formal security certification.

## Failed or unavailable checks

- Node 20.0.0 source execution with `--import tsx` failed with `ERR_UNKNOWN_FILE_EXTENSION`; a `--loader tsx` experiment stalled and was terminated. Neither is counted as a passing test. Minimum-runtime acceptance instead uses the compiled installed tarball; source development checks use Node 22.
- Early minimum-runtime package checks exposed unsupported `import.meta.resolve` and recursive `readdir` in verification tooling. Both were repaired without removing the corresponding checks, and the installed workflow was rerun successfully.
- The independent reviewer initially encountered sandbox loopback binding restrictions. Approved local execution then completed; sandbox denial was not treated as a product defect or a pass.
- GitHub-hosted CI for these local commits, Linux/Windows execution, fresh final-pass browser visual/accessibility review, live-model semantic quality, production load/soak testing and a published npm installation were not verified here.
- Counts describe deterministic regression cases, not a statistical production reliability estimate. Future deployment still needs CI and environment-specific observation.

## Change control

Runtime fixes are separated into six local commits listed above. No user raw evidence was migrated or deleted. If a regression appears, stop release promotion and revert the affected commit with its dependents assessed; lifecycle cleanup depends on the earlier cancellation changes. Verification portability changes remain separately attributable. The closeout following `759af31` changes documentation and task status only.
