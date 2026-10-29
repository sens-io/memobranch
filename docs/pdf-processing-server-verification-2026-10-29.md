# Unknown server arguments — correction checkpoint

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
This corrects the server-boundary requirement while the optional PDF workflow
remains under verification. It does not accept the complete batch.

## Observed problem and change

The first complete installed-consumer attempt failed in the new processed-PDF
consumer: `memory_get` accepted an otherwise valid request carrying unsupported
`processor` and `path` fields. It ignored those values; no supplied processor was
executed. That still contradicted the explicit rejection contract. The independent
MCP/Harness regression confirmed the same issue in both entrypoints, **0/2 passed**
in `.scratch/pdf-processing-server-fields-red.log`.

MCP's remaining 20 open object declarations now use strict objects, preserving
every supported field/default and strict review alternatives. Harness registration
closes the SDK's implicit open root for all 47 registration sites and validates
before the original SDK tool executes. Nested explicitly opaque plan objects keep
their existing core validation. No tool, permission, category or host-configurable
path/command is added. Standard project JSON errors are preserved; request values
are not included in the new validation message.

Two real protocol regressions start from valid get/version/capture requests and
individually add 10 unsupported host/media fields. All 60 resulting requests refuse
before actual `get`, `capture` or `config` callbacks: MCP has synchronous child
markers and Harness records the real prototype calls. All currently visible tool
roots advertise closed arguments, and canonical evidence/head remain unchanged.

## Retained attempts

| Attempt | Actual result |
| --- | --- |
| Installed archive 1 | Complete consumer run failed at unsupported MCP fields; `.scratch/pdf-processing-package-node22-main.log`. Archive: 476 entries, SHA-256 `6c90216cf3af647020fd73c4b4054cae4d216440463f66f2494b2fa533abeb0c`. Earlier successful substeps do not turn the aggregate green. |
| First wrapper build | Failed recursive SDK generic type comparison. The implementation moved enforcement to registration around an already typed SDK definition. `.scratch/pdf-processing-server-build.log` retained. |
| New test declarations | Failed missing SDK default-config fields and branded call-ID types; corrected only the new fixture declarations. `.scratch/pdf-processing-server-types-2.log` retained. |
| First related runtime | 37/38: direct SDK argument error broke the existing JSON error assertion. Existing assertions were retained; the wrapper now emits the established project validation error. `.scratch/pdf-processing-server-fixed-3.log` retained. |
| Related Node 22 | **38/38**, zero fail/cancel/skip, exit 0, after callback markers were added: `.scratch/pdf-processing-server-fixed-5.log`. Build/types passed in `server-build-3.log`, `server-types-5.log`. |
| First compiled Node 20 collection | 29/38. Seven failures were incomplete `dist` staging or the development `.ts` loader; two were the retained CLI waiter failures. `.scratch/pdf-processing-server-node20.log`. |
| Corrected complete Node 20 collection | **36/38**, zero cancelled/skipped; the original `import-prepare` and `import-apply` waiter observations still failed. `.scratch/pdf-processing-server-node20-2.log`. No deadlines/assertions changed. |
| Stronger callback supplement | **3/3 on Node 20.0.0**, zero fail/cancel/skip: new callback regressions plus the existing MCP negotiation test. `.scratch/pdf-processing-server-node20-guards.log`. This is limited new evidence, not a replacement for the red 38-case aggregate. |

The loader diagnostic actually reported `ERR_UNKNOWN_FILE_EXTENSION` for the
source `.ts` entrypoint on Node 20.0.0. The existing MCP negotiation test now starts
the shipped `dist/mcp.js`, preserving every assertion and running the real product
without a development loader. Compiled staging includes the full unchanged built
`dist`, worker, package/assets and original non-TypeScript fixtures.

Prior to this server correction, candidate `1df543e3` completed the full
**1052 functional + 14 release + 10 evaluation = 1076 checks under each actually
probed Git default**, zero fail/cancel/skip. Logs: `pdf-processing-full-main.log`
and `pdf-processing-full-master.log`. Production dependency audit reported **0**
in `pdf-processing-audit.json`; dependencies have not changed. That earlier full
run does not substitute for a fresh full run after these server changes.

## Still open

Committed-candidate review, Linux minimum-runtime checks, a new same-archive
installed-consumer run and fresh complete gates are pending for this correction.
The existing macOS minimum-runtime waiter failure remains unexplained; no platform
cause or fix is claimed. The earlier Linux supplement is not relabeled as a run
of this new code.

The user confirmed on 2026-10-29 that no Windows test environment is available.
Windows background helper ownership and actual ACL/process evidence remain open;
absence of that environment is not a passing result or permission to omit the work.

Database changes: none. Data migration: none. Configuration changes: none in this
server correction. No dependency upgrade, real account/grant/service/config change,
push, publication or deployment occurred.
