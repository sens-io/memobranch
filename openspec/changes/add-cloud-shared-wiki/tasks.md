## Implementation
- [x] Add strict bounded service account file and server-owned read principals.
- [x] Add self-hosted read API with native TLS, complete responses, attenuation and live guards (library candidate; clients/setup and whole-batch acceptance remain below).
- [x] Add cloud client and version 2 host binding dispatch while preserving version 1.
- [ ] Add owned Git cache refresh with current branch authority, fixed pin and safe materialization.
- [ ] Extend import runtime guards to both transports without weakening separate approval (cloud verified; Git pending).
- [ ] Add CLI service/account setup and existing CLI/MCP/Harness/Web sharing adapters (cloud read adapters verified; setup/Git pending).
- [ ] Add bilingual setup, credential rotation/revocation, encryption and deployment limits.

## Verification
- [ ] Real synthetic HTTP/HTTPS: authentication, attenuation before decryption, wrong identity and changed grants.
- [ ] Stale pin, withdrawal, expiry and configuration/token changes during actual lock waits.
- [ ] Strict request/response bytes, malformed UTF-8, duplicate fields/headers, safe errors and credential isolation.
- [ ] Disconnect, request deadline, concurrency/rate bounds and complete server shutdown.
- [ ] Actual bare remotes: refreshed current authority, access failure, forced history and cancelled fetch.
- [ ] Safe bounded Git cache paths/modes, no hook/filter execution, no key loss or unrelated decryption.
- [ ] Unchanged source/destination canonical data, explicit copy/merge approvals and no model calls.
- [ ] Existing and new adapters, actual browser cleanup, same package Node 20/22, both Git defaults.
- [ ] Strict OpenSpec, production audit and independent fixed-candidate review; record incomplete work honestly.
