const { spawn } = require('node:child_process');
const { existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [mode, root] = process.argv.slice(2);
if (mode === 'child') {
  process.on('SIGTERM', () => {});
  writeFileSync(join(root, 'helper.pid'), String(process.pid));
  setTimeout(() => writeFileSync(join(root, 'late-write'), 'helper outlived completed push'), 3_000);
  setInterval(() => {}, 1_000);
} else {
  // The Git shim exits successfully, but this descendant retains its pipes.
  spawn(process.execPath, [__filename, 'child', root], { stdio: 'inherit' });
  setInterval(() => {
    if (existsSync(join(root, 'helper.pid'))) process.exit(0);
  }, 5);
}
