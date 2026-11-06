# items

## base
- file: data/base-item.mjs (all item types)
- fields:
  - description: html
  - shortDescription: html, used on chat cards and tooltips; blank -> full description. Embeds and previews always use full.
  - value: int gold value. GM-only visible unless an effect grants seeValues. Store listing price defaults to it; stores pay sellPercent of it.
  - identifier: string; matches 'same item' (duplicate checks, grants, effect matching) before falling back to name
  - tags: [string] case-insensitive; classes also have categories which count as tags
  - interrupt: bool; using it in the react phase marks the combatant's interruptUsed flag (bolt icon on tracker)
  - check: {target checkTargets id init unopposed, number int (mob checks)}
  - damage: number or dice formula e.g. '1d6+@str.mod'; blank = no damage; @rankDamage = the dice for the rank (see rules rankDamage)
  - damageType: id from the world damage type list or ''
  - armorPiercing: bool; damage ignores DR
  - targeting: {mode none|count|self|area, count formula, range string(ft|Melee|Touch|Unlimited), filter enemies|allies|any, shape circle|cone|ray|rect, size formula, lasting bool, lasts int rounds (0 until GM removes), areas formula, limit formula (0 = all), kind ''|fire|difficult|poison}
  - requirements: [{type mana|stat|gold|actions|classTag, stat, value (number or formula, see events.md formulas), tag}] must hold or the item cannot be used (warns)
  - events: [event] see events section
  - costs: [{resource mana|junk|uses|ammo, amount formula, max formula|'', name, identifier, tag}] ranged when max set. name/identifier/tag only matter for ammo rows (see ammunition below)
- ammunition: a costs row with resource ammo spends a crawler's inventory items (type item only, never gear) each use. Item dropped on the row (name + Identifier saved) matches by Identifier when both have one else by name (sameItem rule); the row's tag matches any item with that tag; either matches. Fixed amount or a range (the roll pop-up asks, capped at the largest matching stack). Several ammo rows allowed, each paid on its own. Pets, mobs and unowned items spend none. Logic in helpers/ammo.mjs (pure), asking/spending in CarlRPGItem #planAmmo/#spendAmmo; ammoSpans(), ammoSummary (name, need, left, owned) feed badges, quick bar and the Gear/Inventory row counts. Ammo costs have no upgrade changes.
  - uses: {max (0 = unlimited), spent, recharge usesRecharge id, every (N for rounds), waited}
  - eventsTrusted: bool, GM-saved marker
- amounts: targeting.count/size/areas/limit and costs.amount/max are 'amounts': number or arithmetic over roll data, no dice. Operators + - * / % ** (), functions floor ceil round abs min max, tokens @path (object path uses .total). Roll data: actor stats (@str.mod ...), @lvl, @rank, @floor, @cost, @cost.mana, @cost.junk, @cost.uses, @cost.ammo, @cost.total (total includes ammo). Implemented in helpers/amounts.mjs (never rolls).

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
- derived: formula = '1d20 + @<stat>.mod + <rank>' plus effective.rollBonus; effective = computeEffective(system); damageRules = effectRules(system) when damageEffect.enabled, else null. On a pet, rank = current floor.
- damageEffect: a passive skill chosen before rolling to hit; see rules.md damageEffects. Attributes tab: tick Damage Effect, list the attack skills, cooldown state with Reset (owner). Its Upgrades tab then offers the de* changes.

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
- fields: grantedSkills[{uuid, rank}], prerequisites[{type, stat, value, category, uuid, tag}], earthBased (race tick; not earth = alien), hidden bool, categories[] (class and race), subclass.classUuid
- rules:
  - Chosen from floor 3 for players, race then class (GM can assign any; unmet prerequisites noted in chat). One race, one class (replace prompt). Choices permanent for players.
  - Granted skills added at set ranks; effects on the item copied to the actor like any item's.
  - Prerequisites all must hold: stat >= value, skillRank, level, race (specific), raceCategory (earthBased|alien), achievement, classTag (class categories count as tags).
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
- buildMods: [{kind checkDie|healthStat|statCap|skillCap|rankDamageBonus|rankDamageStep, target, value, name?, amount? (rankDamage kinds only)}]
- damageMods: [{type damage-type id, mode resist(half)|immune(none)|vulnerable(double)}]
- dead / dying: markers for the Dead (permanent) and Dying effects

- modifiers: Effect 'changes' are always system.bonuses.<key> (picked from a menu, never typed). Keys: stat bonuses, dr, evade, move, surprise, mana (max), hotlist (count), actions, step (crawler Step), seeValues (grant: see item values), sortValue (grant: sort by value), classCombo (grant, race acts as class), advStr..advCha (>0: advantage on that stat's checks and its skills), skillStr..skillCha (+N on every skill roll using that stat; rank untouched).

## buildBenefits
- checkDie: value is a die like 1d4 added to the actor's own checks against target (evade or a stat): defending roll and stat check
- healthStat: target stat whose modifier a health box is worth instead of CON (last wins)
- statCap: highest enhanced value for target stat (lowest wins)
- skillCap: raise rank cap 15 -> 20; target scope all|skill (value = identifier)|tag (value = tag); highest matching row wins
- rankDamageBonus|rankDamageStep: same scope as skillCap (helpers/build-mods.mjs isScopedKind) plus amount (whole number, negative ok, new rows start at 1); bonus is added to the rank @rankDamage reads, step moves rows along its table; every covering row of every effect that is on adds up (see rules rankDamage)

- locks: An effect named in a skill/spell/pet upgrade's unlocksEffects is suppressed until that rank/level (lockedUntilRank).
- statusEffects: Dying (rounds left), Dead (permanent, skull overlay), Minor Injury (-2 all stats), Major Injury (-5)
