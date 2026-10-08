# Close October integrity audit findings

## Why
The next independent audit found reproducible data-integrity and management boundary defects beyond the existing regression suite. The baseline is `8331b55`; its GitHub CI passed, but passing tests do not establish absence of untested defects.

## What Changes
- Validate embedding response identity, vector shape and cache integrity before semantic scoring; preserve lexical fallback.
- Align Web content validation with core limits and prevent management reads of in-flight transactions.
- Remove ambiguous raw-evidence identity inputs without rewriting existing raw evidence.
- Check remote tree boundaries before materializing incoming files.

## Impact
Local fixes, targeted regressions, full retention checks, independently reviewed commits and a bounded verification record. No push, merge or npm publication is included.
