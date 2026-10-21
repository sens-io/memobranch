# Explicit fact-effective time for retained ordinary memories

## Why
Recorded timestamps describe when MemoBranch saved a record, not when its statement applies. Source timelines must not be presented as fact history.

## What changes
- A reviewer can explicitly annotate an existing ordinary memory with a start-inclusive/end-exclusive effective interval, using its current revision.
- A read-only dated view reports currently authorized retained records, their actual revisions, current lifecycle and uncertainty. Missing intervals are unknown, excluded unless explicitly requested.
- Current search, recall, resident context and Wiki legacy dependencies exclude records outside their interval. No automatic inference, scheduling, approval or resurrection.
- Library and CLI provide annotation and dated reads; MCP/Harness and authenticated HTTP expose dated reads, and confirmed HTTP annotation uses existing review authority.

## Not included
Historical Git checkout, as-known-at reconstruction, historical Wiki answering, temporal model extraction, automatic interval splitting, new databases, migration, browser controls, push or publication.
