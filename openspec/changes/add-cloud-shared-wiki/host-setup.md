# Foreground service and host account setup

Add admin-only native CLI commands using the existing version 1 service account
file, with no new account store or public management endpoint:

- `cloud credentials`: generate a random inactive bearer value and its SHA-256
  digest. Output is for the operator only; no file or grant is written.
- `cloud account-template`: derive broker IDs from an existing vault, require an
  existing matching reader grant in a local-only source binding, and return one
  valid service-file template containing only the supplied token digest. Respect
  the operator's tenant/scope/sensitivity ceilings. The operator explicitly saves
  this private configuration; the command never edits account/source configuration
  or canonical knowledge. Catalog checks use the existing private read-lock runtime.
- `cloud check`: validate the bounded host file and its broker identities, then
  report configured readable source counts. Do not decrypt pages, infer page
  availability, expose digests/roots, or accept remote bindings in a broker. A
  changed account file or operator identity invalidates the complete result.
- `cloud serve`: start the separate read service in the foreground, defaulting
  to loopback. Reuse native TLS and all existing bounded limit options. Public
  listeners require TLS and an explicit HTTPS origin. Print only the service URL,
  never a credential. SIGINT/SIGTERM must stop owned requests/connections, including
  a signal during startup. No daemon installation or real deployment is implied.
  The CLI passes a validated snapshot of its operator principal to the service.
  Every authenticated request and final response must remain within that operator's
  tenant/scope/sensitivity ceilings, even if the account file later adds broader
  entries. Library hosts may omit this additional operator ceiling; CLI hosts
  always set it. Changing the fixed operator ceiling requires a restart.

All commands reject unknown/duplicate flags, bare value flags and extra positional
arguments. An unprivileged caller refuses before host configuration is read.
Credentials do not grant access until the operator explicitly installs their digest
in the account file and the source already grants the account ID. Rotation and
revocation remain explicit private-file updates, reloaded by the existing service.

Git CLI/MCP/Harness acceptance uses real bare repositories and real SDKs, preserving
old pins, private opt-in, source/caller state, current grants and per-call cancellation.
No test creates a real account, grant, hosted service or external model call.
