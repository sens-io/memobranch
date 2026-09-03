# Verification report: independent-audit-remediation

Date: 2026-09-03

## Verified release identity

- Package: `memobranch@1.0.0`
- Repository: `https://github.com/sens-io/memobranch.git`
- Branch: `codex/fix-production-audit`
- Verification target: `cabe8ff103974e06b5682c2f0170d46ac6853ac7`
- Remediation range: `5d1314a..cabe8ff`
- Runtime: Node.js `v22.6.0`, npm `10.8.2`
- Specification tool: OpenSpec `1.0.2`

The target contains every implementation, regression, configuration, README, and specification change covered by this report. This report, final checklist update, and archive operation are documentation-only follow-up evidence.

## Outcome

- All seven independently reproduced findings are fixed and covered by boundary regressions.
- The stale-lock multi-process reproduction completes with zero overlapping critical sections.
- Plaintext confidential remote state and remote evidence rewrites fail closed and restore the pre-sync local revision.
- Evidence authorization metadata is hash-bound and invalid evidence is excluded from direct reads, derivation, and retrieval.
- Long-lived processes observe revocation completed by another process before their next search.
- Confidential logical keys are absent from Git paths, tracked plaintext, and commit subjects; non-admin history subjects are redacted.
- Non-admin access without the configured tenant identity is denied, while the explicit local-admin compatibility path remains functional.
- Erasure records a normalized reason digest without retaining reason plaintext; legacy intents report the missing commitment truthfully.

## Boundary and retention evidence

| Boundary | Expected result | Verified result |
| --- | --- | --- |
| Twelve processes observe one stale writer lock | No concurrent critical-section entry | PASS — zero overlap marker files |
| Remote adds a plaintext `secret` Wiki page | Reject and restore local HEAD/files | PASS |
| Evidence sensitivity changes `internal → public` | Integrity unhealthy; no public retrieval | PASS |
| Second process revokes a warmed search result | First process returns zero stale hits | PASS |
| Secret logical key is proposed and promoted | No key in Git path/content/subject | PASS |
| Non-admin principal omits `tenantId` | Deny reads and initialization | PASS |
| Erasure receives a plaintext reason | Store SHA-256 only; legacy remains truthful | PASS |
| Existing CLI, MCP, Git, encryption, provider, and maintenance behavior | Remains operational | PASS — complete retention suite |

## Executed release gates

| Gate | Result |
| --- | --- |
| `npm run check` | PASS — TypeScript build and 46/46 tests |
| Node test coverage | PASS — 90.74% lines, 80.75% branches, 88.76% functions |
| `npm audit --omit=dev` | PASS — 0 known production dependency vulnerabilities |
| `npm pack --dry-run` | PASS — `memobranch@1.0.0`, 58 files, 65.7 kB packed, 267.4 kB unpacked |
| `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` | PASS — 7/7 specification items |
| `git diff --check` | PASS |

## Compatibility and operating notes

- Non-admin CLI and MCP deployments must set `AMEM_TENANT_ID` to the vault's configured `tenantId`; the default local administrator remains unbound for local operation.
- Newly promoted confidential records use opaque ID filenames. Existing non-confidential paths remain unchanged.
- Evidence created with the earlier digest scheme is deliberately not silently trusted because its sensitivity was not identity-bound; it must be recaptured or explicitly migrated under operator control.
- Cryptographic erasure removes this vault's wrapped data key, but cannot erase exported plaintext, backups, or third-party Git copies.
