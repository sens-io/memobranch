# Production Agent API Delta

## ADDED Requirements

### Requirement: Tool metadata matches possible side effects
MCP read-only, idempotent, and destructive annotations MUST conservatively describe every execution path, including index refresh, extraction, recovery, and expiry.

### Requirement: Provider requests are bounded
LLM and embedding operations MUST enforce total timeouts, bounded response sizes, finite retries, and validated output collection sizes.
