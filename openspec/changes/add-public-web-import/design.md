# Public source import design

## User workflow
Explicit URLs → bounded HTTPS reads → content-free preview manifest → user inspection → re-fetch/revalidate complete manifest → immutable evidence captures → separate Wiki ingest/review/apply. Ordinary recall/query behavior is unchanged.

## Network policy
Use the built-in HTTPS client rather than default fetch/proxy behavior. Accept HTTPS port 443 only, without URL credentials or ambiguous controls/backslashes. Strip fragments, normalize names and reject local-use hostnames. Validate literal addresses and every DNS result against a deliberately conservative public-address policy based on IANA special-purpose ranges. Reject mixed public/private answers. Resolve through an owned Resolver, cancel it on timeout/abort and pin one accepted address in the connection lookup. Never re-resolve during the request. Verify TLS for the URL host and verify the actual peer address matches the selected address. Each redirect repeats URL/DNS/address checks; permit at most three redirects and no downgrade. Do not send cookies, authentication, referer or caller-supplied headers; do not use process proxy variables or shared connection/session pools.

IPv4 denies private, loopback, shared, link-local, documentation, benchmark, protocol-assignment, multicast and reserved ranges. IPv6 allows ordinary global unicast only, excluding special-purpose/protocol, translation/tunnel, documentation and deprecated ranges. This intentionally rejects some globally reachable special-use addresses instead of treating every IANA exception as a useful document host. It is not a substitute for an operator's outbound firewall or control over routing/custom NAT64 prefixes.

## Bounds and evidence
At most 20 URLs, 1 MB per response, 5 MB combined source bytes, 16 KiB response headers and a 60-second batch preflight deadline. Each source defaults to a 10-second total deadline, configurable only within 1–30000 ms, including DNS and redirects. Accept successful UTF-8 text/plain, text/markdown, text/html and application/xhtml+xml responses; request identity encoding and refuse compressed/binary or non-UTF-8 responses. Preserve HTML as untrusted data, not executable content or an extracted article.

Manifest fields contain no body. Include input and final URL, media type, raw UTF-8 byte count/hash and a deterministic manifest revision. It is a drift detector, not an authorization signature. URL names/query strings may still be sensitive; do not use secret-bearing URLs and store manifests in a trusted location. Apply authenticates tenant/write/scope/sensitivity before any network read, validates a strict manifest, re-fetches all sources and checks exact provenance/fingerprints before writing. Capture content is a deterministic JSON source envelope with original/final URI, media type, original bytes/hash and exact decoded UTF-8 text (including BOM and whitespace). No fetch timestamp enters identity; repeated unchanged captures remain idempotent. The evidence's own recorded timestamp is first capture, not every later freshness check.

Each evidence uses the existing recoverable transaction. Cancellation/failure before capture writes nothing; after captures begin, completed commits remain and the result identifies progress and any commit-boundary cancellation. Retry revalidates sources, reuses saved evidence and captures missing sources. Progress callbacks may be synchronous or awaited asynchronous callbacks. No plaintext persistent body queue is introduced.

## Alternatives
A generic browser/crawler would support more pages but would introduce scripts, authentication and substantially broader network authority. Full remote connectors/background jobs also require encrypted durable jobs and ownership. Keep a deterministic explicitly selected source reader first. A high-level fetch with default DNS/redirect handling is simpler but cannot supply the required connection/address checks; use a narrow HTTPS implementation instead.

## Verification and rollout
Separate production address/URL/DNS/redirect policy tests from actual loopback TLS transport tests. Internal dependency seams are not exported through the package root, configurable via environment, or exposed as agent arguments. Use synthetic readers for repeatable drift/progress/permission cases and describe that limitation honestly. Retain all existing checks with Git defaults main/master, verify actual installed JavaScript at Node 20.0.0, and review committed candidates read-only. No real private sources, publication, deployment or push. Source-format rollback leaves existing evidence intact; compiling and approving knowledge remains explicit.

## References
- [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/)
- [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/)
- [Node HTTPS request API](https://nodejs.org/api/https.html#httpsrequestoptions-callback) and the locally installed supported-runtime types. Minimum-runtime behavior is verified on Node 20.0.0, not inferred from the latest documentation.
