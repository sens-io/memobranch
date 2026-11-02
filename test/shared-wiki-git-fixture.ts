import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { TestContext } from 'node:test';
import type { Sensitivity } from '../src/types.js';
import { SharedWikiReader } from '../src/shared-wiki.js';
import { sharedFixture } from './shared-wiki-fixture.js';

const exec = promisify(execFile);
export async function gitFixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  const data = await sharedFixture(t, sensitivity), remote = join(data.caller.root, '.amem', 'synthetic-remote.git');
  await exec('git', ['init', '--bare', '--template=', remote], { env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } });
  // Only this disposable fixture receives a push. Application sharing is read-only.
  const publish = (ref = 'HEAD') => data.source.git.run(['push', '--force', remote, `${ref}:refs/heads/published`]);
  await publish();
  const { root: _root, ...common } = data.binding;
  const binding = { ...common, transport: 'git' as const, remote, branch: 'published', allowLocalFile: true,
    timeoutMs: 30_000, maxCacheBytes: 536_870_912 };
  const saveBindings = (sources: unknown[] = [binding]) => writeFile(data.configPath, JSON.stringify({ version: 2, sources }));
  await saveBindings();
  const reader = new SharedWikiReader(data.caller, { configPath: data.configPath, env: data.env });
  const slot = join(data.caller.root, '.amem', 'shared-cache', binding.id), cache = join(slot, 'vault');
  const provisionKeys = async () => {
    // Establish ownership through a real refresh before host-only key provisioning.
    await reader.snapshot({ ...data.input, expectedCommit: binding.commit }).catch(error => {
      if (error.code !== 'ENCRYPTION_KEY_UNAVAILABLE') throw error;
    });
    const { readFile } = await import('node:fs/promises');
    await mkdir(join(cache, '.amem'), { recursive: true });
    await writeFile(join(cache, '.amem', 'keys.json'), await readFile(join(data.source.root, '.amem', 'keys.json')), { mode: 0o600 });
  };
  return { ...data, binding, saveBindings, reader, remote, publish, slot, cache, provisionKeys,
    input: { ...data.input, expectedCommit: binding.commit } };
}
