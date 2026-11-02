# Web review of same-vault historical Wiki merges

## Why
The local merge API/CLI is complete, but operators cannot inspect history and prepare that review in the management console.

## What Changes
- Add authenticated bounded local revision-view and merge-preparation routes, preserving the core's current authority, selection, cancellation and deadline checks.
- Add an in-memory historical/current comparison and manual editor, followed by complete signed-plan preview and separate explicit approval.
- Invalidate old results on input/session/navigation changes and never execute a model, share a vault or approve automatically.

## Non-goals
No branch/vault import, new grants, arbitrary paths, model rewriting, persistent browser drafts, external assets, publication, push or deployment.
