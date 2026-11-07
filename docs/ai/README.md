# carl-rpg AI reference (index)

purpose: Machine-oriented map of every built feature of the carl-rpg FoundryVTT v13 system: data models, rules, UI entry points, settings, APIs, conventions. Written for AI agents, not humans.
generated: 2026-11-04
source: branch carl-rpg @ d84882d. Read from module/ (data models, documents, helper headers, sheets), templates/, tests/, lang/en.json keys, and the plan doc 'Carl RPG for Foundry: Plan and Discussion Notes'. Code is truth: if this file and code disagree, trust code and fix this file.

## How to use
- Do not load everything. Open only the file(s) that answer the question.
- Code is the source of truth. If code and these files disagree, trust code and fix the file.
- When you change behaviour a file covers, update that file in the same commit.

## Notation
- paths: relative to repo root
- ids: values are code ids (enum keys, setting keys, flag keys). UI labels live in lang/en.json under CARL_RPG.*
- a|b: enum of ids
- x = y: derived, computed at prepare time, never stored
- (plan): taken from the plan doc, not re-read line by line in code
- NS: the flag/setting namespace 'carl-rpg'

## Status
- tests: npm test -> 401 rule tests pass (node --test, stubs in tests/stubs.mjs stand in for Foundry)
- foundryRun: NEVER run in Foundry. Every runtime behaviour below is verified only by code reading and stub tests. Playtesting is done by the user.
- openWork: system.json url/manifest/download/bugs are placeholders. Everything else in the plan is built or dropped.
- commits: 362

## Which file answers what
| file | sections | open it for |
|---|---|---|
| architecture.md | project, architecture | repo layout, entry point, document/sheet classes, data model map, GM-client relays, migration |
| constants.md | constants | enums and numbers from config.mjs: gear slots, phases, degrees, tiers, rest values, upgrade ladders |
| actors.md | actors | crawler, mob, pet, mount, lootPile fields, derived values, sheet tabs |
| items-effects.md | items, effects | every item type (fields, rules, sheet tabs), effect flags, modifiers, build benefits |
| events.md | events | triggers, conditions, actions, summons and minions (Summon action), trust/approval, library, floor rules |
| rules.md | rules | item use flow, checks/degrees, damage, typed bonus dice (damage parts), mob attacks, combat phases, dying, rests, leveling, upgrades, targeting |
| systems.md | systems | creation wizard, origins, loot boxes, mob loot, stores, quests, Dungeon Info, announcements, recap, journals, sources |
| ui.md | ui | style rules, filters, tooltips, quick bar, chat cards, sounds, tokens |
| settings-api-flags.md | settings, api, flags, visibility | setting keys, globals, hooks, chat commands, flag keys, who sees what |
| workflow-tests-quirks.md | workflow, tests, quirks | edit/verify/git rules, test layout, known bugs and gaps |
