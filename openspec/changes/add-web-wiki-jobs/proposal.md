# Web management for durable Wiki compilation jobs

## Why
Durable local jobs currently require the CLI. Expose their existing authority, encryption and explicit approval workflow in the authenticated local console.

## What changes
- Authenticated enqueue/list/inspect/cancel/retry/remove and validated review/apply routes.
- Explicit single-attempt execution owned by the Web server, not by a long-held browser request. Shutdown cancels and awaits owned work; no scheduler or automatic retry.
- A responsive task page showing persisted state, stages, attempts and safe errors. Leaving the page stops polling, not compilation.
- Review returns the exact signed plan with its comparison. Approval must name that plan's proof, so a retried job cannot silently substitute another plan.

## Not included
Distributed workers, scheduling, source fetching, automatic approval, automatic startup, new credentials/configuration or PDF.
