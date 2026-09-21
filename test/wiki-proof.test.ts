import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { promisify } from 'node:util';
import { AgentMemoryError } from '../src/errors.js';
import { withOperation } from '../src/operation.js';
import { stableWikiJson, WikiProof } from '../src/wiki-proof.js';

const roots: string[] = [];
const exec = promisify(execFile);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'memobranch-wiki-proof-'));
  roots.push(root);
  return root;
}

function invalid(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'VALIDATION_FAILED';
}

function result() {
  return {
    vaultId: 'vault-one', answer: 'The evidence is incomplete.',
    citations: [{ key: 'topic', revision: 2, evidence: ['evidence/a.md'], uncertainty: ['Preliminary evidence.'] }],
    uncertainty: ['Further research is required.'], snapshot: { 'wiki/topic.md': 'revision-two' },
  };
}

test('a signed result verifies after restart and across JSON object-key order', async () => {
  const root = await freshRoot();
  const value = result();
  const proof = await new WikiProof(root).sign(value);
  assert.match(proof, /^[a-f0-9]{64}$/);
  await new WikiProof(root).verify(JSON.parse(JSON.stringify(value)), proof);
  await new WikiProof(root).verify({ snapshot: value.snapshot, uncertainty: value.uncertainty, citations: value.citations, answer: value.answer, vaultId: value.vaultId }, proof);
});

test('client edits to the answer, citation, uncertainty, identity or plan cannot reuse the proof', async () => {
  const root = await freshRoot();
  const helper = new WikiProof(root);
  const value = result();
  const proof = await helper.sign(value);
  for (const altered of [
    { ...value, answer: 'This is certain.' }, { ...value, citations: [] }, { ...value, uncertainty: [] },
    { ...value, vaultId: 'vault-two' }, { ...value, citations: [{ ...value.citations[0], uncertainty: [] }] },
    { ...value, snapshot: { 'wiki/topic.md': 'revision-three' } },
  ]) await assert.rejects(helper.verify(altered, proof), invalid);
  const plan = { kind: 'compile', pages: [{ key: 'one' }, { key: 'two' }], sourceIds: ['one', 'two'] };
  const planProof = await helper.sign(plan);
  await assert.rejects(helper.verify({ ...plan, pages: [...plan.pages].reverse() }, planProof), invalid);
  await assert.rejects(helper.verify({ ...plan, sourceIds: [...plan.sourceIds].reverse() }, planProof), invalid);
  for (const malformed of ['', '0'.repeat(63), 'f'.repeat(65), 'x'.repeat(64), proof.toUpperCase(), '../wiki-proof-key']) {
    await assert.rejects(helper.verify(value, malformed), invalid);
  }
});

test('canonical JSON preserves array order and safe JSON values while omitting optional undefined', () => {
  assert.equal(stableWikiJson({ b: 2, a: { z: null, b: false, a: 'text' }, optional: undefined }), '{"a":{"a":"text","b":false,"z":null},"b":2}');
  assert.equal(stableWikiJson(JSON.parse('{"__proto__":{"safe":true},"constructor":"data"}')), '{"__proto__":{"safe":true},"constructor":"data"}');
  assert.notEqual(stableWikiJson({ values: [1, 2] }), stableWikiJson({ values: [2, 1] }));
  const shared = { key: 'same' };
  assert.equal(stableWikiJson({ a: shared, b: shared }), '{"a":{"key":"same"},"b":{"key":"same"}}');
});

test('non-JSON, cyclic, accessor and proxy inputs fail without evaluating user code', async () => {
  const root = await freshRoot();
  const helper = new WikiProof(root);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let evaluated = false;
  const accessor = Object.defineProperty({}, 'answer', { enumerable: true, get() { evaluated = true; return 'changed'; } });
  const customJson = { toJSON() { evaluated = true; return {}; } };
  const proxy = new Proxy({}, { ownKeys() { evaluated = true; return []; } });
  const extraArray = Object.assign([1], { extra: true });
  for (const value of [cycle, accessor, customJson, proxy, new Date(), new Map(), { value: NaN }, { value: Infinity }, { value: 1n }, { value: () => 1 }, { value: Symbol('value') }, { [Symbol('hidden')]: true }, { values: [undefined] }, { values: new Array(2) }, { values: extraArray }]) {
    await assert.rejects(helper.sign(value), invalid);
  }
  assert.equal(evaluated, false);
  assert.equal(existsSync(join(root, '.amem')), false);
});

test('verification with a missing key never creates operational storage or replaces a lost key', async () => {
  const root = await freshRoot();
  const value = result();
  await assert.rejects(new WikiProof(root).verify(value, '0'.repeat(64)), invalid);
  assert.deepEqual(await readdir(root), []);
  await mkdir(join(root, '.amem'));
  await assert.rejects(new WikiProof(root).verify(value, '0'.repeat(64)), invalid);
  assert.deepEqual(await readdir(join(root, '.amem')), []);
  const proof = await new WikiProof(root).sign(value);
  await rm(join(root, '.amem', 'wiki-proof-key'));
  await assert.rejects(new WikiProof(root).verify(value, proof), invalid);
  assert.deepEqual(await readdir(join(root, '.amem')), []);
});

test('concurrent first signers publish one complete private key and agree on the proof', async () => {
  const root = await freshRoot();
  const value = result();
  const proofs = await Promise.all(Array.from({ length: 24 }, () => new WikiProof(root).sign(value)));
  assert.equal(new Set(proofs).size, 1);
  await new WikiProof(root).verify(value, proofs[0]!);
  const keyPath = join(root, '.amem', 'wiki-proof-key');
  assert.equal((await readFile(keyPath)).length, 32);
  if (process.platform !== 'win32') assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(join(root, '.amem')), ['wiki-proof-key']);
});

