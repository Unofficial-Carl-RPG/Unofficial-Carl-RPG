// Runs every rule check in this folder: `npm test`. Each file runs in its own
// process, so the stand-ins for Foundry's globals (see stubs.mjs) never leak
// from one file to the next.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => join(here, f));

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
