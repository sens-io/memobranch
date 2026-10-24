# Pinned local / Git Wiki sharing

Add explicit host-configured, read-only access to selected Wiki pages from another
local full Git vault at a pinned commit. This follows the user's selected local /
Git deployment, without a cloud account service. Agent and HTTP arguments choose
only a configured source ID and page keys, never a path, commit selector or identity.
A catalog-pin precondition can reject a stale choice but cannot choose another commit.

Every read must honor current caller and source authority, classification ceilings,
explicit confidential selection, source integrity, encryption keys, withdrawal and
expiry. A local copy can only reflect authority changes available to that local
vault; offline plaintext or an independently controlled clone cannot be recalled.

This batch does not import, merge, approve, push, fetch or change grants. Cross-vault
import and separate merge approval are the following roadmap batch. Configuration
examples and all executing acceptance fixtures use synthetic vaults only.
