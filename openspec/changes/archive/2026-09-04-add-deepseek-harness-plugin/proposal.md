# Change: Add DeepSeek Harness plugin support

## Why

MemoBranch exposes CLI and MCP integrations, but DeepSeek Harness users cannot install it as a native Cordis bundle or invoke its memory capabilities through the Harness tool registry. A native adapter is required so Harness can manage lifecycle, configuration, tool discovery, cancellation, and least-privilege exposure without launching a separate MCP process.

## What changes

- Publish a `memobranch/deepseek-harness` Cordis plugin entry point.
- Register MemoBranch tools with the official `defineTool` API and canonical JSON outputs.
- Validate deployment defaults with Schemastery and keep identity and authorization server-owned.
- Expose only tools allowed by the configured principal, while preserving vault-level authorization checks.
- Ship a `dsh.bundle` manifest and `cordis.patch.yml` for `dsh plugin add` installation.
- Add lifecycle, permission, validation, cancellation, package, and end-to-end vault tests.
- Document local checkout, npm/tarball installation, configuration, permissions, and security behavior.

## Impact

Affected areas are package metadata, a new DeepSeek Harness adapter, integration tests, README documentation, and the production Agent API specification. Existing CLI and MCP behavior remains unchanged. DeepSeek Harness dependencies are peer dependencies for the optional adapter; Schemastery is the only added runtime dependency.
