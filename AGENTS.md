# Agent notes: carl-rpg

FoundryVTT v13 system for the Dungeon Crawler Carl TTRPG. Package id `carl-rpg`, branch `carl-rpg`.

Read `docs/ai-reference.json` first. It is a machine-oriented map of every built feature.
Top-level keys: `project`, `architecture`, `constants`, `actors`, `items`, `effects`, `events`,
`rules`, `systems`, `ui`, `settings`, `api`, `flags`, `visibility`, `tests`, `workflow`, `quirks`.

The code is the source of truth. If you change behaviour that the reference covers, update the
matching section and keep the file valid JSON:
`node -e "JSON.parse(require('fs').readFileSync('docs/ai-reference.json','utf8'))"`

Hard rules (full list under `workflow`):

- Never edit `build/`. Compiled `css/` is untracked output of `npm run build`.
- Every dialog uses `CarlRPGDialog` (`module/helpers/dialog.mjs`), never `DialogV2`.
- Players must never see mob numbers (Evade, DR, health values) except where the plan says so.
- After a change: `node --check` every `module/**/*.mjs`, parse `lang/en.json`, `npm test`, `npm run pack`.
- Commit as `Unofficial Carl RPG <unofficial-carl-rpg@users.noreply.github.com>`, one commit per
  feature or fix, never push, no co-author or Claude session lines.
