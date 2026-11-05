# project

- id: carl-rpg
- title: Carl RPG
- what: Unofficial FoundryVTT system for the Dungeon Crawler Carl TTRPG (Renegade Game Studios). Built from asacolips boilerplate-system, then renamed.
- version: 0.1.0

## foundry
- minimum: 13.339
- verified: 13.339
- localCoreForApiChecks: E:\Tools\Foundry Portable\App\resources\app (13.351)

## manifest
- esmodules: module/carl-rpg.mjs
- styles: css/carl-rpg.css
- languages: lang/en.json
- packs: 
- socket: true
- primaryTokenAttribute: health
- secondaryTokenAttribute: mana
- grid: type 1, 5 ft

- actorTypes: crawler, mob, pet, mount, lootPile
- itemTypes: skill, spell, gear, item, mobAbility, lootBox, store, quest, achievement, race, class, subclass, species, background, sponsor, personalSpace, club, deity
- journalPageTypes: carlSystemMessage
- repo: C:\Users\cawil\Git\Foundry Development\boilerplate

## layout
- module/: all code; entry module/carl-rpg.mjs
- module/data/: TypeDataModels + shared field builders (action, costs, upgrade-field, base-item eventsField)
- module/documents/: Actor, Item, Combat, Combatant, ActiveEffect subclasses
- module/helpers/: rule logic and registerX() feature modules (about 80 files)
- module/sheets/: ApplicationV2 sheets and windows
- module/canvas/token.mjs: CarlRPGToken (nameplate: crawler number, skulls, boss stars)
- templates/: Handlebars: actor/, item/ (+attribute-parts/), creation/, effect/, journal/, settings/, sidebar/
- lang/en.json: all strings, CARL_RPG.* keys
- src/scss/: SCSS source. npm run build -> css/carl-rpg.css (css/ is gitignored)
- src/pack.mjs: npm run pack -> build/carl-rpg (ships module css lang templates assets packs + system.json README LICENSE CHANGELOG). Never edit build/.
- tests/: *.test.mjs + stubs.mjs + run.mjs
- docs/ai/: this AI reference (README.md is the index); AGENTS.md at repo root points to it
- packs-source/carl-rpg-macros.json: ready-made macros to import into a compendium (not built into a pack)

# architecture

## entry
- file: module/carl-rpg.mjs
- init: sets CONFIG.CARL_RPG, installs fromUuid wrapper (gm-docs), preloads partials, calls every registerX(), sets document classes, data models, sheets, sidebar tab, combat config (no initiative), registers client/world settings and menus
- ready: runMigration(), registerGMDocs(), registerPartySocket(), hotbarDrop hook

- pattern: helpers/<feature>.mjs export pure rule functions plus registerX() called once in init. Rule logic is kept free of Foundry globals where possible so tests/ can import it with stubs.

## documentClasses
- CarlRPGActor: module/documents/actor.mjs. applyDamage(), addGold(), spendGold(), _preCreate marks new empty crawler creationPending, mob tokens show bars, pet tokens linked+friendly, _onUpdate: 0 health -> startDying/defeatMob, >0 -> cancelDying, pet owner change grants owner permission
- CarlRPGItem: module/documents/item.mjs (~1370 lines). roll() use flow, toggleEquipped(), syncEquipEffects(), _preCreate guards (background never on actors, pets only gear/skill/spell, race/class floor+prereq rules, subclass rules, achievement duplicates), grant skills/effects on create, release on delete, costData()/costSpans()
- CarlRPGCombat: module/documents/combat.mjs. phase flag, nextTurn=next phase, resetActions(), refillCombatActions()
- CarlRPGCombatant: module/documents/combatant.mjs. maxActions, actionsLeft, spendAction(), restoreAction(), buyAction()
- CarlRPGActiveEffect: module/documents/active-effect.mjs. kind/stack/duration/equip-link/lock-by-rank, setActive() with buff swap prompt, changeStacks(), removeAllStacks()
- CarlRPGToken: module/canvas/token.mjs
- CarlRPGActorDirectory: helpers/crawler-summary.mjs; adds Crawler Summary to right-click menu

