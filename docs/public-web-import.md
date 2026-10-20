# Public HTTPS source imports

Development-source feature, not yet published to npm. This imports explicitly selected public documents as **evidence**, not automatically approved Wiki pages.

## Preview, inspect, apply

```sh
mkdir -p .scratch
memobranch import web-preview https://example.com/guide https://example.com/notes \
  --timeout-ms 10000 > .scratch/web-plan.json
# Inspect original/final URLs, media types, sizes and hashes before applying.
memobranch import web-apply --plan .scratch/web-plan.json --root ./vault \
  --scope project --sensitivity internal --progress
```

The preview contains no body, but URLs and query strings can themselves be sensitive. Use publicly accessible URLs without secrets and keep the preview in a trusted place. It is a content/provenance drift detector, not a signed grant of authority. Source content is untrusted input.

Apply re-fetches **all** sources and checks their original/final addresses, types, byte counts and hashes before saving the first evidence record. Any change requires a new preview. After validation, the verified in-memory snapshot is captured; changes occurring later are not silently substituted. Retries revalidate and reuse unchanged evidence. Each source is its own existing recoverable transaction, not one all-or-nothing transaction for the entire batch.

Progress is written to stderr; the final result is JSON on stdout. Ctrl+C stops owned network/Git work. Before the first capture, cancellation/failure writes no evidence. Afterwards, completed captures remain identifiable and retryable; commit-boundary cancellation may report `interruptedCommits`. A cancelled/failed capture stage exits nonzero. No model call, candidate extraction, Wiki approval or background job is automatic.

Use returned evidence IDs with `wiki ingest`; review and apply that plan separately. HTML is retained as raw source text inside a JSON envelope. It is not rendered/executed, cleaned into an article, fetched through a browser or interpreted as trusted instructions. The deterministic envelope retains source/final URI, MIME type, raw byte count/SHA-256 and exact UTF-8 text, including BOM/whitespace; the original source bytes can be reconstructed as UTF-8. No volatile fetch timestamp affects evidence identity. Existing `source timeline` shows appended versions by original URL and current authorized references; recorded time is first capture, not every later freshness check.

## Library

```ts
import { previewWebImport, applyWebImport } from 'memobranch';

const controller = new AbortController();
const plan = await previewWebImport(['https://example.com/guide'], {
  signal: controller.signal,
  timeoutMs: 10000,
});
// Inspect plan before applying it with a policy-bound MemoryVault.
const result = await applyWebImport(vault, plan, {
  scope: 'project',
  sensitivity: 'internal',
  signal: controller.signal,
  onProgress: async item => { console.log(item.completed, item.total); },
});
```

`readWebImportPlan(path)` reads a strict bounded JSON manifest; `serializeWebImportPlan(plan)` produces the same size-checked newline-terminated form used by the CLI. Library progress callbacks are awaited. Caller-owned callbacks must settle; the network deadline does not limit arbitrary callback code. Apply checks current tenant/write/scope/sensitivity authority **before network reads**, and each capture rechecks existing mutation rules. Confidential evidence uses the existing encryption policy. No arbitrary URL-import endpoint is added to Web/MCP/Harness; this is a local CLI/library workflow, not a server-side proxy.

## Network and format boundaries

- HTTPS port 443 only. No URL credentials, local-use hostnames, ambiguous controls/backslashes, HTTP downgrade or nonstandard ports. Fragments are removed and URLs normalized before identity/deduplication.
- Literal addresses and every DNS answer must pass a conservative public-address policy. Mixed public/private answers are refused. The selected address is fixed for the socket lookup; TLS verifies the URL host and the actual peer address must match. Each redirect repeats the checks, with at most three redirects.
- No cookies, authorization, referer, custom headers, proxy configuration or shared connection/session pools. The reader does not use ambient HTTP proxy variables. TLS is not disabled by an import option.
- At most 20 unique URLs, 1 MB per source, 5 MB total source bytes and a 1 MB preview including its trailing newline. Response headers are limited to 16 KiB. The 60-second batch deadline covers preflight; each source defaults to a 10-second total deadline including DNS/redirects/body, configurable from 1 to 30000 ms. Existing vault character limits also apply to the full source envelope before capture.
- Accept HTTP 200 and nonempty UTF-8 `text/plain`, `text/markdown`, `text/html`, `application/xhtml+xml` (ASCII is accepted as a UTF-8 subset). Reject unsupported encodings/charsets, NUL-containing text, malformed UTF-8, binary/PDF and compressed responses even if a server ignores `Accept-Encoding: identity`. Some ordinary websites will therefore be intentionally unsupported.

Address restrictions are based on the [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/) and [IPv6 special-purpose registries](https://www.iana.org/assignments/iana-ipv6-special-registry/), with a conservative policy that also rejects some globally reachable special-use exceptions. The [Azure virtual platform address](https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16) `168.63.129.16` is explicitly refused despite its numerically public range. This is not a universal network-isolation guarantee: operator-controlled routing, custom translation prefixes, custom trust roots and outbound firewalls remain outside the library's authority. The transport uses [Node's HTTPS request API](https://nodejs.org/api/https.html#httpsrequestoptions-callback), with minimum-runtime behavior checked on the installed artifact rather than assumed from latest documentation.

## Remaining work

This is not a crawler or a complete document connector. There is no JavaScript rendering, article extraction, authenticated site support, scheduled synchronization, source deletion/revocation automation, PDF parsing, durable background compilation, fact-effective historical reconstruction, shared-vault merging or skill export. Operators still choose source classifications and explicitly review derived knowledge. Rollback of application code does not rewrite previously captured evidence.
