# Client setup and opt-in automatic memory

MemoBranch provides a preview-first Claude Code project configuration and automatic memory for DeepSeek Harness. Claude Code receives MCP tools; Harness can additionally retrieve approved memory before each model request and queue completed conversations for review. Automatic behavior is disabled by default.

## Claude Code project setup

Initialize the vault separately with `amem init /absolute/path/to/vault`. Build or install MemoBranch before setup so its packaged MCP entry exists. The preview reads the vault configuration and reports whether model credentials exist in the current environment; it does not contact a model, modify a client, or initialize an absent vault.

```sh
amem setup preview --client claude-code --config /project/.mcp.json --root /vault
amem setup apply --client claude-code --config /project/.mcp.json --root /vault --expected-revision REVISION_FROM_PREVIEW
amem setup verify --client claude-code --config /project/.mcp.json --root /vault
```

The preview shows exactly one proposed `mcpServers.memobranch` entry and the current file's SHA-256 revision, or `missing` for a new file. Apply requires that reviewed revision, repeats the vault/entry checks, and refuses a conflicting existing server. Other JSON settings and servers retain their values. Existing files receive a private backup before replacement; config, backup and ownership records use mode `0600`. Formatting may change because JSON is rendered again. Both input and rendered output are limited to 1 MiB of UTF-8 bytes; apply and remove refuse oversized output before replacing the original file. The lock and revision checks serialize MemoBranch operations and detect observed external edits; editors that ignore the lock can still race the final filesystem rename.

The generated stdio entry uses the current Node executable and absolute packaged MCP path. Its server identity belongs to the selected vault's tenant. Permissions default to `read`, scopes are `user,project,public`, and clearance is `internal`. Public scope is included so default public Wiki maintenance rules remain readable. Add `--permissions read,write` to both preview/apply commands only when evidence and candidate creation are wanted. Setup cannot grant review, maintenance, sync, or administration permission. No API key, master key, password, or model credentials are copied into the configuration; necessary secrets remain in the launching environment.

Verify launches only the exact generated local server, completes MCP initialization, and invokes the read-only `memory_version` tool. It confirms the configured identity can read the chosen vault. It bounds output and runtime and does not test a model request. Before returning, verification terminates its child process and waits for it to close, escalating from `SIGTERM` to `SIGKILL` after 500 ms; if closure still is not reported after two seconds, it reports a cleanup failure. A provider can be unconfigured while local recall and explicit manual proposals remain usable; model-powered extraction, Wiki compilation, and answers require the separately configured provider.

Claude Code's official project scope uses `.mcp.json`; the client may request project trust and server approval. Check `/mcp` or `claude mcp get memobranch` after installation. This integration exposes tools including `memory_recall`, `memory_explain`, and Wiki review tools. It does not install Claude Code lifecycle hooks, change its approval settings, or promise automatic conversation capture. See the [official MCP/project configuration documentation](https://code.claude.com/docs/en/mcp#project-scope).

To remove an owned installation, review the current configuration again and use its current revision:

```sh
amem setup preview --client claude-code --config /project/.mcp.json --root /vault
amem setup remove --client claude-code --config /project/.mcp.json --root /vault --expected-revision CURRENT_REVISION
```

Use the same `--permissions read,write` when previewing a write-enabled installation. Remove checks the ownership sidecar, target vault, current revision, and exact installed entry. It refuses a modified entry and does not adopt/delete a matching server installed by someone else. Other settings added since installation survive removal. The original backup remains available for manual restoration; removal does not overwrite the complete file with an older backup. It leaves an empty `mcpServers` object when that was the only server. A crash between client replacement and ownership recording can leave an unowned entry; inspect the backup and entry manually instead of assuming uninstall owns it.

## DeepSeek Harness automatic memory

Load the existing `memobranch/deepseek-harness` plugin as usual. Set automatic behavior in the plugin's configuration only after choosing which conversation content may be saved:

```yaml
- insert:
    - id: memobranch-memory
      name: memobranch/deepseek-harness
      config:
        vaultRoot: /absolute/path/to/vault
        automaticMemory: recall-and-capture
        defaultScope: project
        defaultSensitivity: internal
        defaultSearchLimit: 8
        defaultMaxContextCharacters: 12000
        automaticMaxInputCharacters: 2000
        automaticMaxCaptureCharacters: 20000
```

