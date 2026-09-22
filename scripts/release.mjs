import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = '--registry=https://registry.npmjs.org';

export function release(args, io) {
  if (args.length > 1 || args.some(arg => !['--publish', '--dry-run'].includes(arg))) {
    throw new Error('Usage: npm run release -- [--dry-run|--publish]');
  }
  const publish = args[0] === '--publish';
  const run = io.run;
  const clean = () => {
    if (run('git', ['status', '--porcelain', '--untracked-files=all'], true).trim()) {
      throw new Error('Commit or stash all changes before release.');
    }
  };
  clean();
  const head = run('git', ['rev-parse', 'HEAD'], true).trim();
  const pkg = io.readJson('package.json');
  const lock = io.readJson('package-lock.json');
  if (pkg.name !== 'memobranch' || !semver.valid(pkg.version) || semver.prerelease(pkg.version)
      || pkg.private || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) {
    throw new Error('Expected a stable memobranch version matching package-lock.json.');
  }
  const versions = JSON.parse(run('npm', ['view', pkg.name, 'versions', '--json', registry], true));
  if (!Array.isArray(versions) || versions.some(v => !semver.valid(v))
      || versions.some(v => !semver.prerelease(v) && semver.gte(v, pkg.version))
      || versions.includes(pkg.version)) {
    throw new Error('Version must be unpublished and newer than every stable registry version.');
  }
  if (publish && run('npm', ['whoami', registry], true).trim() !== 'sens-io') {
    throw new Error('Log in to npm as sens-io before publishing.');
  }
  run('npm', ['ci']);
  run('npm', ['run', 'check']);
  run('npm', ['audit', '--omit=dev', registry]);
  run('npm', ['exec', '--yes', '--package=@fission-ai/openspec@1.0.2', '--', 'openspec', 'validate', '--all', '--strict']);
  const temporary = io.temp();
  try {
    const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], true));
    if (packed.name !== pkg.name || packed.version !== pkg.version || packed.filename !== `${pkg.name}-${pkg.version}.tgz`) {
      throw new Error('Unexpected packed artifact.');
    }
    const artifact = join(temporary, packed.filename);
    const integrity = io.integrity(artifact);
    run('npm', ['run', 'test:package', '--', artifact]);
    clean();
    if (run('git', ['rev-parse', 'HEAD'], true).trim() !== head || io.integrity(artifact) !== integrity) {
      throw new Error('Source or artifact changed during validation.');
    }
    // Never retry an ambiguous publication automatically; npm versions are immutable.
    run('npm', ['publish', artifact, '--access=public', '--tag=latest', '--ignore-scripts', registry,
      ...(publish ? [] : ['--dry-run'])]);
    if (publish) {
      const remote = JSON.parse(run('npm', ['view', `${pkg.name}@${pkg.version}`, 'dist.integrity', '--json', registry], true));
      const latest = JSON.parse(run('npm', ['view', pkg.name, 'dist-tags.latest', '--json', registry], true));
      if (remote !== integrity || latest !== pkg.version) {
        throw new Error('Publish may have succeeded, but registry verification failed. Inspect npm before retrying.');
      }
    }
    io.log(`${publish ? 'Published and verified' : 'Dry run passed (nothing published)'}: ${pkg.name}@${pkg.version}`);
  } finally {
    io.cleanup(temporary);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    release(process.argv.slice(2), {
      run(command, args, capture = false) {
        const executable = command === 'npm' && process.env.npm_execpath ? process.execPath : command;
        const argv = executable === process.execPath ? [process.env.npm_execpath, ...args] : args;
        const result = spawnSync(executable, argv, { cwd: root, encoding: 'utf8',
          stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
          env: { ...process.env, OPENSPEC_TELEMETRY: '0' }, maxBuffer: 16 * 1024 * 1024 });
        if (result.error || result.status !== 0) {
          throw new Error(`${command} ${args[0]} failed. If this was publish, check npm before retrying.`, { cause: result.error });
        }
        return result.stdout ?? '';
      },
      readJson: file => JSON.parse(readFileSync(join(root, file), 'utf8')),
      temp: () => mkdtempSync(join(tmpdir(), 'memobranch-release-')),
      integrity: file => `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`,
      cleanup: directory => rmSync(directory, { recursive: true, force: true }),
      log: console.log,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
