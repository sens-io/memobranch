# Independent audit remediation tasks

## 1. Specify and reproduce

- [x] 1.1 Record all seven independent findings as fail-closed requirements.
- [ ] 1.2 Add boundary regressions for multi-process stale-lock recovery, plaintext remote secrets, evidence sensitivity downgrade, cross-process revocation, confidential Git metadata, tenant omission, and erasure reason commitment.

## 2. Concurrency and retrieval

- [ ] 2.1 Implement uniquely owned lock contenders and single-winner stale recovery.
- [ ] 2.2 Invalidate in-memory search state when another process atomically replaces the persistent index.

## 3. Confidentiality and identity

- [ ] 3.1 Reject plaintext confidential documents at canonical read and synchronization boundaries.
- [ ] 3.2 Bind evidence sensitivity into capture identity and verify evidence on every direct read.
- [ ] 3.3 Remove confidential keys from Git paths and commit messages; redact non-admin history subjects.
- [ ] 3.4 Require tenant binding for all non-admin principals.
- [ ] 3.5 Persist a SHA-256 erasure-reason commitment and handle legacy intents truthfully.

## 4. Release evidence

- [ ] 4.1 Run build, boundary tests, retention tests, coverage, dependency audit, package dry-run, strict OpenSpec validation, and diff checks.
- [ ] 4.2 Record commit-bound verification evidence and archive the completed change.
