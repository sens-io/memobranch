# Zod constrained-collection security update — 2026-10-24

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
The production audit after `5f1f614` reported the inherited direct dependency
Zod 4.5.4 as affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The advisory identifies versions below 4.6.6 as affected; the
[maintainer's fix](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd)
checks upper collection-size bounds before validating individual elements.
Earlier zero-vulnerability reports were time-specific and are not this audit's result.

Raise the declared minimum to `^4.6.6`; the refreshed lock resolves Zod 4.6.7.
No other dependency version changed. Installation used the lock with scripts
disabled. No database, data migration, runtime configuration, real vault permission,
push, publication or deployment. This is a local dependency update, not evidence
that a deployed service has been upgraded.

| Check | Actual state |
| --- | --- |
| Build and test types | Passed on Node 22.17.0 |
| Oversized-collection regressions | 2/2; real experience/availability schemas reject 20,000 invalid members without per-member error accumulation; `.scratch/zod-security-targeted.log` |
| Production dependency audit | 0 known vulnerabilities; `.scratch/zod-security-audit.json` |
| Full retained after combined fixes | 828/828 under each Git default, failure/cancellation/skip 0; `.scratch/availability-fixed-full-main.log`, `-master.log` |
| Same installed artifact on Node 20.0.0/22.17.0 | Passed, 381 packed entries; before/after SHA-256 identical; see [combined core verification](knowledge-availability-verification-2026-10-24.md) |
| Independent fixed-commit review | 4/4 security files reviewed, skipped 0, no confirmed open security issue; static review, not a separate runtime execution |

Retain all old assertions and transport/content limits. This patch does not make
arbitrary unbounded schemas safe or establish model effectiveness. Overall roadmap
work continues; this security change is accepted locally, not deployed or published.
