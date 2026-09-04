# Design: DeepSeek Harness plugin support

## Architecture

The package becomes a DeepSeek Harness bundle without changing its primary library entry point. `cordis.patch.yml` inserts `memobranch/deepseek-harness`; the subpath exports a standard Cordis function plugin with `inject = ['tools']`. The plugin creates one `MemoryVault` instance and registers native Harness tools through `ctx.tools.register(defineTool(...))`.

## Configuration

The plugin exports both a TypeScript `Config` interface and a Schemastery `Config` value. `vaultRoot` defaults to `AMEM_VAULT`, then the process working directory. Search and capture defaults are configurable and strictly bounded. Invalid direct invocations fail during `apply`, in addition to loader-time schema validation.

Identity, permissions, scopes, sensitivity clearance, tenant binding, encryption keys, provider credentials, and remote credentials remain process-owned environment configuration. They are never accepted as model-generated tool arguments.

## Least privilege

The adapter computes the visible tool set from `principalFromEnv()`:

- `read`: context, search, get, version, configuration, policy, and history.
- `write`: capture and propose.
- `review`: consolidate, approve/reject, and forget.
- `admin`: cryptographic erase.
- `maintain`: doctor, recover, reindex, and maintenance.
- `sync`: remote status and synchronization.

`admin` makes every category visible, matching vault authorization semantics. Every call still passes through `MemoryVault`, so visibility is defense in depth rather than an authorization substitute.

## Tool contracts

All inputs use the official `defineTool` parameter DSL. Bounds that the published DSL cannot express are checked before vault execution. Structured operations return a lossless canonical JSON value with a JSON output schema; `memory_context` returns a string. Rendering is a pure projection of that canonical value.

No tool opts into concurrent execution because nominal reads can refresh shared derived state and all calls share one vault instance. The adapter observes cancellation before work, forwards aborts to pending LLM/provider requests, and waits for owned work to settle before returning. Errors are normalized through MemoBranch stable error codes and redaction before being thrown to the Harness pipeline.

## Packaging

The package declares optional Harness peer dependencies so ordinary CLI/MCP users do not need Harness. The bundle patch is included in the npm files list, and the exported subpath points at built JavaScript and declarations. Installation through npm or a prebuilt tarball requires no build permission; Git checkout installation continues to require building MemoBranch first.

## Compatibility

The adapter is compiled against the current npm release candidate and accepts the compatible `dsh-tools` line used by the current source documentation. It uses only the documented Cordis plugin, Schemastery config, and `defineTool` surfaces. The peer dependency ranges make the host responsible for providing one compatible runtime copy.
