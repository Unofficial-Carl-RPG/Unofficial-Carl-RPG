// Packs the system into build/<system id>/, ready to copy into Foundry's
// Data/systems folder. Run with `npm run pack` (which compiles the CSS first).
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'system.json'), 'utf8'));
const out = join(root, 'build', manifest.id);

// What ships with the system.
const DIRS = ['module', 'css', 'lang', 'templates', 'assets', 'packs'];
const FILES = ['system.json', 'README.md', 'LICENSE.txt', 'CHANGELOG.md'];

// Start from a clean output folder so removed files don't linger.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const dir of DIRS) {
  const src = join(root, dir);
  if (!existsSync(src)) continue;
  // Source maps point at SCSS that isn't packed, so leave them out.
  cpSync(src, join(out, dir), {
    recursive: true,
    filter: (path) => !path.endsWith('.map'),
  });
}
for (const file of FILES) {
  const src = join(root, file);
  if (existsSync(src)) cpSync(src, join(out, file));
}

// Make sure everything system.json points at made it into the package.
const referenced = [
  ...(manifest.esmodules ?? []),
  ...(manifest.styles ?? []),
  ...(manifest.languages ?? []).map((l) => l.path),
];
const missing = referenced.filter((p) => !existsSync(join(out, p)));
if (missing.length) {
  console.error(`pack: missing files referenced by system.json: ${missing.join(', ')}`);
  process.exit(1);
}

// Summary
let count = 0;
let bytes = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      count++;
      bytes += statSync(full).size;
    }
  }
};
walk(out);
console.log(`Packed ${manifest.id} into build/${manifest.id} (${count} files, ${(bytes / 1024).toFixed(0)} KB)`);
