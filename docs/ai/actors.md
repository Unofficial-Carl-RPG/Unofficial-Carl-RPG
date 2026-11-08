# actors

## base
- file: data/base-actor.mjs
- fields:
  - health: {value int>=0 init 10, max int init 10}
  - biography: html (the Notes tab)
  - size: sizes key, init medium
  - actions: {base int init 2, perCrawler bool}; actions.max derived = base + bonuses.actions
  - bonuses: one number per effectModifierKeys entry (init 0). Active effects ONLY write here; derived values add them. Nothing an effect does is saved into base numbers.

## crawler
- file: data/actor-crawler.mjs
- fields:
  - mana.value: int>=0 (max is derived)
  - race: string (set by species/race choice)
  - gender: string (Gender/Pronouns)
  - className: string (class or subclass name, or combo race name)
  - deity: string (Deity box; only shown when a deity item is held)
  - attributes.level.value: int init 1
  - crawlerNumber: int>=0; 0 = hidden
  - crawlerKills: int; Crawler Killer skulls
  - bossKills: int; boss stars
  - aiFavor: int
  - gold: int>=0, only currency; add via actor.addGold(), spend via actor.spendGold()
  - junk: int>=0, Misc Junk second currency
  - statPointsSpent: int
  - move: {base 20, step 10}
  - hotlist: {size int 0..50 init 10, items [itemId|'']}
  - background: {pastTrauma, popularity, looseEnds, regrets} strings
  - killLog: [{name, note}] Important Things I've Killed (does not change crawlerKills)
  - abilities.<stat>.value: int>=1 init 1
- derived:
  - floor: CONFIG.CARL_RPG.getFloor()
  - abilities.<stat>: enhanced = value + bonuses.<stat> + the points of statSplit build rows, capped by statCap build row; mod = getStatModifier(enhanced); label
  - dr: {armor = sum of equipped gear system.dr, total = armor + bonuses.dr}
  - evade.total: dex mod + bonuses.evade
  - move.total / move.stepTotal: base + bonuses.move / step + bonuses.step
  - mana.max = mana.maxTotal: enhanced INT + bonuses.mana; mana.value clamped
  - health: max 10 always; perBox = mod of healthStat build row (default con); capacity = perBox*10
  - points: {earned = max(0,level-1)*3, spent, available, canSpend = floor>=3}
  - hotlist.size: min(max(floor(size+bonuses.hotlist),0),50)
  - getRollData: ability objects at top level (@str.mod, @str.enhanced), @lvl
- sheet:
  - tabs:
    - abilities (left sidebar, always)
    - hotlist
    - features (Skills)
    - spells
    - gear
    - inventory (items + gear list)
    - achievements
    - quests (owner+GM only)
    - effects (buffs max 3 active, debuffs, passives)
    - personal (sponsors, kills, mounts, clubs, personal space, deity)
    - biography (Notes, always last)
  - limitedView: Limited permission sees only the Notes/biography part, locked
  - headerActions:
    - toggleEditMode
    - rest (short|long|full buttons)
    - levelUp
    - spendPoints
    - chooseOrigin (race then class, floor 3)
    - chooseSubclass
    - createCharacter (wizard, only while creationPending)
    - openLootBox / openAllBoxes
    - offering (deity)
    - setHealth (click a box)
    - revive (GM, dead crawler)
    - giveStar/giveReward (boss mobs, GM)
    - roll (stat check from abilities sidebar)
  - dragToHotbar: Rest and Level Up buttons drag to hotbar -> macro (data.carlMacro)
  - editMode: most fields read-only until edit mode; drop boxes show at list ends only when editable

## mob
- file: data/actor-mob.mjs
- fields:
  - mobType: basic|elite|boss|crawler
  - race: string
  - attributes.level.value: int
  - move: int
  - dr: int set value
  - abilities.<stat>.value: flat int; no enhanced
  - floorPinned/floorPin: GM-only pin of this mob's Floor for its own numbers (box fills once from current floor)
  - rewardBox: UUID of loot box the GM gives chosen crawlers on defeat (Give reward button)
  - loot: {junk string(number|dice), gold string, items [{uuid, chance 0..100}], looted bool}
  - crawlerKills: int (Crawler-kind mobs show skulls)
- derived:
  - floor: pinned floor else global
  - abilities.<stat>.mod: getStatModifier(value + bonuses)
  - surpriseTotal: 10 + int mod + floor + bonuses.surprise
  - evadeTotal: 10 + dex mod + floor + bonuses.evade
  - drTotal: dr + floor + bonuses.dr
  - moveTotal: move + bonuses.move
  - health.max: 1..100, one box per point; health.perBox = con mod
  - actions: perCrawler true for elite/boss (combatant.maxActions = number of crawler combatants + bonuses.actions, counting defeated crawlers); else base + bonuses
- rules:
  - Mobs never roll a d20. A mob check number = item.system.check.number + floor; crawlers roll against it.
  - Mob health is damaged 1:1 by (damage - drTotal) in applyDamage (no CON division) - see quirks.
  - At 0 health: Crawler-kind mobs follow Dying rules, other mobs defeatMob(): skull overlay, removed from combat, flag defeatedIn=combatId (drives loot reminder).
  - Mob sheet tabs: abilities, mobAbilities, loot, effects, biography.

## pet
- file: data/actor-pet.mjs (extends crawler model)
- fields: all crawler fields (gold/hotlist/race/class carried but unused) + owner (crawler actor id) + upgrades[] + eventsTrusted
- rules:
  - 5 stats, level, mana, Evade/DR/Move/size, skills, spells, effects, equipped gear. No inventory/gold/hotlist (only gear, skill, spell may be added).
  - Levels like a crawler (3 points/level) but points spendable at any floor (points.canSpend = true).
  - Health boxes = min(10, sizeClass(effectiveSize) + level - 1), each worth CON mod.
  - A pet's skills use the current floor as rank everywhere; no skill rank cap.
  - Upgrades are keyed by level (default 15, +5), cumulative, computed in prepareDerivedData (never written): stat bonus, size step, evade/dr/move/mana/actions bonus. Grants of skills/spells create real items (helpers/pet-upgrades.mjs syncPetGrants), matched by identifier else name, kept if level lowers. Can carry events (actor triggers only) and unlock effects.
  - Pet events use actor triggers only (eventTriggersActor).
  - GM setting a pet's owner gives the owner's player-owners OWNER permission on the pet (GM client, once).
  - Pet is on its crawler's side in combat.
- sheetTabs: abilities, features, spells, gear, effects, upgrades, biography

## mount
- file: data/actor-mount.mjs
- fields: owner, dr, move, attacks[<=2 of {name, roll, damage}], trample{enabled, damage}, specialNotes, occupants[string], accessories[string]
- derived: health.max = min(10, sizeClass(size)); Move does not cost an action (uses one mount action)
- sheetTabs: mount, biography

## lootPile
- file: data/actor-loot-pile.mjs
- fields: source (mob UUID|''), gold, junk, items[{uuid, quantity}]
- rules: Made by Loot on a defeated mob, or by dropping an item on the canvas. Crawlers in the combat open it (CarlRPGLootPileSheet) and claim one item at a time; gold/junk take-all or share evenly (remainder to first). Gold from a pile is tithed. Empty pile removed by GM.
