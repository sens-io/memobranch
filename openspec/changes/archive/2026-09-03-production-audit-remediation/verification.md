# Verification report: production-audit-remediation

Date: 2026-09-03

## Verified release identity

- Package: `memobranch@1.0.0`
- Repository: `https://github.com/sens-io/memobranch.git`
- Branch: `codex/fix-production-audit`
- Verification target: `a4f25af5062641004de5b2eb9648468423bf2b1e`
- Remediation range: `49a3649..a4f25af`
- Runtime: Node.js `v22.6.0`, npm `10.8.2`
- Specification tool: OpenSpec `1.0.2`

The verification target contains every runtime, regression-test, CI, configuration, README, and specification change covered by this report. This report and the completed task checklist are documentation-only follow-up evidence.

## Outcome

- All audit findings in the approved remediation proposal are implemented.
- All 21 remediation tasks are complete.
- No critical, high, medium, or low implementation finding from the audit remains open.
- The memory-governance safety set passes: evidence is immutable and verified, derived knowledge cannot broaden scope or lower sensitivity, tenant boundaries are enforced, and conflicted knowledge is excluded from ordinary retrieval.
- Retention behavior passes: normal capture, CJK lexical retrieval, encrypted memory, Git history, MCP/CLI contracts, and ordinary synchronization continue to work.

## Requirement evidence

| Area | Implementation | Regression evidence |
| --- | --- | --- |
| Authorization and provenance | `src/policy.ts`, `src/llm.ts`, `src/vault.ts` | Tenant-bound reads, principal-specific context, model downgrade resistance, and safe global projection tests |
| Locks and erasure | `src/utils.ts`, `src/transaction.ts`, `src/vault.ts` | Long-lived lock ownership, concurrent initialization, failed key-store update, and durable erasure recovery tests |
| Canonical integrity and retrieval | `src/search.ts`, `src/git-store.ts`, `src/vault.ts` | Tampered index metadata, modified evidence, conflict exclusion/restoration, procedure threshold, hot-query, and unchanged-index tests |
| Remote consistency | `src/git-store.ts`, `src/vault.ts` | Credential-channel rejection, remote configuration compensation, invalid fast-forward rollback, and push-failure rollback tests |
| Provider and operations | `src/llm.ts`, `src/maintenance.ts`, `src/mcp.ts` | Provider success, retry, timeout, cancellation, oversize response, unhealthy health endpoint, and MCP annotation tests |
| Release automation | `.github/workflows/ci.yml` | Build, full tests, production dependency audit, OpenSpec strict validation, and package dry-run gates |

## Executed release gates

| Gate | Result |
| --- | --- |
| `npm run check` | PASS — TypeScript build and 38/38 tests |
| Node test coverage | PASS — 90.28% lines, 79.67% branches, 88.47% functions |
| `npm audit --omit=dev` | PASS — 0 known production dependency vulnerabilities |
| `npm pack --dry-run` | PASS — `memobranch@1.0.0`, 55 files, 63.5 kB packed, 256.7 kB unpacked |
| `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` | PASS — 7/7 specification items |
| `git diff --check` | PASS |

## Threat-model decisions

- Canonical Markdown and evidence remain authoritative; indexes and generated files are treated as derived, untrusted state.
- Candidate extraction preserves source scope and sensitivity, while formal promotion remains evidence- and review-gated.
- Confidential bodies remain envelope-encrypted and cryptographic erasure is complete only after durable wrapped-key deletion.
- Remote Git synchronization is failure-atomic for local revision, managed files, sync state, and remote configuration.
- Provider requests have explicit timeout, retry, response-size, output-count, and cancellation bounds.

## Accepted non-goals

This release does not provide a hosted control plane, browser editor, distributed multi-writer consensus, automatic semantic conflict resolution, an external KMS adapter, content deletion guarantees for third-party Git copies, or a network-facing authentication layer for the loopback maintenance endpoint.