test('independent processes initialize one key and a later process verifies the same result', async () => {
  const root = await freshRoot();
  const module = JSON.stringify(new URL('../src/wiki-proof.ts', import.meta.url).href);
  const value = JSON.stringify(result());
  const sign = `import { WikiProof } from ${module}; process.stdout.write(await new WikiProof(process.argv[1]).sign(JSON.parse(process.argv[2])));`;
  const processes = await Promise.all(Array.from({ length: 4 }, () => exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', sign, root, value])));
  const proofs = processes.map(({ stdout }) => stdout);
  assert.equal(new Set(proofs).size, 1);
  assert.match(proofs[0]!, /^[a-f0-9]{64}$/);
  const verify = `import { WikiProof } from ${module}; await new WikiProof(process.argv[1]).verify(JSON.parse(process.argv[2]), process.argv[3]);`;
  await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', verify, root, value, proofs[0]!]);
  assert.deepEqual(await readdir(join(root, '.amem')), ['wiki-proof-key']);
});

test('proofs are unique to vault-local keys and cannot move with copied canonical files', async () => {
  const [first, second] = await Promise.all([freshRoot(), freshRoot()]);
  const value = result();
  const proof = await new WikiProof(first).sign(value);
  await assert.rejects(new WikiProof(second).verify(value, proof), invalid);
  const secondProof = await new WikiProof(second).sign(value);
  assert.notEqual(secondProof, proof);
  await assert.rejects(new WikiProof(second).verify(value, proof), invalid);
});

test('symlinked operational storage, key and root fail without touching targets', { skip: process.platform === 'win32' }, async () => {
  const [root, outside, rootLink] = await Promise.all([freshRoot(), freshRoot(), freshRoot()]);
  const outsideKey = join(outside, 'secret-key');
  await writeFile(outsideKey, Buffer.alloc(32, 7), { mode: 0o600 });
  await symlink(outside, join(root, '.amem'));
  await assert.rejects(new WikiProof(root).sign(result()), invalid);
  await assert.rejects(new WikiProof(root).verify(result(), '0'.repeat(64)), invalid);
  assert.deepEqual(await readdir(outside), ['secret-key']);
  await rm(join(root, '.amem'));
  await mkdir(join(root, '.amem'));
  await symlink(outsideKey, join(root, '.amem', 'wiki-proof-key'));
  await assert.rejects(new WikiProof(root).sign(result()), invalid);
  await assert.rejects(new WikiProof(root).verify(result(), '0'.repeat(64)), invalid);
  assert.deepEqual(await readFile(outsideKey), Buffer.alloc(32, 7));
  await symlink(outside, join(rootLink, 'vault'));
  await assert.rejects(new WikiProof(join(rootLink, 'vault')).sign(result()), invalid);
  assert.equal(existsSync(join(outside, '.amem')), false);
});

test('malformed or permissive keys fail closed and never leak key bytes in errors', async () => {
  const root = await freshRoot();
  await mkdir(join(root, '.amem'));
  const path = join(root, '.amem', 'wiki-proof-key');
  const secret = 'private-key-must-never-be-shown';
  await writeFile(path, secret, { mode: 0o600 });
  await assert.rejects(new WikiProof(root).sign(result()), (error: unknown) => {
    assert.ok(error instanceof AgentMemoryError);
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.doesNotMatch(JSON.stringify(error.toJSON()), new RegExp(secret));
    return true;
  });
  assert.equal(await readFile(path, 'utf8'), secret);
  if (process.platform !== 'win32') {
    await writeFile(path, Buffer.alloc(32));
    await chmod(path, 0o644);
    await assert.rejects(new WikiProof(root).sign(result()), invalid);
    await assert.rejects(new WikiProof(root).verify(result(), '0'.repeat(64)), invalid);
  }
});

test('signing and verification leave canonical files and Git metadata unchanged', async () => {
  const root = await freshRoot();
  const files = ['wiki/topic.md', 'evidence/source.md', 'rules/purpose.md', '.git/HEAD', 'log.md', 'index.md'];
  for (const file of files) {
    const parts = file.split('/');
    if (parts.length > 1) await mkdir(join(root, parts[0]!), { recursive: true });
    await writeFile(join(root, file), `unchanged ${file}\n`);
  }
  const helper = new WikiProof(root);
  const proof = await helper.sign(result());
  await helper.verify(result(), proof);
  for (const file of files) assert.equal(await readFile(join(root, file), 'utf8'), `unchanged ${file}\n`);
  assert.deepEqual((await readdir(root)).sort(), ['.amem', '.git', 'evidence', 'index.md', 'log.md', 'rules', 'wiki']);
  assert.deepEqual(await readdir(join(root, '.amem')), ['wiki-proof-key']);
});

test('pre-cancelled signing and verification do not create files', async () => {
  const root = await freshRoot();
  for (const action of [() => new WikiProof(root).sign(result()), () => new WikiProof(root).verify(result(), '0'.repeat(64))]) {
    const controller = new AbortController();
    await assert.rejects(withOperation<unknown>(controller.signal, () => {
      controller.abort();
      return action();
    }), (error: unknown) => error instanceof AgentMemoryError && error.code === 'OPERATION_CANCELLED');
  }
  assert.deepEqual(await readdir(root), []);
});
