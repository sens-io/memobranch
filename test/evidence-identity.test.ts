import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { assertEvidenceDocument, evidenceDigest, legacyEvidenceDigest } from '../src/evidence.js';
import { sha256 } from '../src/utils.js';
import { MemoryVault } from '../src/vault.js';

const invalid = (error: unknown) => error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED';

test('evidence source delimiters cannot silently deduplicate distinct raw inputs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-evidence-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryVault(root);
  await vault.initialize('identity');
  const head = await vault.git.run(['rev-parse', 'HEAD']);
  await assert.rejects(vault.capture({ sourceUri: 'a\0b', content: 'c', scope: 'public', sensitivity: 'public' }), invalid);
  assert.equal(await vault.git.run(['rev-parse', 'HEAD']), head);
  const valid = await vault.capture({ sourceUri: 'a', content: 'b\0c', scope: 'public', sensitivity: 'public' });
  assert.equal(valid.duplicate, false);
  assert.equal((await vault.get(valid.evidenceId)).body, `# Evidence ${valid.evidenceId}\n\nb\0c`);
  assert.equal((await vault.capture({ sourceUri: 'a', content: 'b\0c', scope: 'public', sensitivity: 'public' })).duplicate, true);
  assert.notEqual(evidenceDigest('public', 'public', 'a', 'bc'), evidenceDigest('public', 'public', 'ab', 'c'));
});

test('current and legacy imported evidence refuse ambiguous source identities without changing valid hashes', () => {
  assert.equal(evidenceDigest('user', 'internal', 'source', 'body'), sha256('memobranch:evidence:v2\0user\0internal\0source\0body'));
  assert.equal(legacyEvidenceDigest('user', 'source', 'body'), sha256('user\0source\0body'));
  for (const legacy of [false, true]) {
    const digest = sha256(`${legacy ? 'public' : 'memobranch:evidence:v2\0public\0public'}\0a\0b\0c`);
    const id = `ev-${digest.slice(0, 12)}`;
    assert.throws(() => assertEvidenceDocument({ path: 'evidence/ambiguous.md', body: `# Evidence ${id}\n\nc`,
      meta: { id, type: 'evidence', immutable: true, scope: 'public', sensitivity: 'public', sourceUri: 'a\0b',
        sha256: digest, actor: 'test', createdAt: new Date().toISOString() },
    }, { allowLegacyEvidence: true }), invalid);
  }
});
