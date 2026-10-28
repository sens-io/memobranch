# Supplemental Linux minimum-runtime import checks

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Input checkpoint: `fe28232d53440a2fbbc3ecf38a63b8d6f315a3ed`. These are additional
platform checks, not a replacement for the retained macOS Node 20 **35/37** result
and not whole-batch/roadmap acceptance.

## Same minimum version and unchanged tests

The [official Node image](https://hub.docker.com/_/node) was resolved through its
actual registry manifest to the Linux arm64/v8 image
`sha256:4f132d4d529bab6cf3e063ceb6fb84ffc21808943e64f21968d18f5d1a4c814c`.
The container asserted **Node v20.0.0**, Linux and arm64. This downloaded a separate
test image; it did not upgrade the host runtime or change host security settings.
Registry/pull records: `.scratch/wiki-import-linux20-manifest.json` and
`wiki-import-linux20-pull.log`.

The read-only input bundle has SHA-256
`dd9f4b115f3aaab7440322f8da0571cda819fe24d56970ac2a5dec1ec48126c1`.
It contains the current source/dist, unchanged installed dependencies, original
tests and corresponding compiled files, package/lock, patch and assets. It does
not mount the working repository, host Git configuration, cloud credentials or
SSH files. The bundle hash is checked before extraction, and all **330** recorded
source/dist/compiled-core/selected-test/manifest/asset hashes are checked inside
each container before testing. Full inventory: `wiki-import-linux20-inventory.json`.
This bundle is distinct from the unchanged 457-entry npm archive verified earlier.

Both attempts run the exact complete **37-check** collection: compiled
`wiki-import-adapters.test.js`, `shared-wiki-adapters.test.js`,
`deepseek-harness.test.js` and `directory-import.test.js`. Assertions and the
original 10-second CLI waiter bounds remain unchanged. No fixture or test is
excluded, rewritten or relabeled as a pass. A separate 300-second outer process
limit only prevents an abandoned container run; it does not change test deadlines.

## Default-branch setup limitation caught and corrected

Initial runs each passed 37/37 (`wiki-import-linux20-{main,master}.log`), but their
Git-default labels were insufficient evidence. A real follow-up implicit init in
the image's Git 2.30.2 observed `master` despite requesting `main` through the
previous environment-only setup (`wiki-import-linux20-default-probe.log`). Those
two runs are not counted as proof of both defaults.

The corrected runner writes the chosen default only to the disposable container's
own Git global configuration. Before tests, it performs an actual implicit
`git init`, reads its symbolic branch and requires equality with the chosen
default. It still verifies the same bundle and all 330 hashes. No host Git file,
product code or test assertion changes.

Both corrected containers exited 0 and were automatically removed. A final
filtered container listing found no remaining container owned by this check.

| Actual probed Git default | Complete collection | Duration | Raw log |
| --- | --- | --- | --- |
| `main` | **37/37**, zero fail/cancel/skip | 27692.397054 ms | `.scratch/wiki-import-linux20-main-2.log` |
| `master` | **37/37**, zero fail/cancel/skip | 22394.285844 ms | `.scratch/wiki-import-linux20-master-2.log` |

The corrected runner's SHA-256 is
`d146854fd0fc0727146d3ad66ed13e7e460346f618dc3e5165b2600e6819f6a5`.
The input-bundle hash remained unchanged after both runs. Both final logs record
the actual probed default, exact runtime and successful 330-file comparison.
The two original CLI cancellation cases executed under their unchanged bounds.

## Isolation and remaining limits

Docker context was the local `desktop-linux`. Test containers use no network or
published ports, read-only input mounts, a disposable `/work`, 2 GiB memory,
2 CPUs and 256 process limit, with automatic removal. Actual master-container
inspection is retained in `wiki-import-linux20-container.json`. No real vault,
cloud account, grant, external service or model request was configured.

GNU tar warned that Apple provenance extended attributes were ignored; all
recorded code bytes still matched. These warnings are preserved in the raw logs.
No fresh dependency install, audit, complete Linux repository suite or installed
npm consumer is claimed by this selected compiled-suite check. In particular this
is Debian arm64, not a GitHub-hosted Ubuntu x64 CI result.

Fixed-candidate independent review of this supplement is pending. An independently
passing platform does not establish the cause of the macOS
startup waits. The original failed command/output and diagnostic samples remain
part of the [agent record](shared-wiki-agent-verification-2026-10-28.md) and
[recovery checkpoint](shared-wiki-import-recovery-verification-2026-10-28.md).

Database changes: none. Data migration: none. Real configuration changes: none.
The Git-default test configuration exists only inside disposable containers.
No push, npm publication or deployment occurred.
