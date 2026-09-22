import assert from 'node:assert/strict';
import test from 'node:test';
import { release } from './release.mjs';

function fixture(overrides = {}) {
  const calls = [];
  const io = {
    run(command, args) {
      calls.push([command, ...args]);
      if (overrides.fail === args[0] || (overrides.fail === 'check' && args[1] === 'check')) throw new Error('gate failed');
      if (command === 'git') return args[0] === 'status' ? overrides.dirty ?? '' : 'abc';
      if (args[0] === 'whoami') return overrides.user ?? 'sens-io';
      if (args[0] === 'view') {
        if (args[2] === 'versions') return JSON.stringify(overrides.versions ?? ['1.0.0']);
        return JSON.stringify(args[2] === 'dist.integrity' ? overrides.remoteIntegrity ?? 'sha512-test' : '1.1.0');
      }
      if (args[0] === 'pack') return JSON.stringify([{name:'memobranch',version:'1.1.0',filename:'memobranch-1.1.0.tgz'}]);
      return '';
    },
    readJson: path => path === 'package.json' ? {name:'memobranch',version:overrides.version ?? '1.1.0'}
      : {version:'1.1.0',packages:{'':{version:'1.1.0'}}},
    temp: () => '/tmp/release-test',
    integrity: () => 'sha512-test',
    cleanup: () => calls.push(['cleanup']),
    log: () => {},
  };
  return {io,calls};
}

test('release defaults to dry-run and verifies the exact artifact before publication', () => {
  const {io,calls} = fixture();
  release([],io);
  const publish = calls.find(c => c[1] === 'publish');
  assert.ok(publish.includes('--dry-run'));
  assert.ok(publish.includes('--ignore-scripts'));
  assert.equal(publish[2], calls.find(c => c[2] === 'test:package')[4]);
  assert.ok(calls.findIndex(c => c[2] === 'test:package') < calls.indexOf(publish));
  assert.equal(calls.at(-1)[0], 'cleanup');
});

test('explicit publication verifies registry integrity and latest tag', () => {
  const {io,calls} = fixture();
  release(['--publish'],io);
  assert.ok(!calls.find(c => c[1] === 'publish').includes('--dry-run'));
  assert.ok(calls.some(c => c[3] === 'dist.integrity'));
  assert.ok(calls.some(c => c[3] === 'dist-tags.latest'));
});

for (const [name, options] of Object.entries({
  dirty:{dirty:' M README.md'}, duplicate:{versions:['1.0.0','1.1.0']},
  downgrade:{versions:['2.0.0']}, prerelease:{version:'1.1.0-rc.1'},
  wrongIdentity:{user:'someone-else'}, registryFailure:{fail:'view'},
  failedTests:{fail:'check'}, failedAudit:{fail:'audit'}, failedPack:{fail:'pack'},
})) {
  test(`release refuses ${name} before upload`, () => {
    const {io,calls} = fixture(options);
    assert.throws(() => release(['--publish'],io));
    assert.ok(!calls.some(c => c[1] === 'publish'));
  });
}

test('publish failures are not retried and temporary artifact is cleaned', () => {
  const {io,calls} = fixture({fail:'publish'});
  assert.throws(() => release(['--publish'],io));
  assert.equal(calls.filter(c => c[1] === 'publish').length,1);
  assert.equal(calls.at(-1)[0],'cleanup');
});

test('registry integrity mismatch is not reported as success', () => {
  const {io} = fixture({remoteIntegrity:'sha512-other'});
  assert.throws(() => release(['--publish'],io), /registry verification failed/);
});

test('unknown or conflicting options are refused before any action', () => {
  for (const args of [['--skip-tests'],['--publish','--dry-run']]) {
    const {io,calls} = fixture();
    assert.throws(() => release(args,io),/Usage/);
    assert.equal(calls.length,0);
  }
});
