import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);

test('CLI returns stable JSON for version and invalid input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amem-cli-'));
  const base = ['--import', 'tsx', join(process.cwd(), 'src', 'cli.ts')];
  try {
    const version = await exec(process.execPath, [...base, 'version', '--json']);
    assert.deepEqual(JSON.parse(version.stdout), { version: '1.0.0' });
    const versionFlag = await exec(process.execPath, [...base, '--version']);
    assert.deepEqual(JSON.parse(versionFlag.stdout), { version: '1.0.0' });
    const initialized = await exec(process.execPath, [...base, 'init', root, '--json']);
    assert.equal((JSON.parse(initialized.stdout) as { created: boolean }).created, true);
    await assert.rejects(
      exec(process.execPath, [...base, 'propose', '--root', root, '--json']),
      (error: unknown) => {
        const failure = error as { code?: number; stderr?: string };
        assert.notEqual(failure.code, 0);
        const payload = JSON.parse(failure.stderr ?? '{}') as { error?: { code?: string } };
        return payload.error?.code === 'VALIDATION_FAILED';
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