Keep the existing server-owned identity environment: `AMEM_TENANT_ID` must match the vault, `AMEM_PERMISSIONS` grants only the required operations, and `AMEM_ALLOWED_SCOPES`/`AMEM_MAX_SENSITIVITY` constrain access. The example does not grant permissions. A read-only principal can recall but cannot capture, even with `recall-and-capture` selected. Source restrictions remain enforced by the vault. Include `public` in the allowed scopes when pages depend on public Wiki rules. Existing explicit tools and their authorization/cancellation behavior continue to work.

| Mode | Before a model request | After a successful completed turn |
| --- | --- | --- |
| `off` (default) | No automatic vault retrieval or prompt contribution | No automatic evidence/candidate creation |
| `recall` | Authorized approved memory and active Wiki records | No automatic capture |
| `recall-and-capture` | Same authorized recall | Immutable text evidence and one pending episode candidate; never approval |

The adapter uses the real `system-prompt/assemble` waterfall. It reads the latest genuine user text from the current turn, queries `MemoryVault.recall`, and adds a named dynamic context contribution. Returned records include complete paths/revisions, source evidence, applicability conditions and uncertainty. A fixed introduction marks the records as untrusted source data rather than instructions or authority. Prompt-template braces in source content are kept literal using a variable substitution, supported by the pinned SDK. No model or embedding request is made for automatic recall. Revoked, expired, conflicted, unauthorized or incomplete records cannot become approved facts through this path.

The query is limited to 2,000 characters by default (configurable 100–2,000); recall output defaults to 12,000 (500–50,000), including its fixed introduction. The vault's configured limits still apply. Complete records are included or omitted rather than slicing away their conditions or citations. This bounded lexical search can return no relevant records and is not a measurement of model answer quality. A non-cancellation failure contributes only a fixed unavailable notice, with no private error details.

Capture observes post-commit `session/event` notifications for `turn/end` with `reason.kind=completed`. It snapshots only the matching bounded turn, includes genuine user text and assistant text, and excludes synthetic plugin contexts, tool arguments/results, images and private reasoning. It does not use the next turn's signal or retain an assembly signal to control a later turn. Aborted, failed, blocked, interrupted, incomplete and oversized turns are skipped. At most 2,048 recent events are inspected; a turn whose start is outside that range is skipped. The complete text must fit both `automaticMaxCaptureCharacters` (default 20,000; 500–100,000) and the vault's evidence limit. This avoids claiming a truncated fragment is the complete captured text.

The automatic candidate is an episode containing that text, marked `explicit=false`, confidence `0.5`, and requiring verification. This first version does not infer durable facts with a model or compile/approve Wiki pages. User and assistant statements remain conversation evidence, not established truth. Explicit extraction and review can follow. The evidence URI hashes the session identifier and includes the turn number. Stable evidence/proposal identities prevent duplicate records and commits on callback retries or process/plugin restarts. Capture and proposal are separate vault transactions: cancellation or failure after evidence commits can leave evidence without a candidate; retry safely resumes proposal creation. Non-cancellation capture failures log only the fixed operation code.

The plugin owns pending work. Host cancellation affects only its associated recall. Session disposal aborts that session's work; plugin unload cancels and drains pending reads/writes and removes listeners. `session/flush` waits for outstanding automatic capture for that session. Privacy `off` disables only automatic activity; explicit tools remain available with their existing permissions. Previously captured evidence is retained and must be managed through the normal vault lifecycle.

## Verified SDK boundary

This implementation is typechecked and integration-tested against `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-agent`, and `@deepseek-ai/dsh-session` version `0.1.2-rc.1`, plus the existing Cordis/tool packages. They are optional peers for consumers and installed development dependencies for tests. Tests exercise the real SystemPrompt assembly and SessionStore append notification services without a paid model call; they do not launch the complete Harness UI or conversation-model loop.

The public [Harness plugin lifecycle documentation](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) and upstream master sources were also checked: [system prompt](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/src/index.ts), [session events](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/src/types.ts), and [agent assembly context](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/src/runtime-types.ts). Master already has additional fields such as `interpolate=false`; this adapter does not pretend they exist in the installed prerelease or depend on them. Install a supported Harness host containing these lifecycle services; a generic MCP client alone does not provide them.
