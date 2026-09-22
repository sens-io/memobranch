import { readFileSync } from 'node:fs';

/** Source and installed dist files both live one directory below package.json. */
export const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
