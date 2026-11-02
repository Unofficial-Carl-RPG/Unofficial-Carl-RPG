// Runs every rule check in this folder: `npm test`.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const file of readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(join(here, file)).href);
}
