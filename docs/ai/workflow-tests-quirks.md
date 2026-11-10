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
- sessionStarter: claude/carl-rpg-session-starter.md (in the Claude project) is the paste-in prompt; its '98 rule tests' figure is stale (now 596).

# tests

- run: npm test (node tests/run.mjs: one node --test process per *.test.mjs, 596 pass)
- stubs: tests/stubs.mjs fakes Foundry globals (settings, Actor/Item shapes, i18n, Roll) so helpers import under plain Node. The Actor stub's getRollData returns its system, like Foundry's, so CarlRPGActor.prototype.getRollData can run on a stub actor (a crawler stub needs its data model's getRollData attached for the top-level stats, see health-roll-data.test.mjs)

## files
- action.test.mjs: item Action formulas
- ammo.test.mjs: ammunition matching, stacks, amounts
- amounts.test.mjs: amount evaluator, fillData, rangeInfo
- prerequisites.test.mjs: race/class prerequisites: any skill or spell by stat(s) or tag at a stored rank, species held, existing types unchanged, hidden-until-met (optionVisible), en.json labels for every type
- skill-list.test.mjs: #tag entries in Roll Modifier and Damage Effect skill lists
- area-upgrades.test.mjs: area shape/size upgrade changes (replace, extra shapes with their own size and keep, size add/replace, splashAdd, bad values, no upgrades)
- area-plan.test.mjs: splash distance by rank (Bad Faith, Earworm, Fear, Shotgun, Heal Others burst), areaSteps (Fireball circle and 80 ft line that keeps the blast), lasting area rounds by rank (Confusing Fog), a Count item's area version (Ice Blast cone, Lightning Bolt line, origin at the caster), singleTarget (Count mode and a count of 1)
- splash.test.mjs: distance to a circle/rectangle/polygon, the splash band, who is splash after several areas, splash around the chosen targets of a Count item
- buff-slots.test.mjs: stacking buff groups and slot counting
- percent-mods.test.mjs: percent modifiers: rounding down, totals read per actor type, settling rows (landing, edits, own old number), clearing on items, flat changes joining an actor effect once, the Cheese Grater / Wand / Hand Grips examples
- build-mods.test.mjs: build benefits, caps, health stat, Roll Modifier scope row tidying
- build-damage.test.mjs: Bonus damage dice and Damage stat build rows: saving them, which can be used, scopes (skill, tag, weapon rolling a skill), the melee and Surprise ticks, roll and per-target conditions, typed Ice parts, the stat swap and swapStat, Frost Maiden / Cat Girl / Rat Hooligan examples
- picks.test.mjs: player picks: filters and pools, granted-skills pick rows, Skill cap / rank bonus on picked skills, build row tidying, Stat splits (clamping, Enhanced value, redo once per floor), resetting
- class-combo.test.mjs: Race+Class combos
- combat.test.mjs: degrees, damage, phases, declarations
- costs.test.mjs: cost spans/labels
- cost-damage.test.mjs: damage formulas reading @cost (bare @cost, roll data, Magic Missile at each Mana choice and rank)
- damage-also-type.test.mjs: a second damage type (even split, odd point, untyped dice split with it, typed rows kept apart, resistances per part, with the multiplier, the upgrade at rank 10)
- damage-multiply.test.mjs: damageMultiply upgrade change (validity, rank unlock, the reference skills), roll/degree conditions, highest row wins, base vs total, typed parts resisted after multiplying, Roll Modifier rows
- damage-effects.test.mjs: Damage Effect rules per rank, per-target filters, damage maths, who can choose what, cooldowns
- damage-types.test.mjs: damage types and modes
- typed-bonus.test.mjs: bonus dice with their own damage type: row types, even split of mixed types, damage parts, resist/immune/vulnerable per part, DR after the sum, untyped rows unchanged
- delayed-damage.test.mjs: planning the action (@rankDamage, wait formula, bad amounts), the combat-flag queue, a hit event queuing for the target that was hit (no combat = warning), the round-end tick through applyDamage (DR, ignore DR, resist/immune/vulnerable, mobs, dead targets, a failing entry), the hit target group and the editor default
- distance.test.mjs: token distance (edge to edge squares, diagonals, big tokens, feet per square, no token), the Within N ft rows (validity, per-target multiplier, Roll Modifier dice and multiplier rows) and the distance event condition
- events.test.mjs: triggers, conditions, formulas over roll data (incl. @roll.margin/bonus/mod/rank, @damage.*, @rankDamage in amounts, a weapon's rolled skill), actions, trust, add-token, approval, target groups (targeted vs burst)
- event-roll.test.mjs: rollNumbers, marginOf, damageNumbers, damageOfTarget (the numbers a use hands to events)
- gear-slots.test.mjs: slot room, two-handed gear, what comes off when equipping
- item-badges.test.mjs: describeBadges builds for gear/skills with count or area targeting and a splash (regression: undefined `eff` stopped weapon skills opening)
- health-slots.test.mjs: Health Bar slots: the slot count modifier (1..100, clamped not rewritten), slot value rows from the top and bottom, damage slot by slot (even slots equal floor(net / perBox), Tough Guy Tattoo, uneven slots, overkill), Selfie Stick, crawler and mob derived slots, mob damage by CON mod
- health-roll-data.test.mjs: @health.value/.max/.lost in actor roll data (helpers/health-data.mjs: crawler, pet, mob, read live, never negative), a Bonus damage dice row with a formula and Rage as one (valid row, saved as typed, melee tick, scope, beside other rows, typed, switched off, mob)
- later-floor.test.mjs: later-floor starts
- popularity.test.mjs: old Popularity text dropped by Crawler.migrateData (also from the oldest hotlist layout), a popularity number kept; grantNumber (award, remove to a floor of 0, chat line, AI favor too, mobs and zero amounts ignored); the Popularity event action
- minions.test.mjs: Summon action: formulas of Second Chance, Clockwork Triplicate and Rise, Dead Minion! at their ranks, raised health, level limit, footprint, caster limit (replace oldest), copy count as a formula, round ticks and expiry, copies, raise/expire, player relay, combat sides, loot, minions group
- migration.test.mjs / migration-guards.test.mjs: load-time migration and migrateData guards
- progression.test.mjs: level up, advancement, origins, upgrades, skill cap
- rank-damage.test.mjs: @rankDamage table, rank bonus and row step, upgrade and effect sources, expansion, build row cleanup
- skill-rank.test.mjs: Skill rank bonus build rows: scopes (incl. By stat with its Skills/Spells menu, also for Skill cap), the minimum (floor on the total, stored rank 0, Boring Ol' Mage), row tidying, floor 0 and cap, effective rank through the real skill model (roll formula, upgrades, rank damage), unlock locks, @rank, Roll Modifier rank
- roll-mods.test.mjs: Roll Modifier rules per rank, conditions, skill lists and self, rank bonus, damage dice, held DR, Roll Modifier scope build rows (Aiming for ranged single-target ice spells, other crawlers and a switched off effect, Identifier match and unusable rows, the single-target tick and area casts, count formulas, entries by name/#tag/item tag, spells offered the modifiers whose list names them)
- recap.test.mjs: recap counting
- species.test.mjs: species
- summon.test.mjs: token placement cells
- survival.test.mjs: dying, rests, injuries, mana/health clamps

- notCovered: templates, sheets, ApplicationV2 rendering, hooks wiring, socket/relay flows, canvas. Those are verified only by static checks until a Foundry run.

# quirks

- id=hotbar-item-macro-broken; severity=bug; where=module/carl-rpg.mjs createDocMacro; detail=Macros created by dropping an owned item on the hotbar run game.carlrpg.rollItemMacro(uuid). Nothing sets game.carlrpg (the global is globalThis.carlrpg with rollItemMacro under .utils; game.carlRpg only has .macros). Those macros will throw. Fix: point the command at globalThis.carlrpg.utils.rollItemMacro or expose it on game.carlRpg.
- id=namespace-casing; severity=smell; detail=globalThis.carlrpg vs game.carlRpg. Pick one.
- id=never-run-in-foundry; severity=risk; detail=No code path has been executed in Foundry. Expect template/ApplicationV2/hook wiring bugs on first run; the stub tests only cover pure logic.
- id=manifest-placeholders; severity=open; detail=system.json url, manifest, download, bugs are placeholder text; packs and packFolders are empty arrays.
- id=stale-docs; severity=docs; detail=README.md Status mentions TODO placeholders in actor-crawler.mjs (none exist). CHANGELOG.md is the boilerplate's (1.2.0, Foundry v10). package.json author/description are boilerplate.
- id=boilerplate-leftovers; severity=cleanup; detail=lib/some-lib, example-foundry-config.yaml, src/generate-boilerplate-system.mjs, src/create-symlinks.mjs, documents/actor.mjs prepareDerivedData (reads flags.carlrpg, unused), Handlebars helper toLowerCase.
- id=compat-versions; severity=note; detail=system.json compatibility minimum/verified 13.339; local Foundry used for API checks is 13.351.
- id=hardcoded-english; severity=i18n; detail=A few warnings bypass lang/en.json: combat.mjs refillCombatActions ('Only the GM can refill actions.'), carl-rpg.mjs createDocMacro / rollItemMacro warnings.
- id=mob-loot-dead-export; severity=dead-code; detail=mob-loot.mjs giveMobLoot(mob, crawler) is not called from module code (pickCrawlerAndLoot -> makeMobPile only), so direct-to-crawler looting is unreachable from the UI.
- id=event-trust-on-edit; severity=note; detail=eventsTrusted is set only when a GM saves (_preCreate/_preUpdate); player-edited events on items they own cannot touch other actors or run GM macros until approved. Migration saves carry carlMigration and skip this.
- id=typed-dice-same-type-lost; severity=bug; where=helpers/damage-types.mjs damageParts + attacks.mjs (via damage-multiply.mjs targetDamage); detail=A typed bonus die whose type is the same as the attack's own damage type merges into the own-type part, so partsMatter is false and the per-target damage falls back to the untyped total, dropping the typed die's amount. Kept as it was by the damage multiplier work; not fixed. Bonus damage dice build rows (build-damage.mjs) meet it too when their type is the attack's own.
