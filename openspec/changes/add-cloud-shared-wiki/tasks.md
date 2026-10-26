## Implementation
- [x] Add strict bounded service account file and server-owned read principals.
- [x] Add self-hosted read API with native TLS, complete responses, attenuation and live guards.
- [x] Add cloud client and version 2 host binding dispatch while preserving version 1.
- [x] Add owned Git cache refresh with current branch authority, fixed pin and safe materialization (library/Web checkpoint verified locally).
- [x] Extend import runtime guards to both transports without weakening separate approval (cloud/Git libraries verified; integration delivery remains below).
- [x] Add admin-only CLI credential/template/check/foreground setup and existing CLI/MCP/Harness/Web sharing adapters; account persistence and grants remain explicit operator actions.
- [x] Add bilingual setup, credential rotation/revocation, encryption and deployment limits.

## Verification
- [x] Real synthetic HTTP/HTTPS: authentication, attenuation before decryption, wrong identity and changed grants.
- [x] Stale pin, withdrawal, expiry and configuration/token changes during actual lock waits.
- [x] Strict request/response bytes, malformed UTF-8, duplicate fields/headers, safe errors and credential isolation.
- [x] Disconnect, request deadline, concurrency/rate bounds and complete server shutdown.
- [x] Actual bare remotes: refreshed current authority, access failure, forced history and cancelled fetch.
- [x] Safe bounded Git cache paths/modes, no hook/filter execution, no key loss or unrelated decryption.
- [x] Unchanged canonical read state and no model calls; fresh copy confirmation remains separate from Wiki approval. Human-authored cross-vault integration/import adapters belong to batch 4.
- [x] Existing and new adapters, actual browser cleanup from retained client/Git checkpoints, same 448-entry package Node 20/22, both Git defaults.
- [ ] Strict OpenSpec and production audit passed; implementation review 15/15 completed. Final acceptance-text review remains pending; see the [verification record](../../../docs/cloud-host-verification-2026-10-26.md).
