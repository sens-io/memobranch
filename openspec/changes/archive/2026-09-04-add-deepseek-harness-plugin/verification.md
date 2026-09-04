# Verification: DeepSeek Harness plugin support

Date: 2026-09-04

## Automated gates

- `npm ci --ignore-scripts --no-audit --no-fund` completed from the committed lockfile.
- `npm run check` passed TypeScript compilation and all 63 tests.
- The four new adapter tests cover manifest metadata, lifecycle cleanup ownership, least-privilege visibility, absence of model-controlled identity fields, conservative concurrency metadata, real capture/propose/consolidate/context calls, stable attribution, argument bounds, cancellation, and fail-before-registration configuration errors.
- `npm audit --omit=dev` reported zero known production vulnerabilities.
- `npm pack --dry-run --json` included `cordis.patch.yml`, `dist/deepseek-harness.js`, and `dist/deepseek-harness.d.ts` in a 65-entry package.
- `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` passed the active change and all six canonical specifications.
- `git diff --check` passed.

## Official Harness smoke test

- Runtime: isolated Node.js 24.19.0.
- Harness: official `@deepseek-ai/dsh@0.1.2-rc.1` npm artifact.
- Artifact: locally packed `memobranch-1.0.0.tgz`.
- `dsh plugin --profile memo add <tarball>` initialized a disposable profile and installed MemoBranch successfully.
- `dsh --profile memo --dump-config` showed a `memobranch` bundle layer containing `name: memobranch/deepseek-harness`.
- A real profile boot remained active for five seconds without module-resolution, configuration, or plugin-load failure, then was stopped with SIGINT.

The host's default Node.js 22.6.0 was below engine requirements in the current Harness dependency tree. Repeating the smoke test with Node.js 24.19.0 passed; the README records that host-version boundary.

## Compatibility and safety review

- The adapter compiles against `@deepseek-ai/dsh-tools@0.1.2-rc.1`; its peer range also covers the published `0.0.1-rc.1` line used by the stable npm tag.
- The primary `memobranch` export remains independent of optional Cordis and dsh-tools peers; only the explicit `memobranch/deepseek-harness` subpath loads them.
- Identity, permissions, tenant binding, encryption keys, provider credentials, and remote credentials remain process-owned and absent from every tool parameter schema.
- Tool visibility is reduced before prompt assembly, and `MemoryVault` repeats authorization before canonical reads or mutations.
- No tool opts into concurrent dispatch because read paths may refresh derived state and all registrations share a vault instance.
- Abort signals cancel pending provider requests and the adapter waits for the vault call to settle before returning.
- Unknown errors are redacted and normalized to stable MemoBranch error envelopes.

## Residual limits

- No paid external model call was made; it is unnecessary for plugin loading or tool execution validation. LLM-independent tool execution was exercised against a real vault.
- DeepSeek Harness is pre-1.0. The adapter deliberately stays on documented stable surfaces and declares an upper peer bound below `0.2.0`; releases beyond that bound require compatibility verification.
