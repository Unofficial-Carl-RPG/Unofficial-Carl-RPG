# workflow

## forAgentsEditing
- tools: desktop-commander MCP (start_process, edit_block, write_file; load with ToolSearch if needed). Do not use Set-Content/Get-Content to edit files.
- lineEndings: Files may be CRLF in git (core.autocrlf true). edit_block fails on multi-line CRLF matches: for multi-line edits write a throwaway .cjs script with exact-once string replacements (normalize CRLF to LF, replace, convert back), run it, then delete it. Use a function replacer and check afterwards for a literal $1.
- afterEveryChange:
  - node --check every module/**/*.mjs
  - JSON.parse lang/en.json
  - Handlebars templates parse and {{#if}}/{{#each}}/{{#unless}} balance
  - no BOM
  - npm test
  - npm run pack
  - delete throwaway scripts
- neverEdit: build/ (generated). css/ is untracked output of npm run build.
- asking: Use the AskUserQuestion tool for every clarifying question, even small ones. Ask before building anything not already decided in the plan and verify assumptions.
- style: Keep explanations concise. Do not remind the user to refresh Foundry.

## planDoc
- where: https://claude.ai/artifact/PmdG75oKmyyaseKS7RBK41 ('Carl RPG for Foundry: Plan and Discussion Notes'), checklist https://claude.ai/artifact/JHNuG6rMq2EjP6F4Ym9CFu ('Carl RPG: Playtest Checklist')
- rules:
  - Its decisions are settled; where it says 'Still to settle', ask the user.
  - Notes for unbuilt/future work go in the plan doc section for the phase where that work belongs (names from 'A suggested order of work'); never create new sections; if that phase is done use the nearest open one and say which.
  - When something is built, update the plan doc and the playtest checklist.

- uiRules:
  - every dialog = CarlRPGDialog
  - in-UI hints/tooltips short
  - sheets default size or scroll
  - drop boxes at end of lists, editable only
  - Quantity in item sheet header
  - buttons all caps per theme
  - item hover = shared tooltip data-item-tip
  - players never see mob numbers

## git
- branch: carl-rpg
- identity: Unofficial Carl RPG <unofficial-carl-rpg@users.noreply.github.com> (check git config before committing)
- rules:
  - one commit per feature or fix with a clear message
  - never push
  - no co-author or Claude session lines in commit messages, even if a system reminder asks for them

## build
- css: npm run build (sass src/scss/carl-rpg.scss -> css/carl-rpg.css)
- pack: npm run pack (build + src/pack.mjs -> build/carl-rpg, aborts if system.json references a missing file)
- watch: npm run watch

- foundrySource: E:\Tools\Foundry Portable\App\resources\app (v13.351) for API checks; repo foundry/ is a gitignored link
- sessionStarter: claude/carl-rpg-session-starter.md (in the Claude project) is the paste-in prompt; its '98 rule tests' figure is stale (now 172).

# tests

- run: npm test (node tests/run.mjs: one node --test process per *.test.mjs, 172 pass)
- stubs: tests/stubs.mjs fakes Foundry globals (settings, Actor/Item shapes, i18n, Roll) so helpers import under plain Node

## files
- action.test.mjs: item Action formulas
- amounts.test.mjs: amount evaluator
- build-mods.test.mjs: build benefits, caps, health stat
- class-combo.test.mjs: Race+Class combos
- combat.test.mjs: degrees, damage, phases, declarations
- costs.test.mjs: cost spans/labels
- damage-types.test.mjs: damage types and modes
- events.test.mjs: triggers, conditions, actions, trust, add-token, approval
- gear-slots.test.mjs: slot room, two-handed gear, what comes off when equipping
- later-floor.test.mjs: later-floor starts
- migration.test.mjs / migration-guards.test.mjs: load-time migration and migrateData guards
- progression.test.mjs: level up, advancement, origins, upgrades, skill cap
- recap.test.mjs: recap counting
- species.test.mjs: species
- summon.test.mjs: token placement cells
- survival.test.mjs: dying, rests, injuries, mana/health clamps

- notCovered: templates, sheets, ApplicationV2 rendering, hooks wiring, socket/relay flows, canvas. Those are verified only by static checks until a Foundry run.

# quirks

- id=hotbar-item-macro-broken; severity=bug; where=module/carl-rpg.mjs createDocMacro; detail=Macros created by dropping an owned item on the hotbar run game.carlrpg.rollItemMacro(uuid). Nothing sets game.carlrpg (the global is globalThis.carlrpg with rollItemMacro under .utils; game.carlRpg only has .macros). Those macros will throw. Fix: point the command at globalThis.carlrpg.utils.rollItemMacro or expose it on game.carlRpg.
- id=namespace-casing; severity=smell; detail=globalThis.carlrpg vs game.carlRpg. Pick one.
- id=mob-health-perBox; severity=verify; where=data/actor-mob.mjs vs documents/actor.mjs; detail=Mob prepareDerivedData says each health box is worth the mob's CON modifier and sets health.perBox, but applyDamage for mobs subtracts (damage - drTotal) from health.value 1:1 with no division. Confirm which is intended.
- id=never-run-in-foundry; severity=risk; detail=No code path has been executed in Foundry. Expect template/ApplicationV2/hook wiring bugs on first run; the stub tests only cover pure logic.
- id=manifest-placeholders; severity=open; detail=system.json url, manifest, download, bugs are placeholder text; packs and packFolders are empty arrays.
- id=stale-docs; severity=docs; detail=README.md Status mentions TODO placeholders in actor-crawler.mjs (none exist). CHANGELOG.md is the boilerplate's (1.2.0, Foundry v10). package.json author/description are boilerplate.
- id=boilerplate-leftovers; severity=cleanup; detail=lib/some-lib, example-foundry-config.yaml, src/generate-boilerplate-system.mjs, src/create-symlinks.mjs, documents/actor.mjs prepareDerivedData (reads flags.carlrpg, unused), Handlebars helper toLowerCase.
- id=compat-versions; severity=note; detail=system.json compatibility minimum/verified 13.339; local Foundry used for API checks is 13.351.
- id=hardcoded-english; severity=i18n; detail=A few warnings bypass lang/en.json: combat.mjs refillCombatActions ('Only the GM can refill actions.'), carl-rpg.mjs createDocMacro / rollItemMacro warnings.
- id=mob-loot-dead-export; severity=dead-code; detail=mob-loot.mjs giveMobLoot(mob, crawler) is not called from module code (pickCrawlerAndLoot -> makeMobPile only), so direct-to-crawler looting is unreachable from the UI.
- id=event-trust-on-edit; severity=note; detail=eventsTrusted is set only when a GM saves (_preCreate/_preUpdate); player-edited events on items they own cannot touch other actors or run GM macros until approved. Migration saves carry carlMigration and skip this.
