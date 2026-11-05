# Agent notes: carl-rpg

FoundryVTT v13 system for the Dungeon Crawler Carl TTRPG. Package id `carl-rpg`, branch `carl-rpg`.

Read `docs/ai/README.md` first. It is the index of a machine-oriented reference of every built
feature, split into small files. Load only the file that answers your question:

- `architecture.md`: layout, entry point, classes, data model map, GM-client relays
- `constants.md`: enums and numbers from `config.mjs`
- `actors.md`: crawler, mob, pet, mount, loot pile
- `items-effects.md`: every item type, effect flags and modifiers
- `events.md`: triggers, conditions, actions, trust
- `rules.md`: use flow, checks, damage, combat, dying, rests, upgrades, targeting
- `systems.md`: creation, origins, loot, stores, quests, Dungeon Info, recap, journals
- `ui.md`: style rules, filters, tooltips, quick bar, chat cards
- `settings-api-flags.md`: settings, globals, hooks, commands, flags, visibility
- `workflow-tests-quirks.md`: edit/verify/git rules, tests, known bugs

The code is the source of truth. If you change behaviour a file covers, update that file in the
same commit.

Hard rules (full list in `workflow-tests-quirks.md`):

- Never edit `build/`. Compiled `css/` is untracked output of `npm run build`.
- Every dialog uses `CarlRPGDialog` (`module/helpers/dialog.mjs`), never `DialogV2`.
- Players must never see mob numbers (Evade, DR, health values) except where the plan says so.
- After a change: `node --check` every `module/**/*.mjs`, parse `lang/en.json`, `npm test`, `npm run pack`.
- Commit as `Unofficial Carl RPG <unofficial-carl-rpg@users.noreply.github.com>`, one commit per
  feature or fix, never push, no co-author or Claude session lines.
