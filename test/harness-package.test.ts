import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import semver from 'semver';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('Harness peer ranges accept the SDK versions pinned for integration tests', () => {
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools']) {
    const range = packageJson.peerDependencies[name];
    const version = packageLock.packages[`node_modules/${name}`].version;
    assert.ok(semver.satisfies(version, range), `${name}@${version} must satisfy ${range}`);
    assert.equal(packageLock.packages[''].peerDependencies[name], range);
    assert.equal(packageJson.peerDependenciesMeta[name].optional, true);
    assert.equal(packageLock.packages[''].peerDependenciesMeta[name].optional, true);
  }
});

test('dsh-tools compatibility includes the tested prerelease and excludes unsupported lines', () => {
  const range = packageJson.peerDependencies['@deepseek-ai/dsh-tools'];
  for (const version of ['0.1.2-rc.1', '0.1.2-rc.2', '0.1.2', '0.1.3']) {
    assert.ok(semver.satisfies(version, range), `${range} must accept ${version}`);
  }
  for (const version of ['0.0.1-rc.1', '0.0.1', '0.1.1', '0.2.0-rc.1', '0.2.0']) {
    assert.equal(semver.satisfies(version, range), false, `${range} must reject ${version}`);
  }
});
