# Cloud access to fixed-version shared Wiki

On 2026-10-24 the user added cloud sharing and subsequently selected **both a
self-hosted service and Git remote sharing** (answer: `1+2`). Preserve the accepted
local reader. Add transports for its fixed-version, read-only sharing contract;
copying and integrating knowledge remain separate, explicitly approved operations.

The self-hosted service authenticates host-managed accounts and checks current
read grants on the server. The Git transport updates a dedicated, host-managed
cache from one configured branch before checking current restrictions. Neither
transport automatically advances the selected full commit or falls back to stale
cached content when authorization, refresh or transport fails.

Use existing vaults, source bindings and classification rules. Do not introduce a
hosted SaaS dependency, automatic signup, collaborative writes, token-bearing URLs,
model calls, grant-editing agent tools, or a production deployment in this change.
Only synthetic accounts, services, repositories and keys are used for verification.
