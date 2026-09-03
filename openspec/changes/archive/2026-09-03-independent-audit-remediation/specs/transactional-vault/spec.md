# Transactional Vault Delta

## ADDED Requirements

### Requirement: Lock reclamation is race-free
Dead-owner recovery MUST NOT remove a successor's lock, and concurrent stale-lock observers MUST elect only one process to acquire or reclaim the conventional writer lock.

#### Scenario: Many processes observe the same dead lock
- **WHEN** multiple writers concurrently encounter one stale lock
- **THEN** exactly one writer enters the critical section at any time and every live successor retains ownership until it exits
