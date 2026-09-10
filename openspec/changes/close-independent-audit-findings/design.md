# Design

Diagnostics read evidence using the invocation's permission. Semantic batches authorize tenant, scope, sensitivity and operation before dispatch, including implicit search refreshes. The lexical cache stays complete; encrypted content stays out of provider batches.

Duplicate statements may carry different restrictions: retain the strongest sensitivity, all applicability conditions and the earliest expiry, then regenerate the body and encrypt before writing new provenance.

Git commits isolate the journal's paths from unrelated staging. Remote configuration compensation executes under the writer lock, with committed and unknown outcomes distinguished from a known failed commit.

A synchronization snapshot needs durable recovery state beyond the reconciliation transaction. Failed restoration must never be swallowed or lose the rollback intent. Recovery restores the sync snapshot before ordinary journal replay, with original-tenant authorization and no blind rollback of an accepted or uncertain push.

Verification combines original failures, neighboring conditions, unchanged retention tests, default main/master branches, minimum-runtime Linux checks, actual package installation and isolated read-only review. Missing evidence is not approval.
