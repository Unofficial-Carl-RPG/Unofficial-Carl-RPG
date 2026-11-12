# systems

## creation
- files: helpers/creation.mjs, sheets/creation-wizard.mjs, sheets/creation-settings.mjs, templates/creation/wizard.hbs, templates/settings/creation.hbs
- start: GM-only 'Create Crawler' button in the Actors directory makes a crawler and opens the wizard. A new crawler made with empty data gets flag creationPending, which shows a Create Character link on its sheet. Crawlers that are imported or duplicated are left alone.
- setup: System settings > Creation setup menu (creationSetup) edits world setting creationDefaults: {statMethod standardArray|roll, allowAnySkill, skillTag (default 'Starter'), freeSkills[{uuid, rank default 3}] (GM supplies e.g. Unarmed Combat; nothing built in), weapons[uuid], gear[uuid], gearPicks (default 2), laterFloors[{floor, level, gold}]}
- steps: basics, (species only if world setting speciesInCreation), stats, skills, weapon, gear, bio, review. Next is never blocked. Only the final Create crawler button is disabled until everything is valid; review step lists what is missing, each linking back to its step.
- stats: standardArray: assign [2,3,4,5,6] to the 5 stats with a row of value buttons per stat. roll: 1d6 per stat in list order, re-roll 1s, only after a button click, ~2s between stats; results saved on the crawler (flag creationStats) so closing does not allow a re-roll; GM can reset.
- skills: 8 skills in 4 groups of 2: childhood 1, adolescence 1, hobby 2, career 3 (rank = group). Per group pick a background then two of its skills, or 'any skill' (the skillTag pool, if allowAnySkill). No duplicate skill. Chips and options labelled 'Skill (Stat)'.
- weapon: pick one starter weapon; grants its rollSkill (default first) at rank 3. freeSkills also granted at their ranks.
- gear: pick up to gearPicks from the starter gear list
- bio: pastTrauma, looseEnds, regrets (+ name, gender, size on basics); popularity is not asked (starts at 0)
- notAtCreation: race, class, deity (race/class from floor 3). Exception: later-floor starts.
- laterFloors: a crawler created while the world floor equals a configured row starts at that level and gold and offers race+class at the end (offerOrigins)
- species: optional step; species item sets size + Race box + skills + effects
- write: applyCreation(actor, state) writes everything; planSkills(state) resolves duplicates/ranks

