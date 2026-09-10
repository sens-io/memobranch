# Close independently reproduced audit findings

## Why

Independent probes at a765ca7 found unauthorized diagnostic and embedding access, downgraded merged provenance, replay of rolled-back synchronization, remote compensation races and unrelated staging entering operation commits. CI additionally depended on the host's implicit Git branch. The first repair review found that failed snapshot restoration could lose its recovery information.

## What Changes

- Authorize diagnostic evidence and provider batches before using body content.
- Preserve classification, conditions, expiry and rendered provenance in duplicate merges.
- Isolate Git commits, serialize remote compensation and recover failed sync snapshots durably.
- Make CI fixtures branch-independent and verify an actually installed Harness package.
- Preserve existing assertions, add failure/near-boundary regressions and independently review committed candidates.

## Impact

Capabilities: memory-access-control, hybrid-memory-index, transactional-vault and remote-git-sync. No remote publication. The separately proposed Karpathy Wiki capability is a core design requirement, not claimed implemented by these fixes.
