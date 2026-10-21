# Design

Reuse the existing local Host/Origin/token/JSON/request-budget checks and MemoryVault authority checks. Use strict request schemas; never accept caller identity, credentials or an execution ceiling. Job metadata and bodies stay in the existing encrypted store. List/show responses never expose source bodies or plans.

The Web handle can own one explicit attempt. Reserve its slot before asynchronous validation, reject concurrent starts, and run under a new operation signal. An accepted execution request is not proof that a claim or compilation succeeded: persisted job status is authoritative. Browser disconnection does not cancel an accepted attempt. Server stop cancels its own attempts, then awaits cleanup, without cancelling an independent CLI worker or erasing queued jobs. Reloading or reopening the page never starts work automatically.

Obtain plan and before/after comparison in the same existing job lock. Apply requires the displayed proof; compare it with the current retained plan under that lock before selecting a canonical mutation. Preserve the original scope/sensitivity ceiling and revalidate current review authority and canonical inputs. Cancellation cannot revoke a separately authorized apply already selected for execution.

The page keeps the existing dark cobalt/violet/teal theme. Present queued/compiling/validating/ready stages without invented percentages. Poll one list request at a time, at bounded intervals, only while visible and connected. Clear timers and prevent late session/page results from rendering. Keep approval comparisons stable during status polling. Use text nodes for untrusted values and accessible labels/status messages.

Verify real HTTP lifecycle, authority and strict schema rejection; real owned cancellation/shutdown and repeated starts; retained-plan substitution refusal; DOM event tests for polling, hidden/read-only controls and late responses; browser checks at desktop/mobile widths. Retain main/master full checks, exact Node20.0.0 and Node22 installed consumers, strict specifications, production audit and isolated committed-candidate review. No push/publication/deployment.
