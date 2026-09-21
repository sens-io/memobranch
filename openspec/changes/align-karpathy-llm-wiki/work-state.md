# Implementation checkpoint

Status: **in progress, not release-approved**. Current files, Git and fresh tool output are authoritative; this checkpoint is not completion evidence.

## Candidate and implemented work

- Repository `/Users/imac/code/memobranch`, branch `codex/deepseek-harness-plugin`; runtime/test candidate `73d6b73c9221507fb83c7e40f4ef02eaa5c6c3c6`. The original task cwd was removed: always specify this repository explicitly.
- Six page purposes; immutable sources; operational rules; catalog-first incremental compile/query; signed, versioned, explicit plans/apply/filing; structural/semantic lint and separately authorized repair; classification/expiry/uncertainty propagation; legacy migration/navigation; encrypted persistence/erasure; durable multi-page transactions; CLI/MCP/official Harness and installed-package workflows are implemented.
- Local commits since the first runtime: `3daa871` provider; `084a6b4` Wiki core; `af8181b` adapters; `21fc23b` review fixes; `80c455d` legacy/authority; `91075e9` managed Markdown; `a71e3a7` crash/sync tests; `090859d` installed integrations/docs; `a8b30a2` total provider deadline; `4a2517a` query filing/manifest/import lifecycle; `dd55775` actual HTTP incremental E1→E2→E4; `3216198` guide; `881e9cf` future reference rejection; `73d6b73` Darwin Git group cleanup. No push/publication.

## Latest verification and review

- The isolated `090859d` review returned four runtime/manifest problems and one missing protocol scenario. They now have fixes and executable regressions, but final independent acceptance is not implied.
- The isolated `3216198` reviewer independently reproduced future dependency/rule versions being accepted; fixed in `881e9cf`. The reviewer then failed with a workspace-credit error and issued no final verdict.
- Pre-fix future-reference selection: four failures, one built-in control pass. Post-fix import/incremental/governance/recovery selection: strict build/test typing plus 44/44, no skips, 27,734.335875 ms.
- Full `3216198` macOS Node 22/main gate: 439 tests, 438 passed, one Git timeout cleanup failure. It is a failed gate, not a pass. A diagnostic observer captured Darwin `EPERM` for an exited/zombie-only process group. Fixed in `73d6b73` with bounded process inspection, keeping actual live-group permission refusal intact.
- Post-fix Git/transaction/sync/Harness cancellation selection: 33/33, no skips, 12,428.101959 ms. Git cancellation suite then passed 9/9 in each of five runs (14,058 / 12,281 / 12,129 / 12,173 / 11,878 ms). Darwin-only regressions are inapplicable on Linux and must be reported as platform skips there.
- Earlier development evidence: query/manifest+schema 125/125; provider/operation 113/113; Wiki integration 38/38. Those do not substitute for the final candidate matrix.
- Exact runtime `73d6b73` macOS Node 22.17.0/arm64 full gates completed for both `main` and `master`: each 446/446, no failures/skips; durations 103,894.037750 and 94,418.251416 ms. Each also passed production audit (0 vulnerabilities), strict OpenSpec (8/8), pack and independent installed API/CLI/MCP/Harness (84 entries). Both process exits were 0. This is not Linux or hosted-CI evidence.
- `verification.md` now indexes all 44 criteria to actual tests and records failures/history. It is not approval. `tasks.md` implementation checkboxes deliberately remain unchecked until complete evidence and independent review.

## Live operations and external dependencies (revalidate handles)

- Final macOS gate session `36899` is completed (exit 0); do not poll/restart it. Logs `/private/tmp/memobranch-wiki-gates-73d6b73-GRWmjw/macos22-main.log` and `macos22-master.log` contain full results.
- Older Linux Node 20.20.2/arm64/master gate: exec session `45532`; log `/private/tmp/memobranch-wiki-gates-3216198-TFHuRL/linux20-master.log`. It printed runtime identification but dependency installation did not finish. Docker status session `85470` also remained live without output. No success evidence.
- Docker became unresponsive after low disk space. Only the newly downloaded, unused Node 22 image was removed; no user volumes or project files were deleted. Space later recovered to approximately 19 GiB. Node 20 image may remain. An asynchronous question asks permission to restart Docker Desktop; no approval has arrived and no restart is authorized yet.
- Independent review requires restored workspace credits or a completed reviewer turn. No alternative model/provider has been used to bypass the credit failure.
- During a broad process diagnostic, a separate service's command-line credential was inadvertently returned. The user was informed without repeating the value; do not inspect broad process arguments or copy that output into repository artifacts.

## Remaining acceptance work

1. Preserve the completed exact-candidate macOS logs; rerun affected gates if runtime changes again.
2. Once Docker recovers with user direction, verify terminal state of the older run, then complete Linux Node 20/master and Node 22/main full gates for the final candidate. Use isolated read-only source copies and record actual OS/architecture/runtime; do not call local containers GitHub-hosted CI.
3. Obtain an isolated read-only review of the current commit, original core/spec, all 44 matrix rows and fresh raw evidence. Resolve confirmed findings, revalidate and make split local commits as needed. No missing gate may be approved by narration.
4. Update core design status, README/guide and implementation checklist only to the level actually established; commit the final evidence record.
5. Mark the active goal complete only after every mandatory requirement has adequate evidence and no confirmed issue remains. Finite tests do not prove absence of unknown bugs. Do not push or publish.

Node: `/Users/imac/.nvm/versions/node/v22.17.0/bin/node`. Source is outside current writable roots; use scoped approvals for writes and executing tests. Use `apply_patch` for edits; discover its current absolute path when the default cwd causes failures. CodeGraph is unavailable for this repository; do not initialize without consent. A prior initialization question remains unanswered.