## origins
- files: helpers/origins.mjs, helpers/class-combo.mjs, helpers/picks.mjs, helpers/pick-dialog.mjs, sheets/actor-sheet-progression.mjs
- flow: Choose Race, then Choose Class buttons (same floor-3 rule for the GM's button; GM can still assign by dropping the item). Dialog lists every option with prerequisite status; hidden ones omitted until met/revealed. Subclass chooser from subclassFloor.
- picks: after the race, class or subclass is added the player's choices (skills to pick, points to split) are asked in one dialog; see items-effects.md race|class|subclass > picks.
- helpers: raceOf, classOf, comboOf, classRoleOf (class or combo), subclassesOf, latestSubclassOf, evaluatePrerequisites(item, actor), chooseOrigin, chooseSubclass, revealedOf

## lootBoxes
- files: helpers/loot.mjs, sheets/item-sheet-store-quest-loot.mjs
- open: openLootBox(box): draws `draws` items from rewards by weight (eligibleRewards), rolls gold (goldOverride else tier default), adds guaranteed items (quantity number|dice), tithes gold (deity), grants via grantLoot, uses the box up (quantity), posts a tier-styled card + loot sound cue, fires opened events.
- gates: Safe room only for players (world setting lootOutsideSafeRoom lifts it); GM always may. A crawler's unopened boxes cannot be dropped on another sheet.
- approval: world setting lootApproval: player does not roll; request goes to the GM client (whispered flag lootRequest, reply lootResponse) which rolls, shows, and GM approves / re-rolls / discards. No GM online: cannot open. GM leaves mid-request: nothing granted, box kept. Dungeon Info shows approvals section only while the setting is on.
- openAll: openAllBoxes(actor): lowest tier first (bronze..celestial, then receipt order). First click rolls every box at once and saves results on the crawler; button then reads 'Open next box (N)' and reveals one card per click. With approval the whole batch goes to the GM (Approve all, Re-roll/Discard each). Per-box Open button only when world setting lootPerBoxOpen is on.
- bossReward: mob.system.rewardBox: GM Give reward button on a defeated boss, pick crawlers (all default)

## mobLoot
- files: helpers/mob-loot.mjs, helpers/loot-pile.mjs, helpers/loot-pile-drop.mjs, sheets/loot-pile-sheet.mjs
- rolls: rollMobLoot: junk (number|dice), gold (number|dice, blank = none), each item rolls its own percent chance. Stacks like store purchases. Gold is tithed.
- delivery: The Loot button (mob sheet and tracker) calls pickCrawlerAndLoot, which only calls makeMobPile: a native loot pile actor + token is made and the mob tokens link to it. Crawlers in the combat open the pile and claim items one click at a time; gold/junk is shared evenly or taken (remainder to the first). giveMobLoot (direct to one crawler) is exported but not called from module code.
- drop: dropping an item on the canvas makes a pile (GM directly; an owner asks the GM client). An item from a crawler leaves one at a time; items with no compendium source are copied into the world.
- needsLoot: a mob counts as looted once Loot was used; mobs with no loot set are left out of reminders; temporary summons (Summon place/copy) are left out too

## stores
- files: helpers/store.mjs, sheets/item-sheet-store-quest-loot.mjs, templates/sidebar/store-window.hbs
- note: see items.store. Window styled as a gold ledger; GM client performs stock-changing transactions (performPurchase, performSale, restockListing). Hooks: tooltips show listing Short Description.

## quests
- files: item-sheet-store-quest-loot.mjs, actor-sheet-quests-loot.mjs
- note: see items.quest. Quests tab owner+GM only; completeQuest pays reward; Quest embeds/tooltips show Short Description.

- sponsors: GM-only sendGift: pick a loot box, give a copy, post a card from the sponsor. sponsorLimit setting.

## deity
- files: helpers/tithe.mjs, documents/item.mjs syncDeityTiers
- note: see items.deity. titheOf(actor, gold) = floor(gold * percent/100) (19 gold -> 0, 20 -> 1); only loot-box and mob/pile gold; pay-or-skip prompt (pay default) and a tithe line on the loot card. Unpaid tithe has no automatic penalty; GM lowers the tier.

## theShow
- dungeonInfo:
  - file: sheets/gm-tab.mjs + templates/sidebar/gm-tab.hbs. Sidebar tab id carlGM ('Dungeon Info', icon fa-dungeon), right-click the icon to pop out. Visible to players.
  - players: floor, party name (read-only), days left, floor state badge, floor notes for the current floor, Party Management (only the party leader's player: rename party, set titles), party panel (other crawlers' health bars only)
  - gm:
    - floor +/- and number (setting floor; changing re-prepares ALL actors incl. unlinked token actors and fires floorChange events + floor rules)
    - floor state Exploring|Safe room (badge for players; never posts anything by itself)
    - days left counter -1/+1/number (manual; nothing happens at zero)
    - floor notes: rows {floor|every floor, text}
    - Floor rules button -> editor window (same event editor; rules run on GM client)
    - Group check (dialog) -> startGroupCheck
    - encounter table per floor (roll table of mobs), Roll encounter, Encounter builder
    - loot approval list (only while lootApproval on)
    - events waiting for approval + Approve / Approve all
    - Awards: pick achievement + Award; one amount box (negative removes, floor 0) with Award AI Favor and Award Popularity buttons, each posts a chat card
    - Reveal: pick crawler + hidden race/class/subclass
    - System announcement: kind, crawler (for died), text, banner toggle, Send
    - Announce Boss Battle (bosses auto-found: active combat else viewed scene; each boss after the first toggles 'vs' (new line) / 'and' (same line))
    - Floor Recap post
    - party rest buttons short/long/full
    - designate party leader
- safeRoom: players' Rest and loot-box opening refused outside a Safe room unless restsOutsideSafeRoom / lootOutsideSafeRoom. GM actions always work.
- systemAnnouncements: helpers/system-announcements.mjs announceSystem({kind, text, actor, banner}); kinds died|boss|stairs|floor|general; card class carl-system-card; banner = full-screen flash on every client (default on for boss, stairs, floor). Journal page type carlSystemMessage (kind, headline, text) with a Send to chat button posts the same card. /announce and @Announce also.
- party: world settings partyName, partyLeader (actor id), partyTitles {actorId: title}; title shows before the crawler's name in chat (getTitle). Leader changes go GM-client via socket {type:'party'}.
- encounters: helpers/encounters.mjs: tableForFloor(floor) (null floor = every floor), parseRowText('[1d3] Goblin' -> count formula), drawEncounter, placeEncounter(entries) (GM clicks a map spot, mobs placed in a tight cluster, join combat on that scene; with autoStartCombat setting on, starts one), rollEncounter. Mobs scale automatically through the Floor.
- groupChecks: helpers/group-check.mjs. /group <stat|skill=Name> dc=<n|floor|unopposed> [all|most|atLeast=N] (GM), @GroupCheck[...] journal button (GM), Dungeon Info dialog. Card carl-group-card; each crawler's owner clicks Roll; once all have rolled the GM client posts the overall pass/fail by rule.
- recap: helpers/recap.mjs. Journal 'Recap Log' (id in world setting recapLogId; point it at another journal there), one page per floor ('Floor N') with Nat 20s / Nat 1s sections (entry: who, item and for a weapon its skill, result, target, damage, floor, round, time) and counts in a flag. Counts: boss stars, crawler kills, Elites defeated, achievements, loot boxes opened, nat 20/1. Active GM client writes; chat catch-up when no GM was online (messages flagged recapped; advancement not logged). Floor Recap button posts a public card: row per crawler + party total + Elites defeated. Basic mobs not counted. recordRecap(entry) hook point.

## journals
- file: helpers/journal.mjs (+ scss). World setting journalStyle (default on) styles every journal; with it off a .carl-rpg wrapper still styles part of a page.
- enrichers:
  - @Floor, @Party, @DaysLeft: live values, update in open pages
  - @Check[stat dc=12] / @Check[skill=Climbing dc=floor]: anyone clicks, rolls for their crawler (own/assigned), shows degree. DC number|floor (10+Floor)|unopposed (10+2xFloor)|blank usual rule
  - @Gold[50] @Junk[3] @LootBox[uuid] @Effect[uuid]: GM only buttons with a crawler picker; players see plain text
  - @Announce[kind|text]: GM button posts a System announcement
  - @Embed[uuid]: overrides Foundry @Embed for Items, ActiveEffects and mob Actors (other embeds stay Foundry's): item card in accent colour by kind (skill blue, spell purple, gear tan, item green, effect grey, mob red, other gold) with image, enriched full description, type, key numbers as chips, every upgrade's description (locked or not). Never shows events, requirements, loot odds or GM-only fields. Click opens read-only preview (or real sheet if allowed). Mob embeds (helpers/mob-embed.mjs mobEmbedInfo, drawn by journal.mjs appendMobSections) show to anyone who can see the page: kind, race, size; the health bar drawn as on the mob sheet (one box per health point, each showing the damage it holds with its percent under, red-to-green gradient, all full); under it a stat block as the book lays it out, a bold label over its value: Level, Surprise, Evade, Move, DR (Surprise, Evade and DR as the mob's own number without the Floor then "+F", Move then "+S", a plain suffix since mobs have no Step number) and STR..CHA as "value (+mod)"; the Biography (enriched, secrets only for owners); then every mob ability as a small card (picture, name, Check number with the mob's Floor added, target when not unopposed, damage and type, Ignores DR, full description). GM client supplies data to players without access.
  - @GroupCheck[...]: GM button
- works in: journal pages, item/skill/spell/effect descriptions, chat, quest and store text
- callouts: CSS classes on div: carl-system (green terminal), carl-quest, carl-boss, carl-hint, carl-readaloud (parchment, journal pages only). Secret blocks styled as classified files in every context.
- systemMessagePage: page type carlSystemMessage {kind, headline, text}

## compendiumSources
- files: helpers/sources.mjs, helpers/gm-docs.mjs, sheets/sources-settings.mjs
- what: System settings > Compendium sources menu stores world setting compendiumSources: for each purpose (achievements, races, species, classes(+subclasses), backgrounds, skills, mobs) whether the world's items and which compendiums feed that list. sourceItems(purpose) / sourceActors(purpose).
- playersWithoutAccess: installFromUuid() wraps fromUuid: a player's client that cannot read a compendium item asks the GM client over the socket and builds a read-only in-memory item with the real compendium UUID. Needs a GM connected; items-only.

- validate: System settings > Validate World Items (last menu): findProblems() lists broken links (background skills, loot box rewards/guaranteed, event actions' uuids, actor effects whose source item is gone). Changes nothing.
- crawlerSummary: Actors directory right-click > Crawler Summary: themed window with plain text (name, race, class, level, floor, stats; skills/spells with ranks; gear/inventory, gold, junk; bio, notes, personal tab) + Copy and Save as .txt. Gold/junk/notes/popularity only in the owner's copy.
- macros: see api. Ready-made macros JSON in packs-source/carl-rpg-macros.json (import into a compendium by hand).
- itemValues: item.system.value hidden from crawlers unless an effect has seeValues; sortValue lets them sort lists by value without seeing numbers; GM only edits; stores always show their own prices.
- skillGrantsOnItems: gear/items/deity list skills[]: added when the item is added to a crawler (equipped or not), tracked in flags grantedBy; whisper when removed with the item
