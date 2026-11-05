# settings

- note: Namespace carl-rpg. visible = config:true (shows in Configure Settings). Menus are buttons in system settings.
- world:
  - key=floor; type=int>=0; default=1; visible=false; use=global Floor; onChange re-prepares all actors
  - key=floorState; type=exploring|safe; default=exploring; visible=false
  - key=daysLeft; type=int|null; default=null; visible=false
  - key=floorNotes; type=[{floor|null, text}]; default=; visible=false
  - key=floorRules; type=[event]; default=; visible=false
  - key=encounterTables; type=[{floor|null, uuid}]; default=; visible=false
  - key=autoStartCombat; type=bool; default=false; visible=true; use=placing mobs with no combat starts one
  - key=restsOutsideSafeRoom; type=bool; default=false; visible=true
  - key=lootOutsideSafeRoom; type=bool; default=false; visible=true
  - key=lootApproval; type=bool; default=false; visible=true
  - key=lootPerBoxOpen; type=bool; default=false; visible=true; use=allow opening individual boxes
  - key=playersCanLevel; type=bool; default=false; visible=true
  - key=hotlistOnlySpells; type=bool; default=false; visible=true
  - key=speciesInCreation; type=bool; default=false; visible=true
  - key=damageTypes; type=string (comma list); default=Physical, Fire, Cold, Lightning, Poison, Acid, Necrotic, Psychic; visible=true
  - key=sponsorLimit; type=number; default=3; visible=true; use=-1 unlimited
  - key=subclassFloor; type=number; default=6; visible=true
  - key=journalStyle; type=bool; default=true; visible=true
  - key=eventLibraryJournal; type=journal id; default=; visible=true
  - key=recapLogId; type=journal id; default=; visible=true; use=blank = Recap Log journal created/used by name
  - key=creationDefaults; type=SchemaField; visible=false; use=edited by menu creationSetup
  - {"key":"compendiumSources","type":"object","default":{},"visible":false,"use":"edited by menu compendiumSources"}
  - key=partyName / partyLeader / partyTitles; type=string / actor id / {actorId: title}; visible=false
  - key=migratedVersion; type=string; default=; visible=false
  - key=soundBoss, soundNatural, soundDying, soundAchievement, soundLoot; type=audio file path; default=; visible=true
- client:
  - key=chatLogStyle; type=bool; default=true; use=adds body class carl-chat-log
  - key=uiStyle; type=bool; default=true; use=adds body class carl-ui
  - key=holdResultCards; type=bool; default=true
  - key=soundVolume; type=int 0..100; default=100
  - key=soundMuted; type=bool; default=false
- menus: compendiumSources (CarlRPGSourcesSettings), creationSetup (CarlRPGCreationSettings), validateWorld (Validate World Items, last)
- keybindings: quickBar1..quickBar10 on Digit1..Digit9, Digit0 (rebindable)

# api

## globals
- globalThis.carlrpg: {documents:{CarlRPGActor, CarlRPGItem}, applications:{CarlRPGActorSheet, CarlRPGItemSheet}, utils:{rollItemMacro(uuid), refillActions(combat?)}, models}
- game.carlRpg.macros: rest(kind 'short'|'long'|'full') -> confirmRest; levelUp(); advance() (asks which advanceable skill). All act on the selected token's crawler, else the user's character, else the first owned crawler.
- CONFIG.CARL_RPG: all constants; CONFIG.CARL_RPG.getFloor()
- caution: two namespaces with different casing (carlrpg vs carlRpg); see quirks

- hooks:
  - carlrpg.cleanupPhase (combat) fires once on the GM client when Cleanup starts
  - carlrpg.levelUp (actor, newLevel)

## chatCommands
- /rest <Crawler|self|all> short|long|full: owner or GM; all = GM only; keeps safe-room rules
- /floor N: GM
- /days N: GM
- /aifavor <Crawler> <amount>: GM; minus takes away; floor 0; posts card
- /announce <kind> <text>: GM; kinds boss|stairs|floor|general (not died)
- /group <stat|skill=Name> dc=<n|floor|unopposed> [all|most|atLeast=N]: GM
- note: Read in the chatMessage hook; nothing posts as the command itself.

- hotbar: Dropping an owned Item on the hotbar creates a script macro (flag carl-rpg.itemMacro) -> see quirks (broken call). Dragging a sheet's Rest / Level Up button makes macros calling game.carlRpg.macros.

