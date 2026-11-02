# Durable local Wiki compilation jobs

## Why
Explicit imports now preserve source evidence, but compiling many documents still holds a caller open and loses its proposal on process exit. Add an explicit local queue that persists progress and encrypted proposals without approving knowledge or fetching new sources.

## What changes
- Local library/CLI enqueue, inspect, run/work, cancel, retry, retrieve plan and remove commands.
- Bounded encrypted runtime state, current and enqueue-time authority checks, owned worker cancellation, dead-worker detection and explicit retry.
- Existing compiler, signed-plan preview and separate review/apply remain authoritative.
- Erasure invalidates cached proposals and in-flight jobs before destroying canonical keys.

## Not included
Web/MCP/Harness queue endpoints, unattended service installation, remote/distributed workers, source fetching, automatic approval, PDF, scheduling, cross-machine leases or exactly-once provider billing.
