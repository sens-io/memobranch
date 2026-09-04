# Verification: Close final production gaps

Date: 2026-09-04  
Branch: `codex/fix-production-audit`

## Reviewed commits

- `c11cf75` — specifies the final production hardening change.
- `a60596c` — binds retrieval, schemas, evidence migration, and storage to canonical policy.
- `011fac9` — serializes leases, audit, metrics, and observability failure handling.
- `95961b0` — closes adjacent encryption, embedding, path, reference, startup, and post-push windows.

## Boundary set

The dedicated independent-audit regression file passed 36/36 scenarios. It covers:

1. tenant, permission, scope, and sensitivity authorization before content use;
2. evidence-derived scope and sensitivity monotonicity;
3. live-lock ownership, stale-lock contention, and concurrent initialization;
4. recoverable and truthful cryptographic erasure;
5. canonical authorization changes and post-commit index-refresh failure;
6. effective encryption policy for storage, projections, journals, migration, and erasure;
7. exclusion of every encrypted-at-rest document from embedding requests;
8. pre-ranking removal of revoked encrypted records;
9. complete schemas, cross-document references, and unique managed identities;
10. reference-preserving legacy evidence-digest migration;
11. owner-protected daemon leases and partial-startup cleanup;
12. lossless concurrent audit and metric updates plus telemetry-failure isolation;
13. immutable evidence, plaintext-confidential rejection, and opaque Git metadata;
14. managed symbolic-link rejection;
15. conflict/procedure safety and credential redaction;
16. rollback before push and local/remote convergence after an accepted push.

## Retention and release gates

| Gate | Evidence | Result |
| --- | --- | :---: |
| TypeScript | `npx tsc -p tsconfig.json --noEmit` | PASS |
| Boundary regressions | `node --import tsx --test test/audit-regressions.test.ts` | 36/36 PASS |
| Complete suite | `npm test` | 59/59 PASS |
| Production build | `npm run build` | PASS |
| Representative corpus | 1,000-document persistent-index test in complete suite | PASS (984.8 ms) |
| Package contents | `npm pack --dry-run --json` | PASS (61 files, 70,428 bytes) |
| Production dependencies | bounded `npm audit --omit=dev --json` against the official registry | PASS (0 total vulnerabilities) |
| OpenSpec change | `OPENSPEC_TELEMETRY=0 openspec validate close-final-production-gaps --strict` | PASS |
| Patch hygiene | `git diff --check` | PASS |

No existing test was weakened or removed. The complete suite includes CLI, MCP, provider bounds, local/remote Git, recovery, authorization, encryption, CJK retrieval, performance, maintenance, and lifecycle coverage.

## Read-only final review

The final pass reviewed authorization before reads, every `requireEncryptionFor` decision, plaintext derivative paths, mutation/recovery ordering, lock ownership, managed filesystem traversal, Git rollback boundaries, and schema/reference acceptance. Each discovered adjacent failure received a reproducing regression before this record was written. No unresolved release-blocking finding remains in the reviewed scope.

## Residual limitations

- One vault represents one tenant and one local writer domain; distributed consensus and a hosted multi-tenant control plane are out of scope.
- The host, local administrator, process memory, operating-system key delivery, Git/LLM supply chain, backups, and already exported plaintext remain trusted or external boundaries.
- Canonical source-identity validation scans managed Wiki paths before trusting a warm index. The 1,000-document gate passes, but very large deployments should benchmark their own filesystem and canary upgrades.
- Cryptographic erasure removes this vault's original wrapped key; it cannot delete third-party copies or backups.
- Production rollout should retain a backup, deploy to a canary vault, monitor `/healthz` and audit/metrics, and keep the previous package available for rollback.