## keyFunctions
- actor.applyDamage(amount, {ignoreDR, damageType}): documents/actor.mjs
- actor.addGold / spendGold: only gold entry points (loot, shops, events)
- item.roll(event, {depth, declared}): the one use path; events/macros call it with depth+1
- item.toggleEquipped(equipped): 
- combatant.maxActions / actionsLeft / spendAction / restoreAction / buyAction: 
- updateWithRelay(doc, changes): helpers/relay.mjs
- runEvents(item, trigger, ctx) / runActorEvents(actor, trigger, ctx) / runFloorRules(trigger, ctx): helpers/events.mjs
- resolveCheck(item, roll) / degreeOf(natural, total, dc) / checkDC(item, target): helpers/attacks.mjs
- evalAmount(text, data) / wholeAmount(...): helpers/amounts.mjs
- computeEffective(system) / computePetUpgrades(system) / allEvents(item): helpers/upgrades.mjs
- startDying / cancelDying / die / revive: helpers/dying.mjs
- restActor(actor, kind) / takeRest(kind) / confirmRest: helpers/rests.mjs
- levelUp(actor) / spendPoints(actor): helpers/level-up.mjs
- attemptAdvance(item): helpers/advancement.mjs
- announceSystem({kind,text,actor,banner}) / announceBossBattle(): helpers/system-announcements.mjs, announcement.mjs
- openLootBox / openAllLootBoxes / rollLoot / grantLoot: helpers/loot.mjs
- playCue(cue): helpers/sounds.mjs
- sourceItems(purpose): helpers/sources.mjs

# flags

- note: All under flags.carl-rpg (NS) unless stated.

## actor
- creationPending: bool; shows Create Character
- creationStats: {stat: value} saved rolled stats
- creationComplete: bool
- revealed: [uuid] hidden races/classes/subclasses GM revealed
- defeatedIn: combat id a mob was defeated in
- loot results: saved Open-all roll results (see loot.mjs)

## item
- grantedBy: [item ids] on skills an item added
- raised: bool; skill rank raised by crawler/grant, protects from removal
- advanceFloor: floor of last advancement try (skills/spells rank>=5)
- equipLinked / identifier / tier / sourceItems / stacks / lastsUntil / rounds / roundsLeft / buildMods / damageMods / events / eventsTrusted: on effects (see effects.flags)
- storeSource: key on items bought from a store
- itemMacro: on hotbar macros made from items

## combat
- phase: int 0..4
- declarations: object by combatantId

## combatant
- actionsSpent: int
- extraAction: bool
- interruptUsed: bool
- injuries: {minor: n, major: n} applied when combat deleted

## chatMessage
- card: {kind, name?, skill?, header?, degree?}
- attack: check record {itemName, itemUuid, type, targetKey, number|dc, degree, damage, floor, targets[{tokenUuid, actorUuid, name, state pending|resolved, degree, hit, damage, rolled, skipped, injury, applied}], fired[]}
- changes: change-log lines
- cue: sound cue id
- group: group check state
- floor: floor when rolled (recap)
- recapped / advance: recap bookkeeping
- relays: updateRelay, eventRelay, libraryRelay, lootRequest, lootResponse, mobCheckRelay, pileRelay, storeBuy, storeOpen, storeSell (whispered, handled and deleted by the active GM client)

## measuredTemplate
- area: {roundsLeft, kind, ...} lasting area bookkeeping

## journalPage
- libraryEvent: one saved event (event library)
- recap: counts for a floor's recap page

# visibility

## permissions
- Limited: opens a locked sheet showing only Notes (biography); name/portrait
- Observer: can roll from the sheet; automatic changes (mana, actions, uses, AI Favor) done through the GM client relay; cannot unlock/edit; items on actors are read-only for Observers; sees mob Evade/DR
- Owner: edit mode, everything incl. gold, hotlist, notes, quests
- GM: all

- hiddenFromNonOwners: gold/junk, hotlist, notes (biography text sections), quests tab
- shownToEveryoneWhoCanView: sponsors, clubs, deity, personal space
- mobNumbersHiddenFromPlayers: Evade, DR, health values, floor override, ability numbers (cards, sheets, tooltips, tokens show only the bar). Shown to GM and Observers on the sheet. Journal @Embed of a mob deliberately shows stats.
- itemValues: GM only unless seeValues effect
