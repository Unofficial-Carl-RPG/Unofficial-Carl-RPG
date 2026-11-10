# items

## base
- file: data/base-item.mjs (all item types)
- fields:
  - description: html
  - shortDescription: html, used on chat cards and tooltips; blank -> full description. Embeds and previews always use full.
  - value: int gold value. GM-only visible unless an effect grants seeValues. Store listing price defaults to it; stores pay sellPercent of it.
  - identifier: string; matches 'same item' (duplicate checks, grants, effect matching) before falling back to name
  - tags: [string] case-insensitive (a Roll Modifier or Damage Effect skills list can match them with #tag, see rules.md skillLists); classes also have categories which count as tags
  - interrupt: bool; using it in the react phase marks the combatant's interruptUsed flag (bolt icon on tracker)
  - check: {target checkTargets id init unopposed, number int (mob checks)}
  - damage: number or dice formula e.g. '1d6+@str.mod'; blank = no damage; @rankDamage = the dice for the rank (see rules rankDamage)
  - damageType: id from the world damage type list or ''
- damageTypeAlso: optional second damage type (id or ''); the item's own damage is split evenly between damageType and this (see rules.md typedBonus alsoType); ignored with no damageType or the same one
  - armorPiercing: bool; damage ignores DR
  - targeting: {mode none|count|self|area, count formula, range amount in feet (number or formula) or Melee|Touch|Unlimited, filter enemies|allies|any, shape circle|cone|ray|rect, size formula, lasting bool, lasts amount, in rounds (number or formula over roll data, e.g. by @rank; 0 until GM removes; was an integer, migrated to text), areas formula, limit formula (0 = all), splash amount in feet (Area: beyond the placed area's edge; Count: around each chosen target; default 0), splashDamage dice formula (blank = none), splashEffects bool, kind ''|fire|difficult|poison}
  - requirements: [{type mana|stat|gold|actions|classTag, stat, value (number or formula, see events.md formulas), tag}] must hold or the item cannot be used (warns)
  - events: [event] see events section
  - costs: [{resource mana|junk|uses|ammo, amount formula, max formula|'', name, identifier, tag}] ranged when max set. name/identifier/tag only matter for ammo rows (see ammunition below)
- ammunition: a costs row with resource ammo spends a crawler's inventory items (type item only, never gear) each use. Item dropped on the row (name + Identifier saved) matches by Identifier when both have one else by name (sameItem rule); the row's tag matches any item with that tag; either matches. Fixed amount or a range (the roll pop-up asks, capped at the largest matching stack). Several ammo rows allowed, each paid on its own. Pets, mobs and unowned items spend none. Logic in helpers/ammo.mjs (pure), asking/spending in CarlRPGItem #planAmmo/#spendAmmo; ammoSpans(), ammoSummary (name, need, left, owned) feed badges, quick bar and the Gear/Inventory row counts. Ammo costs have no upgrade changes.
  - uses: {max (0 = unlimited), spent, recharge usesRecharge id, every (N for rounds), waited}
  - eventsTrusted: bool, GM-saved marker
- amounts: targeting.count/size/areas/limit/splash/lasts/range and costs.amount/max are 'amounts': number or arithmetic over roll data, no dice. Operators + - * / % ** (), functions floor ceil round abs min max, tokens @path (object path uses .total). Roll data: actor stats (@str.mod ...), @lvl, @rank, @floor, @cost, @cost.mana, @cost.junk, @cost.uses, @cost.ammo, @cost.total (total includes ammo); damage formulas read @cost too (see rules.md costDamage). Implemented in helpers/amounts.mjs (never rolls).

## sheetTabs
- note: item-sheet.mjs _configureRenderOptions: every sheet has header, tabs, description (a Limited viewer gets only those). Then the parts below. Every type EXCEPT background also gets 'events' (events + requirements). Attribute parts are templates/item/attribute-parts/<type>.hbs.
- skill: attributesFeature, tags, effects, upgrades
- spell: attributesSpell, effects, upgrades
- gear: attributesGear, skills, effects
- item: attributesItem, skills, effects
- mobAbility: attributesMobAbility, effects
- lootBox: attributesLootBox, rewards, guaranteed
- achievement: attributesAchievement
- sponsor: attributesSponsor
- store: attributesStore
- quest: attributesQuest
- personalSpace: attributesPersonalSpace
- club: attributesClub, effects
- deity: attributesDeity, skills, effects
- race|class|subclass: attributesOrigin, grantedSkills, prerequisites, effects
- species: attributesSpecies, grantedSkills, effects
- background: attributesBackground, skills

## skill
- model: CarlRPGFeature
- fields: rank int>=0, advanceable bool (Can Advance), passive bool (uses no action, still rolls), stat (abilities), formula (derived), upgrades[], damageEffect{enabled, skills (comma list of attack skill names or identifiers it works with), cooldownHours int (hours left), cooldownRound bool (used this round)}
- derived: rankBonus / effectiveRank / rankChange / rankMin (see skillRankBonus in buildBenefits; effectiveRank = rank when nothing applies); formula = '1d20 + @<stat>.mod + <effectiveRank>' plus effective.rollBonus; effective = computeEffective(system); damageRules = effectRules(system) when damageEffect.enabled, else null. On a pet, rank = current floor.
- damageEffect: a passive skill chosen before rolling to hit; see rules.md damageEffects. Attributes tab: tick Damage Effect, list the attack skills, cooldown state with Reset (owner). Its Upgrades tab then offers the de* changes.
- rollMod: system.rollMod{enabled, skills} (comma list of skills it changes, or the word self for its own use). A passive skill chosen in the roll pop-up before rolling a listed skill or spell (a rollModScope build benefit can widen the list); derived system.rollModRules. Attributes tab: tick Roll Modifier and list the skills; its Upgrades tab then offers the rm* changes (rmRank, rmDice, rmDR) with an 'Only when' menu. See rules.md rollMods.

## spell
- model: extends skill
- extra: Mana cost is just a costs row; derived manaCost = least Mana cost. Hotlist-only rule can block casting.

## gear
- fields: slot (gearSlots), twoHanded bool (Hands slot only; cleared when the slot changes; derived isTwoHanded = slot hands && twoHanded), equipped bool, dr int>=0, quantity int>=1, skills [skill UUIDs it grants], rollSkill (one of skills; '' = first) , action{type none|stat|skill|custom, stat, modifier, formula}, formula derived
- rules:
  - Armor stat = sum of dr of all equipped gear. Equip/unequip via toggleEquipped(); no room in the slot prompts a swap (planEquip in helpers/gear-slots.mjs: Hands has 2 places, two-handed gear takes both, so equipping it may swap out two items at once; equipping anything while holding a two-handed item swaps that out). Editing equipped gear so it no longer fits (Two-Handed ticked, moved to a full slot) unequips it with a notice and runs its unequipped events (item.mjs #keepGearFitting). Gear list Slot column and badges read 'Held (2H)'. Gear only: plain items have no equipped state.
  - Skills it lists are added to the crawler when the gear is ADDED (equipped or not), kept on unequip, removed on removal unless raised or shared (see skillGrants).
  - A weapon rolls with skill rollSkill (owner can switch per copy from a menu on the gear row). Roll uses that skill's stat and rank; damage = weapon damage + skill damage/unlocked upgrades; the skill's own events also run. Missing skill: equipping adds it at rank 0 and whispers GM; rolling is blocked if the skill is gone.
  - action.type: none = posts description only (still fires used events), stat = 1d20 + @stat.mod + modifier, skill = 1d20 built from the skill when used, custom = formula.
  - Gear fires equipped/unequipped events; effects with equipLinked follow equipped state.

## item
- fields: quantity int>=0, skills[], rollSkill, action{...}, formula
- note: Plain inventory item; same action semantics as gear. Consumable if quantity or uses used.

## mobAbility
- fields: rank, stat, formula=1d20+@stat.mod+rank (display only; mobs do not roll), plus base check.number and damage
- note: In the Mobs Declare phase using it declares it instead (Shift uses now). Numbers hidden from players.

## lootBox
- fields: tier, quantity, draws (random picks), goldOverride (formula; blank = tier default), rewards[{uuid, quantity, weight}] (never other loot boxes), guaranteed[{uuid, quantity number|dice}] (outside draws)
- events: opened trigger fires only after a successful opening

## achievement
- fields: lootBox UUID
- rules: One per crawler (matched by identifier else name). Each grant pays its box again once removed and re-added; duplicate blocked while held. Posts card + sound cue. Granted by GM drop, Dungeon Info Award, quest reward, or Award achievement event action.

## race|class|subclass
- fields: grantedSkills[{uuid, rank, count, tag, stat, kind}] (count > 0: no uuid, "the player picks count skills" at rank, see picks below), prerequisites[{type, stat, stats[], value, category, uuid, tag}], earthBased (race tick; not earth = alien), hidden bool, categories[] (class and race), subclass.classUuid
- rules:
  - Chosen from floor 3 for players, race then class (GM can assign any; unmet prerequisites noted in chat). One race, one class (replace prompt). Choices permanent for players.
  - Granted skills added at set ranks; effects on the item copied to the actor like any item's. Pick rows (count > 0) are skipped here and granted when the player picks (see picks).
  - picks: choices left to the player, files helpers/picks.mjs (pure), helpers/pick-dialog.mjs (dialog and writes). Three kinds, all permanent for the player:
    - grant: a granted-skills pick row. Pool = skills AND spells from the skills compendium source (sourceItems('skills')) matching the row's optional tag, stat and kind (all must match). Picked skills are added at the row's rank, or raised to it if owned (same as fixed rows). Record: flag picks on the crawler's copy of the race/class/subclass, {row index: [skill uuid]}. Races, classes and subclasses only (not species).
    - cap: a scoped build row (skillCap, skillRankBonus, rankDamage*) with scope pick: covers only the picked skills, by Identifier. Row fields count, tag, stat, skillKind, picks[{value: Identifier, name}] (picks on the actor's effect copy). Pool skips skills with no Identifier.
    - split: build kind statSplit, see buildBenefits.
    - when: right after Choose Race/Class/Subclass (origins.chooseOrigin/chooseSubclass call choosePicks); anything left blank stays pending behind the header Make Choices button (crawler sheet, editable). A dropped-on race/class has no dialog, only the button. Fewer matching skills than needed: pick what exists, the rest stays pending.
    - GM: Reset picks button on the race/class sheet (crawler's copy only) clears the item's picks flag and the picks/splits on its effect copies (found by flags sourceItems); skills already granted stay.
    - chat: one card lists what was chosen.
  - Prerequisites all must hold (helpers/origins.mjs evaluatePrerequisites): stat >= value, skillRank (one named skill), skillStatRank (any skill or spell whose stat is one of stats[], stored rank >= value; rank bonuses don't count; no stats ticked = never met), skillTagRank (any skill or spell with tag, ignoring case, stored rank >= value; blank tag = never met; bestSkillRank(actor, {stats, tag}) gives the best matching rank), level, species (uuid of a species item; met when the crawler holds a species item with the same identifier, else name), race (specific), raceCategory (earthBased|alien), achievement, classTag (class categories count as tags).
  - Editor (templates/item/prerequisites.hbs): skillStatRank shows one tick box per stat (class prereq-stat-toggle, saved by _togglePrereqStat) plus the rank; skillTagRank shows a tag box (suggestions: tags used by skills and spells) plus the rank; species is a drop box for a species item. Races can't use race, raceCategory or classTag; the three new types are offered on races and classes.
  - hidden: not listed until prerequisites met or GM reveals it to that crawler (Dungeon Info Reveal; actor flag revealed[uuid]).
  - Race and Class combo: a race whose effect has modifier classCombo > 0 also acts as the class: fills Class box, counts for class tag prereqs, subclasses attach to it, players cannot take a Class item (GM can after prompt and the class then takes over the Class box).
  - Subclass: chooser available from world setting subclassFloor (default 6), lists only subclasses of the crawler's own class they qualify for; a crawler may hold several, Class box shows the newest. GM drop adds without replace prompt.
  - Race/class build benefits live as effect modifiers on the item's effects (see build-mods).

## species
- fields: size, grantedSkills[{uuid, rank}]
- rules: Optional creation wizard step (world setting speciesInCreation) for animal crawlers. Sets size and Race box to its name, adds skills and effects. A later race choice overwrites the Race box.

## background
- fields: categories[] (creation groups childhood|adolescence|hobby|career, one or more), skills[] UUIDs (three typical)
- rules: Creation only; never on an actor (_preCreate refuses). Player picks a background then 2 of its skills, or 'any skill' (tagged pool) if creation setting allowAnySkill.

## sponsor
- fields: notes
- rules: Held by crawlers up to world setting sponsorLimit (default 3, -1 unlimited). GM-only Send gift button picks a loot box, gives it, posts a card from the sponsor. No favor level.

## personalSpace
- fields: tier int, size, amenities[{name, description}]
- rules: One per crawler; dropping another replaces it.

## club
- fields: role (on the crawler's copy)
- rules: Template with description/effects/events; any number per crawler; shows read-only member list.

## deity
- fields: offering text, tithe 0..100 (default 5), tier 0..3 (GM sets on crawler's copy; 0 = none)
- rules: One per crawler (new replaces old), dropped on sheet. Tier 1..3 sections of effects stack (effect flag tier). Make offering button posts the offering text to chat. Tithe: percent of loot-box and mob gold, rounded down, taken (nobody paid); prompt to pay or skip. Header Deity box only while held.

## store
- fields: sellPercent 0..100 default 50, listings[{uuid, price|null=item value, quantity|null=unlimited, startStock|null, snapshot|null}]
- rules:
  - GM Open store (for one crawler or the party) shows a Buy/Sell window until closed. Buying pays gold, gives item, stacks into matching item. Selling pays sellPercent of item value and adds the item to the store (same name/type/price listing +1, else new listing with snapshot, startStock 0). Restock sets stock to startStock. Store never shows base item value; it shows its own prices.
  - Buy/sell are carried out by the GM client (stock changes).

## quest
- fields: giver, deadline{type none|floor|days, value}, objectives[{text, done}], rewardGold, rewardBox UUID, rewardAchievement UUID, completed
- rules: GM gives a copy to a crawler (Quests tab, owner+GM only). Owner ticks objectives. GM Complete pays gold, loot box, achievement (skips already-held achievement, quest still completes). Deadline is a label only.

# effects

- doc: CarlRPGActiveEffect. All effects are normal ActiveEffects; behaviour is in flags.carl-rpg. Effects on ITEMS are templates (transfer false): copied onto the actor with the item (sourceItems = ids of giving items); removed with their item unless permanent. Effects can also be created directly on actors.

## flags
- kind: buff|debuff|passive. Max 3 active buffs (activating a 4th prompts a swap). Debuffs unlimited. Passive never counted.
- stackBuff: buff only, bool ('Stacks with group'). Joins a buff slot group; stackAs: the group name (blank = the effect's identifier, else its name, case-insensitive). Buffs of one group share ONE slot and switch on/off together: setActive on any member switches the whole group (members an upgrade has not unlocked are skipped; one that unlocks later joins on the next switch-on); a group already on needs no free slot; swapping a group out switches off all its members. Slot counting is helpers/buff-slots.mjs (pure: groupNameOf, slotMates, usedBuffSlots), used by CarlRPGActiveEffect.setActive (getters slotGroup, slotMates) and the Effects tab count. Grant (item.mjs #grantEffects) copies a stacking template as its own effect even when another template of the same item has the same identifier/name. Events toggleEffect picks an unlocked match when several share a name. Use a different Group name rather than a shared identifier when upgrades must unlock effects separately: unlocks are keyed by identifier/name (effectKey). Link icon on the Effects tab and the item's effect list.
- identifier: matches 'same effect' (else name)
- stackable: debuff only; reapplying adds a stack; numeric changes multiply by stacks
- maxStacks: optional
- stacks: int
- permanent: keep when source item removed
- equipLinked: on only while the gear that gave it is equipped
- sourceItems: [item ids]
- lastsUntil: ''|short|long|full|combat
- rounds / roundsLeft: duration in rounds, counted down when Cleanup starts; effect then switched off with chat note; count starts when switched on
- tier: deity tier section this effect belongs to
- buildMods: [{kind checkDie|healthStat|statCap|skillCap|skillRankBonus|rankDamageBonus|rankDamageStep|damageDice|damageStat|rollModScope|statSplit, target, value, name?, amount? (skillRankBonus and rankDamage kinds only), min? (skillRankBonus only), stats[]/skillKind (scope stat), dice/bonusType/bonusAlso/when/feet (damageDice only), from/to (damageStat only), entries/single (rollModScope only)}]
- percentMods: [{stat str|int|con|dex|cha|dr|evade|move|step|mana, percent whole number (negative ok), flat number|null}]. A percent of the actor's CURRENT total (Enhanced value for a stat; the total of DR, Evade, Move, Step, max Mana; helpers/percent-mods.mjs totalOf), worked out ONCE and rounded down (toward zero for a penalty) when the effect lands on an actor, then kept as `flat`. See percent below.
- damageMods: [{type damage-type id, mode resist(half)|immune(none)|vulnerable(double)}]
- dead / dying: markers for the Dead (permanent) and Dying effects

- percent: helpers/percent-mods.mjs (pure: percentOf, totalOf, settlePercentRows, clearPercentRows, percentChanges). Rows are worked out when: an item's effect is copied to an actor (item.mjs #grantEffects creates it, active-effect.mjs _preCreate settles every row), an effect is created or dropped on an actor (same _preCreate; a flat from another actor is not kept), or its rows are edited on an actor's effect (_preUpdate: a new or changed row is worked out again from the actor total minus this effect's own old number; untouched rows keep theirs). Effects on items are templates: flats are cleared. Later changes to the actor never move a kept flat. The flat joins the applied changes in memory only (active-effect.mjs prepareBaseData, ADD mode on the usual system.bonuses key, flagged carlPercent), so effect.changes (stored) stays as typed and the effect sheet lists the stored ones. Everything else is the normal flat path: equipLinked, switched on/off, kind, stacks (a stackable debuff multiplies it), upgrade locks. A percent never uses a buff slot beyond what the effect's own kind does (use kind passive for gear). Effect sheet: "Percent of a stat" section (stat menu, whole percent, the worked-out flat shown on an actor's copy; hidden from players on a mob). Existing flat modifiers and External-Buff-style effects are unchanged. Examples (carl-content): Chesty Cheese Grater +5% Constitution, Enchanted Wand of Incontinence +10% Constitution, Hand Grips of Hella Holding +10% Strength, each a passive equipLinked effect. A small owner can round to nothing (5% of Con 14 = 0).
- modifiers: Effect 'changes' are always system.bonuses.<key> (picked from a menu, never typed). Keys: stat bonuses, dr, evade, move, surprise, mana (max), hotlist (count), actions, step (crawler Step), seeValues (grant: see item values), sortValue (grant: sort by value), classCombo (grant, race acts as class), advStr..advCha (>0: advantage on that stat's checks and its skills), skillStr..skillCha (+N on every skill roll using that stat; rank untouched).

## buildBenefits
- checkDie: value is a die like 1d4 added to the actor's own checks against target (evade or a stat): defending roll and stat check
- healthStat: target stat whose modifier a health box is worth instead of CON (last wins)
- statCap: highest enhanced value for target stat (lowest wins)
- skillCap: raise rank cap 15 -> 20; target scope all|skill (value = identifier)|tag (value = tag)|stat (stats[] = ticked stat ids kept in stat order, skillKind ''|skill|spell; covers every skill or spell whose OWN system.stat is ticked, never a stat swapped in the roll pop-up; none ticked = covers nothing; skill-cap.mjs skillCapRowCovers, so every scoped kind gets it)|pick (the player's picked skills, see picks); highest matching row wins. Effect sheet: scope stat shows the prerequisite's tick boxes (class build-mod-scope-stat) and a Skills/Spells menu (build-mod-scope-kind)
- statSplit: points the player splits between stats. Row: points (>= 1), stats[] offered (empty = all five), repick never|floor, split{stat: n} (the answer, clamped to whole numbers >= 0 on offered stats and never over points in all), usedFloor (floor of the last redo). Adds split points to the stat's Enhanced value in crawler prepareDerivedData (build-mods.mjs statSplitOf; before the statCap), only while the effect is on. Pending until every point is handed out. With repick floor the header Reassign Points button redoes it once per floor (a redo that changes nothing does not use the floor; the first split never does).
- skillRankBonus: same scope as skillCap plus amount (whole number, negative ok, new rows start at 1); every covering row of every effect that is on adds up to system.rankBonus; effectiveRank = max(0, rank + rankBonus), a positive bonus stops at the skill cap (skillCapOf; none for pets; a stored rank already above the cap stays), a rank 0 skill is lifted too. min (optional whole number, blank/0 = none, any scope, Min box on the row, kept by kindFields): when the covering rows total a penalty and the STORED rank is >= 1, effectiveRank is not dropped below min(stored rank, highest min among the covering rows) (a floor on the total, so rows without a min are held too); stored rank 0 stays 0; a total of 0 or more ignores min. Derived system.rankChange = effectiveRank - rank and system.rankMin = that floor while it is what holds the rank up, else 0 (skill-rank.mjs skillRankModsOf, rankFloorOf). Never stored. Everything reads effectiveRank (helpers/skill-rank.mjs rankOf(system)): roll formula, upgrades reached (levelOf) and the effects they unlock, @rank (events, costs, ranges), @rankDamage, Roll Modifier Rank, Damage Effect rank, group/journal checks, lists (tooltip shows 'Rank N, +B from effects'; while a minimum holds, the real change plus '(min M)', and the sheet line reads 'Rank now: N (min M)'), quick bar, crawler summary, rank sort. Stays on the STORED rank: the Rank field, advancement and its cap, Grant a skill event, 'advanced' trigger rank, granted/raised skills.
- rankDamageBonus|rankDamageStep: same scope as skillCap (helpers/build-mods.mjs isScopedKind) plus amount (whole number, negative ok, new rows start at 1); bonus is added to the rank @rankDamage reads, step moves rows along its table; every covering row of every effect that is on adds up (see rules rankDamage)
- damageDice|damageStat: same scope as skillCap (isScopedKind, so scope pick works too); a row covers a use when it covers the item used or the skill it rolls with. damageDice: extra damage dice. Fields dice (die, number or formula over the owner's roll data like @health.lost for Rage, new rows 1d4), bonusType, bonusAlso (damage types, second needs a first), when (CONFIG.CARL_RPG.rollMods.allowed.damageDice), feet (only with within, starts at 5). damageStat: from, to (stat ids, different; new rows str to cha). cleanBuildRow keeps these through kindFields and drops them when the kind changes; the effect sheet warns on a row diceRowProblem/swapRowProblem would skip. Rules: rules.md buildDamage (helpers/build-damage.mjs)

- rollModScope: adds entries to the list of ONE Roll Modifier skill for a crawler whose effect is on (helpers/roll-mods.mjs SCOPE_KIND, scopeRowsOf, scopeCovers, modAccepts). Row: target 'skill', value = the modifier's Identifier (case-insensitive, matched against the crawler's copy; set by dropping the skill on the row's drop box, which only accepts a skill with Roll Modifier ticked; name = display), entries = comma list in the skillLists syntax (names, identifiers, #tags, #a+#b; self is ignored), single = tick "Single target". The modifier's own list is never changed. A row with no modifier or no entries is skipped (scopeRowProblem; the sheet warns). cleanBuildRow clears the modifier when a row changes kind. Rules: rules.md rollMods. Example: Blizzardmancer (carl-content) effect 'Aiming for Ice Spells' = aiming + `#ice+#ranged` + single, so Ice Blast and Icicles (tags ice, ranged; Count 1) offer Aiming; Frost Scar (melee), area or multi-target ice spells and other crawlers do not.
- locks: An effect named in a skill/spell/pet upgrade's unlocksEffects is suppressed until that rank/level (lockedUntilRank, measured against effectiveRank). While the bonus itself is worked out, effects are judged by stored ranks (ActiveEffect lockedRank({stored:true}), buildModsOf(actor, {stored:true}), levelOf(system, true)) so a Skill rank bonus never waits on itself.
- statusEffects: Dying (rounds left), Dead (permanent, skull overlay), Minor Injury (-2 all stats), Major Injury (-5)
