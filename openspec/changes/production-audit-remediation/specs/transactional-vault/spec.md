# Transactional Vault Delta

## ADDED Requirements

### Requirement: Lock ownership is stable
A live writer MUST NOT lose its lock because of elapsed time, and a writer MUST remove a lock only when its owner token still matches.

#### Scenario: A mutation exceeds the stale threshold
- **WHEN** the recorded PID is still alive after the threshold
- **THEN** another writer waits or returns a typed timeout without entering the critical section

### Requirement: Erasure is recoverable
Cryptographic erasure MUST persist a non-secret intent and complete key destruction before committing the success tombstone and audit record.

#### Scenario: Key-store update fails
- **WHEN** wrapped-key deletion cannot be persisted
- **THEN** the operation fails without a success commit and can be retried or recovered safely

### Requirement: Evidence immutability is verified
Health, mutation preflight, and remote validation MUST verify captured evidence identity against its canonical hash and MUST NOT sweep unrelated managed changes into an operation commit.