## sheets
- actor: CarlRPGActorSheet module/sheets/actor-sheet.mjs + mixins actor-sheet-{drops,effects,personal,progression,quests-loot,upgrades}.mjs; 680x760 resizable; one sheet for crawler|mob|pet|mount; lootPile uses CarlRPGLootPileSheet
- item: CarlRPGItemSheet module/sheets/item-sheet.mjs + mixins item-sheet-{costs,drops,effects,events,skills,store-quest-loot,tags,upgrades}.mjs
- effect: CarlRPGEffectSheet (DocumentSheetV2) 500px
- windows:
  - CarlRPGGMTab (sidebar tab carlGM, 'Dungeon Info')
  - CarlRPGCreationWizard
  - CarlRPGCreationSettings
  - CarlRPGSourcesSettings
  - encounter-builder
  - floor-rules
  - store window (helpers/store.mjs)
  - loot pile sheet
  - CarlRPGSystemMessageSheet (journal page)
- stack: ApplicationV2 + HandlebarsApplicationMixin. AppV1 sheet classes are only unregistered.

- dialogs: Every dialog uses CarlRPGDialog (module/helpers/dialog.mjs: prompt, confirm, wait). Never DialogV2 directly.

## gmClientDelegation
- why: Players cannot edit world settings, journals, other actors, or store stock.
- mechanisms:
  - helpers/relay.mjs updateWithRelay(doc, changes): Observer's automatic changes (mana, 1 AI Favor on reroll, item uses.spent+1, combatant actionsSpent) sent as whispered ChatMessage flag updateRelay; active GM client validates (requester >= Observer, whitelisted field, bounds) then applies and deletes the message
  - Whisper-flag relays (GM client acts, deletes message): eventRelay, libraryRelay, lootRequest/lootResponse, mobCheckRelay, pileRelay, storeBuy, storeOpen, storeSell
  - Socket 'system.carl-rpg': {type:'party'} (leader renames party/sets titles; GM client verifies leader), {type:'request'|'response'} (gm-docs: player asks GM client for compendium items they cannot open)
  - Event trust: system.eventsTrusted (items, pets) or flags.carl-rpg.eventsTrusted (effects) set true only when a GM saves. Untrusted events cannot change actors the user does not own or run GM-side macros until a GM approves (Dungeon Info > events to approve, or Approve button on the sheet).

## dataModelMap
- crawler: data/actor-crawler.mjs
- mob: data/actor-mob.mjs
- pet: data/actor-pet.mjs (extends crawler)
- mount: data/actor-mount.mjs
- lootPile: data/actor-loot-pile.mjs
- skill: data/item-feature.mjs
- spell: data/item-spell.mjs (extends feature)
- gear: data/item-gear.mjs
- item: data/item-generic.mjs
- mobAbility: data/item-mob-ability.mjs
- lootBox: data/item-loot-box.mjs
- achievement: data/item-achievement.mjs
- race|class|subclass: data/item-origin.mjs
- species: data/item-species.mjs
- background: data/item-background.mjs
- sponsor: data/item-sponsor.mjs
- personalSpace: data/item-personal-space.mjs
- club: data/item-club.mjs
- deity: data/item-deity.mjs
- store: data/item-store.mjs
- quest: data/item-quest.mjs
- carlSystemMessage: data/page-system-message.mjs
- shared: data/base-actor.mjs, data/base-item.mjs (eventsField), data/action.mjs, data/costs.mjs, data/upgrade-field.mjs

- migration: helpers/migration.mjs: system.json version vs world setting migratedVersion. On newer version the active GM client re-saves every world actor/item (fills new fields) then runs STEPS newer than stored (STEPS=[{0.1.0: migrateClassTags}]). Saves carry option carlMigration so hooks skip side effects. Failure leaves version unrecorded (retry next load). Data models also self-heal via migrateData (old size text, hotlist->background, kills->killLog, embeddedSkill->skills, check type->target, manaCost->costs, roll->action, numeric targeting->string).
