# Web effective-time management

Development-source feature, not in the published npm 1.1.0. Uses the existing authenticated console and [ordinary-memory effective-time contract](effective-time.md); no new credentials, model calls, database or configuration schema.

## Read and annotate

Open **记忆库**, then an ordinary memory. List rows and details separate stored lifecycle status from explicit time applicability: **已结束**, **尚未生效**, **时间未知**, or inside the annotated/known bounds. These labels describe the clock at the read/render, not factual certainty or live monitoring. Use **重新读取当前版本** / refresh the list for updated state. Source/candidate/Wiki pages do not acquire ordinary-memory effective intervals.

Current reviewers can edit **审核记忆有效期** for a non-revoked ordinary record. Both native date/time controls are **UTC**, regardless of browser timezone. Seconds and milliseconds are preserved. Dates the browser's native calendar cannot represent (such as year 0000) remain complete editable UTC text instead of being cleared. The inclusive start and exclusive end must form a nonempty interval. Blank means **unknown**, not creation time; clearing an existing endpoint removes its restriction. The interface never fills an unknown endpoint from recorded/validated time.

**核对并保存有效期** displays old/new bounds and the inspected version before explicit confirmation. Cancelling sends nothing. Save uses that exact version; concurrent changes are refused, not overwritten or automatically retried. While saving, the dialog pauses reads, edits and other mutations so a late response cannot overwrite a newer draft or hide a failed write. Closing remains available. Failed/ambiguous requests remove the old submit form and require **重新读取当前版本** before another attempt. Check Git history if a response is lost; closing a window cannot withdraw an already completed commit.

Successful saves report their revision/commit, reload current details and refresh the originating list/date query. A later read failure does not turn a confirmed save into a failed write. The next form always comes from a fresh authorized canonical read. Read-only users can inspect but cannot edit; server-side review authority remains mandatory even if browser controls are manipulated.

## Dated retained-record view

In **记忆库 → 按日期查看记忆**, select a UTC instant. The optional name matches the exact normalized ordinary-memory key, not full-text content. Completely undated records are excluded unless **明确包含完全未标日期的记录** is checked. A single known endpoint can match with the other marked unknown.

Results show the queried instant, latest retained revision/body, current status, evidence, conditions and uncertainty. Superseded or conflicted results have explicit warnings and do not become active assertions. Opening a result rereads its **current** detail, not an old revision. The query does not reconstruct Git history, past permissions or a historical Wiki answer; current evidence access, expiry, revocation and erasure still apply before counts and pagination.

Page navigation uses the server's capped page size and the **last submitted** filters. Editing a draft date/name does not change a next-page request; submit to start that new query from page one. **刷新已提交的日期查询** rereads that same submitted query. New reads supersede old reads; leaving the page or disconnecting aborts owned query requests and discards late results. There is no automatic clock-driven polling or browser selection of confidential dated results.

## Compatibility and limits

Stop older processes before using annotated data; older readers/writers do not enforce these fields. No automatic interval splitting, future switchover, conflict resolution, expiry deletion, historical Wiki reconstruction or generated-file scheduler is added. Generated `MEMORY.md` remains a last-write projection. The existing API/CLI/MCP/Harness time behavior and confidentiality rules are unchanged.
