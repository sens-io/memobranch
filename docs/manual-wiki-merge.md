# Human-reviewed historical/current Wiki merges

Development-source capability, not in published npm 1.1.0. This combines an existing compiled page with its history in the **same vault**. It does not merge Git branches, import another private vault, grant team access, ask a model to choose the truth or resolve conflicts automatically.

## Prepare, inspect, approve separately

Read the current page and the vault's full commit history. Author a private local JSON file, for example `.scratch/merge.json`:

```json
{
  "fromCommit": "FULL_LOCAL_ANCESTOR_COMMIT_HASH",
  "pageKey": "entity:atlas",
  "expectedRevision": 2,
  "summary": "Human-authored comparison and combination.",
  "body": "A carefully reviewed combination, with conditions and uncertainty preserved."
}
```

```sh
memobranch wiki merge-prepare --file .scratch/merge.json --root ./vault > .scratch/proposal.json
memobranch wiki preview --file .scratch/proposal.json --root ./vault
# Inspect the complete before/after text, metadata and every affected page first.
memobranch wiki apply --file .scratch/proposal.json --root ./vault
```

Preparation requires read **and** write permission. Approval is a separate review operation; there is no auto-apply flag. A reader can inspect a valid proposal but cannot approve it. The local library exposes `vault.wikiMergePrepare(options)` with `WikiMergeOptions`; it returns `{ plan, preview, comparison }`. `plan.merge` is the signed `WikiMergeOrigin`. Use ordinary `wikiPreview` / `wikiApply` for review/approval. The [Web console](web-manual-merge.md) now provides historical/current comparison, editing and separate approval under the same validation. No MCP/Harness preparation endpoint is added.

The `comparison` contains the authorized historical graph, complete current target and a historical/current text diff. `preview` shows all declared current/proposed pages. Diffs have bounded display lines and may be explicitly marked truncated; complete before/after bodies remain available. The authored `body` is Markdown, not an entire serialized Wiki record; do not paste the reserved generated-links marker. Links are validated and generated through the normal Wiki renderer.

Both input and proposals may contain confidential full text, titles and source relationships. Keep them in a private, ignored directory with restrictive local file permissions; do not commit or share them. Signing prevents undetected edits, **not** plaintext disclosure. A copied proposal or view cannot be recalled. The JSON is not a new access token or independent source of evidence.

## What survives a merge

- Both versions' immutable sources remain referenced; old summaries are not captured as a fresh evidence record. Source files and PDF original bytes are not rewritten or included in the proposal as raw attachments.
- Historical conditions, uncertainty, stricter scope/sensitivity, conflict status and earliest expiration are retained. The current visible catalog and rules keep their normal conservative influence, so even unrelated selected knowledge can narrow the result's classification or lifetime. A merge cannot silently resolve a historical conflict or lengthen a deadline.
- The signature binds the source commit, historical base hash/revision, support keys, authored content, current input hashes/revisions, rules and confidential choices. Changed inputs or an edited proposal require new preparation, not approval of an old file.
- Only selected/authorized dependent changes appear in the plan and are applied atomically. Hidden or unselected dependents are not rewritten behind the reviewer's back; their owner may need a separate review. Existing transitive reads refuse invalid dependencies rather than treating stale knowledge as valid.
- Applying logs opaque page IDs and the historical commit reference, not private titles or bodies. The existing target origin marker recognizes an **exact successful signed-plan retry** without another commit. A newly prepared proposal is a different review, not a retry. Ordinary new compilation or target changes invalidate the old marker normally.

The program checks provenance and authority, not the semantic truth of the human's new prose. The reviewer must read the actual sources and proposed text; history does not make an old claim true.

## Access, deadlines and recovery

The [historical reader's restrictions](wiki-revision-views.md) all apply: full supported local ancestor commit, matching vault/tenant, clean managed state, current availability of every historical dependency, no missing keys and no implicit history fetching. Ordinary atomic memories cannot be the merge target; they retain their existing review workflow, though their conditions can influence dependent Wiki knowledge.

Sensitive/secret records require both authority and explicit `includeSensitive` / `includeSecret` options (CLI `--include-sensitive` / `--include-secret`). These choices are signed and used consistently for selected Wiki reads, preview, current revalidation and approval. Unselected unrelated private names/hashes do not enter the proposal. The mutation host still performs the existing whole-vault integrity check under its keys; opt-out is not an instruction to disable integrity validation. Reviewers with different scope/visibility may need a regenerated proposal rather than silently accepting a different information boundary.

Preparation's `signal` and approval's `vault.wikiApply(plan, { signal })` combine with enclosing operation cancellation. Preparation does not change canonical files or create evidence/commits, but may initialize the existing local proof state. Preparation and standalone preview recheck cancellation and inherited time bounds after asynchronous lock cleanup; preview also checks the historical deadline after current-state revalidation. Approval checks time again immediately before the transaction becomes ready; earlier failures/cancellation roll back all writes. The CLI handles SIGINT/SIGTERM cooperatively during approval. Once ready, safe commit/recovery follows the existing rules even if cancellation or a deadline occurs during the commit. Approval rechecks cancellation after releasing its lock, too. Cancellation after a successful commit reports that commit in the error's details; inspect the result before retrying. The resulting records retain their expiry and current reads refuse expired support; a completed commit is not proof that content remains usable later.

CLI input must be a regular local UTF-8 JSON file, up to 1,000,000 bytes, using the existing bounded preview-file reader; no stdin, URL or server filesystem reader is added. The authored body is nonempty, at most 100,000 characters and excludes NUL; authored text rejects malformed Unicode rather than accepting text that storage would replace. Valid Chinese/emoji text is preserved. Title/summary and historical graph use their normal bounds. Generated content and the vault's lower limits can still reject an oversized proposal. At most 40 affected Wiki pages can be approved in one transaction. Git uses its existing per-command deadlines; no new overall timeout or operating-system resource sandbox is implied.

No database, cache, vault configuration or canonical page schema migration is needed. A merge plan has a new kind; prepare and approve it with this implementation, not older readers that reject that plan kind. This is not the complete cross-branch/private-vault sharing roadmap, deployment approval or an npm release.
