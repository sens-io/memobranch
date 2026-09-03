import { appendFile, open, rm } from 'node:fs/promises';
import { withFileLock } from '../../src/utils.js';

async function main(): Promise<void> {
  const [lockPath, criticalPath, violationPath, startValue] = process.argv.slice(2);
  if (!lockPath || !criticalPath || !violationPath || !startValue) throw new Error('Missing lock worker arguments');
  const start = Number(startValue);
  while (Date.now() < start) await new Promise((resolve) => setTimeout(resolve, 1));
  await withFileLock(lockPath, async () => {
    let handle;
    try {
      handle = await open(criticalPath, 'wx');
    } catch {
      await appendFile(violationPath, `${process.pid}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
    if (handle) {
      await handle.close();
      await rm(criticalPath, { force: true });
    }
  }, 5_000);
}

void main();
