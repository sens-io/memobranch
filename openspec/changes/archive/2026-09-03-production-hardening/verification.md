# Verification report: production-hardening

Date: 2026-09-03

## Summary

- Completeness: all 27 implementation tasks are complete.
- Correctness: all 25 normative requirement deltas have implementation and test evidence.
- Coherence: the implementation retains Markdown/Git authority and keeps runtime indexes, keys, journals, leases, audit, and metrics under `.amem/` as designed.
- Critical issues: none open.

## Requirement evidence

| Capability | Implementation | Verification evidence |
| --- | --- | --- |
| Transactional vault and migration | `src/transaction.ts`, `src/config.ts`, `src/vault.ts`, `src/utils.ts` | v1 backup/migration, future-version diagnostics/refusal, writing rollback, ready replay, recovery audit, live/stale lock, Git corruption, and missing-Git tests |
| Access control and confidential memory | `src/policy.ts`, `src/encryption.ts`, `src/vault.ts` | unauthorized-scope no-change test, server-owned MCP identity test, secret graph prefilter test, fail-closed key test, envelope tamper test, plaintext-artifact scan, and erasure/history-key test |
| Persistent hybrid retrieval | `src/search.ts`, `src/llm.ts` | corrupt-index health/rebuild metric, CJK query, unavailable-embedding lexical fallback/status, one-document incremental update/hash retention, and 1,000-document bounded performance test |
| Remote Git synchronization | `src/git-store.ts`, `src/vault.ts` | credential URL rejection/audit redaction, push, remote fast-forward, derived rebuild/search, divergence, conflict abort/state preservation, transport failure, and corruption sync-disable tests |
| Maintenance and telemetry | `src/audit.ts`, `src/maintenance.ts` | repeated no-change cycle, managed-directory watch with polling fallback, debounced external Wiki update, single live lease, loopback health/metrics, redacted bounded metrics, and awaited shutdown tests |
| CLI and MCP contracts | `src/cli.ts`, `src/mcp.ts`, `src/errors.ts` | JSON version/error test, bounded schemas/core limits, operational tool discovery, annotation checks, denied review followed by permitted call, Git author, and audit principal checks |

## Release gates

- `npm run check`: PASS, 21 tests passed.
- Representative index gate: PASS, 1,000 documents indexed and queried within the 15-second bound.
- `npm pack --dry-run`: PASS, package `agent-memory-wiki@1.0.0`, 55 files, approximately 55.6 kB packed.
- `npm audit --json`: PASS, 0 known vulnerabilities across production and development dependencies.
- `OPENSPEC_TELEMETRY=0 openspec validate --all --strict`: PASS, all 6 main specifications valid after sync and archive.
- `git diff --check`: PASS before archive.

## Design consistency

- Canonical evidence, candidates, Wiki memory, generated resident/index Markdown, and the concise memory log remain Git-managed.
- Confidential logical metadata and bodies are envelope-encrypted; persistent retrieval and generated Markdown contain only non-confidential records.
- Server-owned authorization is evaluated before confidential decryption, scoring, link expansion, snippet generation, or embedding submission.
- Transactions keep recoverable original/desired states; confidential plaintext migration states are themselves protected by the master key.
- Remote integration uses standard Git credentials, rebuilds derived state before validation/push, and aborts content conflicts.
- Maintenance never auto-approves knowledge and exposes only loopback operational endpoints.

## Accepted non-goals

No browser editor, hosted control plane, multi-tenant database, distributed writer consensus, automatic semantic conflict resolution, external KMS adapter, or deletion guarantee for third-party copies is included in this release.
