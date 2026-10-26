# Cloud host setup and Git adapters — verification in progress

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
This record covers local development, not an npm release, push or deployment.
The complete cloud batch is not accepted until the remaining gates below pass.

## Candidate and behavior

- `ba77efe`: real Git CLI/MCP/Harness acceptance tests.
- `3b113867756714ea0719a6740c242f287d4b50b2`: native host setup, foreground
  service, fixed operator ceilings, installed-consumer checks and bilingual guides.

The native administrator commands generate an inactive random credential, print
a validated one-account template using existing broker/source identities, check
current local reader bindings, and run the separate read service in the foreground.
They do not persist accounts, modify grants or install a daemon. Private read-lock
bookkeeping is expected. The operator reviews and explicitly saves configuration.
Service accounts remain read-only. A cloned startup operator policy limits later
account-file changes; changing that policy requires a restart. Existing trusted
library hosts may omit this optional ceiling and retain their prior behavior.

The Git adapter tests use actual CLI processes, the MCP SDK, the Harness SDK and
disposable bare repositories. They cover old pins against current authority,
private selection, host-selected identities/configuration, withdrawn grants,
offline fetch refusal and actual per-call cancellation without a caller writer.
They check both vaults' canonical state, a raw evidence sample and model-call count.

## Checks retained so far

- `.scratch/git-shared-wiki-adapters-1.log`: 6/6 new Git adapter checks passed.
- `.scratch/cloud-host-cli-3.log`: the initial 12/12 host command checks passed.
- `.scratch/cloud-host-and-transports-1.log`: 56/56 combined host, Git adapter,
  cloud adapter/server/client checks passed; no failures, cancellations or skips.
- A new derived-identity regression genuinely failed before its fix:
  `.scratch/cloud-host-template-schema-red.log`, missing expected rejection.
  Vault configuration accepts longer IDs than service accounts; template output
  now passes the complete service account schema after deriving the broker IDs.
- `.scratch/cloud-host-and-transports-2.log`: 57/57 current combined checks passed,
  including that regression and rejection of a request-selected operator.
  Build and test type checks passed in `cloud-host-build-4.log` and
  `cloud-host-types-7.log`.
- The installed-consumer script passed against the workspace build in
  `.scratch/cloud-host-consumer-direct.log`; this is not installed-archive proof.
- The first minimum-runtime invocation used a test-runner option unsupported by
  Node 20.0 (`cloud-host-node20.log`, exit 9, no tests executed). The corrected
  invocation removes only that option, retaining the compiled tests and assertions.
- The next compiled run passed 47 functional checks, but the two SDK test files
  could not load `src/version.js`: the staging directory lacked its parent
  `package.json` (`cloud-host-node20-2.log`, 47 passed / 2 file-load failures).
  Copying the unchanged package metadata into that compiled directory repairs the
  verification layout; no product or test assertion was changed.
- With package metadata present, the next run passed 56/57: its actual Web check
  correctly refused to start because the compiled staging directory also lacked
  the unchanged `assets/logo.png` required by the management service
  (`cloud-host-node20-3.log`). The staging directory now includes that runtime
  asset as well. This failed gate is retained; it is not reported as a product
  fix or a passing minimum-runtime run.
- With the required metadata and asset present, `.scratch/cloud-host-node20-4.log`
  passed all **57/57** compiled checks on Node 20.0.0, zero failures, cancellations
  or skips. Source/tests and assertions match `3b113867`; no TypeScript runtime
  loader or unsupported test-runner flag is used. The preparation copies only
  the unchanged `package.json` and `assets/logo.png` beside the compiled output.

Host tests exercise real loopback HTTP and native TLS with an explicit fixture CA,
untrusted-certificate refusal, rate limits, SIGINT/SIGTERM, source-lock waits,
startup cancellation, token/account changes, argument validation and unchanged
canonical state/configuration. All accounts, credentials and grants are synthetic.

## Independent candidate review

Two independent read-only reviewers inspected fixed range `47ddea48..3b113867`
on source branch `kevin/knowledge-expansion`: 6/6 runtime/package files and 9/9
documentation/test files, zero skipped. The local OCR preview selected the six
runtime/package files; its nine default exclusions were all reviewed manually.
Rules and selection are retained in `.scratch/cloud-host-review-{preview,rules}.json`.
OCR warned about the installed Git version; neither Git nor OCR was upgraded and
no external review-model endpoint was called.

Runtime review found no confirmed issue. Documentation review found one inaccurate
English sentence: check validates broker identities but reports account IDs and
source counts, rather than reporting the broker identities. The sentence is fixed;
the implementation and the Chinese guide already matched that behavior. Final
text/verification review remains pending until the gates are recorded.

The final guide examples also invoke `node dist/cli.js` from the repository root,
so building a checkout does not accidentally direct users to an older globally
installed CLI. This is a documentation correction, not a runtime change.

Strict validation passed 31/31 items in `.scratch/cloud-host-specs.log` and the
production audit reported zero vulnerabilities in `.scratch/cloud-host-audit.json`.

## Pending gates

Complete checks under both Git defaults, the same fresh installed archive on
Node 20/22, and final verification-text review remain to be recorded. Earlier browser and Git
transport checkpoints are retained separately; this phase changes no browser UI.
Roadmap batches 4–6 remain pending even after the cloud batch is accepted.
