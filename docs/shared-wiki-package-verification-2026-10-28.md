# Wiki import/integration installed-package verification — in progress

Repository: `sens-io/memobranch`. Source branch: `kevin/knowledge-expansion`.
Product source checkpoint: `e558e4624812321a7a9f1634f71b9efaed61c91e`.
The additional consumer verification program is under development. This report
does not accept batch 4, supersede failed checks, publish npm or deploy anything.

## Artifact and intended checks

The locally packed archive is `.scratch/wiki-import-package/memobranch-1.1.0.tgz`.
Its SHA-256 before both Node 22 attempts is
`07d621aa54a5d6455f5b9a2d98014d1641acd38b8f9016f3dd8471e1d30b40af`,
recorded in `wiki-import-package-sha-before.txt` and `-sha-retry.txt`.
The second attempt uses exactly the same archive; verifier scripts are copied to
the fresh consumer and import only the installed package's public exports.

The package verifier now requires the compiled import artifact/importer,
human-integration module, Web workbench, public declarations and bilingual guides.
Its public-type consumer checks `WikiIntegrationOptions`, `WikiIntegrationOrigin`
and prepare/preview methods. The new installed verifier exercises actual library,
CLI, MCP SDK, Web HTTP and Harness SDK copy/integration. It checks an old fixed pin
after source advancement, no canonical preparation writes, separate confirmation,
retained local provenance/restrictions, forged-plan refusal, exact copy/Wiki
retries, unchanged source/raw evidence/model count and local integration after
sharing removal. These are synthetic functional checks, not semantic correctness
or independent verification of original sources.

## Actual results so far

The first Node 22/main run (`.scratch/wiki-import-package-node22.log`) passed all
previous installed consumer programs through Git sharing. It then failed while
the new synthetic source was being advanced, before the new copy/integration
exercise: the test model stub returned page data for the engine's navigation
request. Strict validation correctly rejected that wrong response. The stub now
returns the expected navigation keys; assertions, product validation and timeouts
were not weakened. Retain this failed run.

The full second Node 22/main run passed in
`.scratch/wiki-import-package-node22-2.log` (**457 packed entries**, process exit
0), including all five new actual consumer paths and all retained consumer
programs. The same 457-entry archive also passed the complete Node 20/master
consumer run with exit 0 (`wiki-import-package-node20.log`). The before/retry/
between hash files and the later strengthened check all have the same digest above.

Independent read-only review of `3abcff8b` covered 3/3 files, zero skipped. It found
three verification scope limitations, rather than a product-function defect:

| Source branch | Scope limitation | Strengthening |
| --- | --- | --- |
| `kevin/knowledge-expansion` | Only the library performed a first capture; the other adapters reused it. | Five explicit synthetic source aliases now produce five unique artifacts: every adapter must first capture with a commit, leave the Wiki catalog unchanged, and separately prove exact-copy retry. |
| `kevin/knowledge-expansion` | The model counter observed the source fixture only. | All four public model entry points are guarded in the parent and native CLI/MCP children; even a caught model error appends a marker which must remain empty. The independent source stub counter must also remain unchanged. |
| `kevin/knowledge-expansion` | Saved content was compared only by body; restrictions were checked in preview. | Each saved target now also matches preview evidence, conditions, uncertainty, scope, sensitivity, status and optional expiry. |

The strengthened program passed on both **Node 22/main and Node 20/master**,
in a new independently installed consumer of that unchanged archive, using the
same SDK versions from the root lock. All five first captures, five separate Wiki
applications, exact retries, forged refusals, model guards and saved-field checks
executed. It retained ten Wiki pages (five targets and five source summaries).
After confirming a current duplicate still worked, removing the fixture binding
refused that exact plan while allowing a new local integration preview from its
retained artifact without applying it. Logs:
`.scratch/wiki-import-strengthened-{node22,node20}.log`; the serialized runner
exited 0 and cleaned its temporary consumer. Before/after archive hashes are in
`wiki-import-strengthened-hashes.json`; the runner also asserted equality after
each runtime. This strengthens the earlier consumer checks without replacing or
weakening their existing assertions.

Both complete repository Git-default runs, production audit and independent
fixed-candidate re-review of the strengthened verifier remain pending.
The compiled Node 20 CLI startup failures remain documented in the
[agent checkpoint](shared-wiki-agent-verification-2026-10-28.md); an installed
consumer result must not be substituted for that failed run.

Database changes: none. Data migration: none. Configuration changes: no new format
or real configuration edits. No push, npm publication, deployment, account/grant
change, runtime upgrade or exported-skill installation occurred.
