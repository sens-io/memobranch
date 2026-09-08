const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [mode, root] = process.argv.slice(2);
if (mode === 'child') {
  process.on('SIGTERM', () => {});
  writeFileSync(join(root, 'helper.pid'), String(process.pid));
  // Closing inherited pipes must not allow this helper to outlive its Git call.
  setTimeout(() => writeFileSync(join(root, 'late-write'), 'orphaned helper mutated state'), 700);
  setInterval(() => {}, 1_000);
} else {
  writeFileSync(join(root, 'prompt-setting'), process.env.GIT_TERMINAL_PROMPT ?? 'unset');
  spawn(process.execPath, [__filename, 'child', root], { stdio: 'ignore' });
  setInterval(() => {}, 1_000);
}
