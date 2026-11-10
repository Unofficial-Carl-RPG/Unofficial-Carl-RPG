# events

- file: helpers/events.mjs (runtime), helpers/event-roll.mjs (the @roll.* and @damage.* numbers a use brings), helpers/event-editor.mjs (shared sheet editor actions), helpers/event-summary.mjs (one-line summaries), helpers/event-library.mjs, helpers/event-approval.mjs, helpers/upgrades.mjs allEvents()
- holders:
  - items: system.events + system.requirements (every item type except background)
  - effects: flags.carl-rpg.events, run only while the effect is on
  - skill/spell upgrades and pet upgrades: upgrade.events, run only once the rank/level is reached (allEvents(item) merges them)
  - pets: own events use actor triggers only
  - floor rules: world setting floorRules, run by the GM client only; no owner, so a target-less action hits every crawler

## shape
- event: {id, name, enabled, trigger, phase ('any'|combat phase id; only for phaseStart/phaseEnd), match 'all'|'any', conditions[], actions[]}
- condition: {type, negate (NOT), stat, value (string: a number or formula, see formulas), phase, degree, uuid, tag, text}
- action: {type, mode, uuid, amount (string number|dice), targetActor (actor dropped on the action), runOn user|gm, selfItem, skipIfHas (default true), hidden, joinCombat, ignoreDR, damageType + delay (delayedDamage), ask (confirm first, skip if declined), text, targetGroup}

## formulas
- where: every number an event reads is a number or formula over roll data: action amount (dice allowed, rolled when run), condition value and requirement value (no dice; worked out by helpers/amounts.mjs evalAmount, so 'roll min' etc. are stable)
- valueConditions: stat, mana, rollMin, rollMax, lootGold, floor, floorExact, health, chance, targetSize, distance. A formula that cannot be worked out (missing data, blank, dice) makes the condition false; a requirement then blocks use with Needs.badFormula; an action amount counts as 0 with Warn.BadFormula
- data (events.mjs eventData(item, ctx)): the owner's actor roll data (@str.mod, @lvl, @health.value|max|lost ...; the OWNER of the event, not the actor an action is aimed at), @floor, @rank (item rank, 0 if none; a skill's or spell's effective rank), @item.* (item.system; @item.stacks for effects), @target.* (roll data of the target hit/missed), plus the trigger's: @roll.total, @roll.natural (first die), @roll.margin (roll total minus the number to reach, negative under: on hit/miss that target's, on used an unopposed check's, absent for an opposed used event, a no-roll use and a mob card's hit), @roll.bonus (the whole extra bonus: pop-up + build + Roll Modifier Rank; 0 if blank or it has dice), @roll.mod (modifier of the stat the roll used, after a pop-up stat change), @roll.rank (the rank added: the rolled skill's, else the item's own), @damage.total (that target's damage after crit, degree bonus and modifier dice, before DR; on used the card headline; absent on a miss), @damage.dice (sum of the base damage's dice, crit-doubled), @damage.base (base damage roll total; both absent when the use has no damage), @cost (total paid; @cost.mana .junk .uses .ammo), @trigger.amount|level|rank|actionsLeft|option (takesDamage damage, levelUp new level, advanced new rank, actionSpent actions left, option 1 when a Damage Effect's instead-of-damage tick was set)
- passed: item.mjs runEvents for used/hit/miss pass paid (what the use paid), ctx.check {margin, bonus, mod, rank} and ctx.damage {total, dice, base} (built by event-roll.mjs from resolveCheck's margin, damage and per-hit/miss margin and damage; the Damage Effect's own used/hit events get them too). The mob card's hit event (attacks.mjs) passes only damage.total. A value that is not a finite number is left out, so a formula reading it is unresolved
- rankDamage: @rankDamage in an ACTION AMOUNT (rollAmount, helpers/events.mjs) is the rank dice (CONFIG.CARL_RPG.rankDamage, see rules.md) of the event's holder: a skill, spell or mob ability reads its own effective rank, a weapon or item with a Skill check reads the skill it rolls with (item.rollingSkill()); an effect, pet upgrade, floor rule, gear with no skill or rank 0 reads "0" without a warning. It is dice, so conditions, requirements and ranges (no dice) cannot use it: they are unresolved (condition false, requirement blocks with Needs.badFormula). Not available to the data object (no @rankDamage.min/max)
- fillData (amounts.mjs): puts @paths into a dice formula (objects use .total, negatives bracketed) before Roll rolls it; any unresolved name -> warn, amount 0
- storage: condition.value and requirement.value are StringFields (old numbers cast to text on load); effect flags and floor rules are schema-less, so they can still hold numbers, evalAmount reads both
- relay: relayToGM sends triggerData (only roll, damage, cost, trigger objects are read back) and hitUuid; the GM's client rebuilds ctx.target and ctx.triggerData. A forged relay can only change those numbers, never the stored formula

## triggers
- used: after an item's roll and check resolved; ctx: roll, degrees
- hit: once per target that was hit (degree critHit|amazing|success); ctx target, targetToken (its token), degree
- miss: once per target missed; ctx target, targetToken, degree
- added / removed: item added to / removed from an actor
- equipped / unequipped: gear only
- opened: loot box only; after a successful opening, never on cancel/discard
- advanced: skill/spell only; rank rose through advancement
- phaseStart / phaseEnd: needs phase; actor trigger
- roundEnd: when Cleanup phase starts; actor trigger
- actionSpent: combatant actionsSpent increased; actor trigger
- takesDamage: applyDamage got through (boxes>0, mobs net>0); actor trigger
- restTaken: ctx rest short|long|full; actor trigger
- combatStart / combatEnd / floorChange / levelUp: actor triggers. combatEnd also ends effects with lastsUntil combat and restores uses that recharge round|rounds|combat. floorChange fires for EVERY world actor (fireForWorld) and restores floor-recharge uses. phaseStart/phaseEnd/roundEnd/combatStart/combatEnd fire for combatants only (fireForCombat). roundEnd also ticks effect durations, round-recharge uses and cooldowns.
- effectGained / effectEnded: effects only
- actorTriggers: phaseStart, phaseEnd, roundEnd, actionSpent, takesDamage, restTaken, combatStart, combatEnd, floorChange, levelUp
- actorTriggerExecutor: runActorEvents scans every item, effect and (pet) upgrade of the actor; runs on the owning player's client, or the GM's client when no player owner is connected (isPhaseExecutor)
- floorRuleTriggers: floorChange (updateSetting floor), roundEnd (when Cleanup starts), combatStart, combatEnd (deleteCombat), restTaken. No phase triggers in code; the plan also mentioned round start (not built).

## conditions
- stat: enhanced stat value >= value
- mana: current mana >= value
- phase: combat started and current phase == phase ('any' passes)
- rollMin / rollMax: roll.total >= / <= value
- nat20 / nat1: first die == 20 / 1
- degree: attack degree == degree (hit event: that target's; used event: any target)
- lootItem / lootGold: opening included item (identifier else name) / gold >= value
- classTag: actor class (or combo) has tag
- effect: actor has the effect (by identifier else name) switched on
- inCombat: actor is a combatant
- floor: floor >= value
- floorExact: floor == value (used by floor rules for one floor)
- health: current health boxes <= value
- chance: random percent < value
- targetSize: target sizeClass >= value
- distance: the owner's token (helpers/summon.mjs findAnchor, no targets) is within value feet of ctx.targetToken, edge to edge (helpers/distance.mjs: touching tokens are 5 ft apart on a 5 ft grid, one empty square between is 10 ft, a diagonal counts like a straight line). value is a formula like the other value conditions. False when either token is missing or they are on different scenes; offered on used|hit|miss events but only hit and miss bring a targetToken, so on used it is never true. Not carried by a relayed request (conditions are checked on the client that triggered the event)
- targetKind: text: crawler|pet|mob|basic|elite|boss
- restKind: text: short|long|full, 'at least' (long counts as short)
- damageOption: @trigger.option > 0, i.e. the roll pop-up's instead-of-damage tick of a Damage Effect; offered on used|hit|miss events (a Damage Effect's own used/hit events get it)

## actions
- useItem: uuid of an item the owner has; item.roll() at depth+1 (no action cost, no target prompt)
- macro: uuid Macro; runOn user|gm; execute({actor,item,trigger}); gm runs on GM client (needs trusted events)
- toggleEffect: uuid ActiveEffect template; mode toggle|on|off|removeStack|removeAll; adds the effect to the target first if missing; refused if an upgrade still locks it
- applyEffect: same handler but for 'the target that was hit': NEVER automatic; adds an Apply button for that target on the attack card, GM clicks (queueEffect/applyQueuedEffect)
- addItem: uuid Item; amount; stacks quantity into existing; skipIfHas
- addToken: uuid Actor; amount; hidden; joinCombat. Tokens fill nearest free cells around the user's first targeted token else the owner's token; never on another token; join combat only if one exists on that scene (never starts one). Direct placement needs create-token permission + owning actor/combat, else GM client (needs trusted events). Compendium actor imported once.
- summon: mode place|raise|copy; amount (how many tokens or copies: a number or formula over roll data, dice allowed, e.g. 1 + floor(@rank / 5); default 2 for copy, 1 otherwise); duration (rounds, formula over roll data; 0 = until combat ends); limit (formula; 0 = none; over the limit the oldest of the same spell (key = item identifier else uuid) and caster ends first); hidden; joinCombat. addToken is unchanged.
  - place: uuid Actor, placed like addToken (nearest free cells, never stacked, unlinked token, same trust/GM-relay rules); sizeClass formula (blank = actor size) sets the size class and token footprint (CONFIG.CARL_RPG.sizeFootprint 1-4:1, 5:2, 6:3, 7:4, 8:5 squares).
  - raise: first targeted token must be a defeated non-crawler mob; levelMax formula (blank = any) over roll data, else warn SummonTooHigh without numbers; revived in place with health formula fraction of max (blank = full; 0.5 = half rounded down, min 1), FRIENDLY disposition, caster's player owners get Owner, crawler side; ends: health 0 + defeatMob, owners/disposition restored.
  - copy: first targeted token must be a pet or live summon of the owner (isPetOrMinion); amount full unlinked copies (named "Name (2)"...) with the actor data, items and effects, in free cells; removed at expiry.
  - marker: flags.carl-rpg.summon on the token actor (delta) {mode,key,itemUuid,itemName,casterUuid,casterName,at,lasts,roundsLeft,side,owners,before}; helpers/minion-side.mjs (pure) reads it, helpers/minions.mjs does the work.
  - ending: each Cleanup phase (carlrpg.cleanupPhase) on the active GM client ticks roundsLeft, ends at <1; Combat._preDelete and deleteCombat end the rest (a summon with no combat waits for one and ends with it). Placed/copied tokens are deleted, a raised mob goes down again; a mob killed early stays defeated until combat ends. Chat note on each end.
  - loot: temp summons (place/copy) never count in needsLoot; raised mobs still do. A raised mob counts as crawler side (sideOfActor) and is hidden from mob numbers for non-GMs (seesMobNumbers).
  - relay: players run raise or limited summons through the GM client (eventRelay, anchorUuid; needs trusted events); the GM recomputes the plan.
- awardAchievement: uuid achievement; once (held = skip); reward box pays on grant
- revive: dead crawler back with 1 health box, no Dying, not put back in combat
- grantSkill: uuid skill; amount = ranks; absent -> added at that rank, present -> raised; permanent (flag raised); stops at skill cap; whisper to owner+GM
- removeItem: selfItem or uuid; amount reduces quantity else deletes
- mana: mode spend|restore; amount; not on mobs; spend warns if short
- health: mode damage (through applyDamage: DR, CON, damage types; ignoreDR) | heal (add boxes, up to max) | remove (take boxes off directly: no DR/CON/damage type, no takesDamage trigger; reaching 0 starts Dying/defeat through the normal actor update hook)
- delayedDamage: amount (dice, @rankDamage allowed) of damageType dealt to the target after `delay` round ends (formula over roll data, blank = 1 = the end of this round, minimum 1); ignoreDR optional. Runs on the GM client only (needsGM, so players need trusted events). Queued on the running combat (helpers/delayed-damage.mjs, flag carl-rpg.delayedDamage, entry {id, targetUuid, targetName, sourceName, formula, type, ignoreDR, left}); no started combat = warns DelayedNoCombat and queues nothing; a blank or unreadable amount warns DelayedNoAmount. Each Cleanup (carlrpg.cleanupPhase, active GM client) counts the entries down, saves the rest, then rolls the due ones and deals them through applyDamage (type resistance, then DR; dead or missing targets skipped; a failing entry is logged and the rest still land). The queue is a combat flag, so it ends with the combat. The chat note carries no numbers; a mob's damage line is whispered to the GM. Choosing the action in the editor sets a blank targetGroup to hit
- message: text with {name} {item}; posted as event card
- actions: mode spend|restore; amount; combat only
- gold: mode add|remove; crawlers only
- aiFavor: mode award|spend; crawlers only; floor 0
- rollTable: uuid RollTable; draw() to chat
- runEvent: mode field holds another event id of the same item; runs its actions without trigger/conditions; depth+1

## targetGroups
- '': owner of the item/effect (or the actor dropped on the action)
- allies: 
- enemies: 
- targeted: user's Foundry targets (without the tokens only in the item's splash unless its splash applies effects)
- burst: everything the use reached: the targeted tokens plus the tokens in the splash of a Count item's targets, or in and around a placed area, whether or not the item's splash applies effects; the same as targeted when there is no splash. Falls back to the user's Foundry targets; travels with a relayed request (ctx.burst, targetUuids). To heal a burst (Heal Others rank 15): put the heal actions on burst and add a splashAdd of 20 to the rank 15 upgrade.
- pets: owner's pets
- minions: owner's pets plus live summons of the owner (Heal Critter, Clockwork Triplicate)
- master: a pet's owner
- hit: the creature the event is for (the target that was hit or missed); nothing when the event has no target. Any action can use it; delayedDamage defaults to it

- limits: CONFIG.CARL_RPG.maxEventDepth = 5 (warns TooDeep). Action failures are caught per action and warned.

## ui
- itemSheetEventsTab: event cards with conditions/actions menus, drop targets for uuids, Run now (GM), Duplicate, one-line summary, Save to library, Add from library (menu or drag)
- library: world setting eventLibraryJournal: journal whose pages each hold one event in flag libraryEvent; anyone who can edit an item saves (players via GM relay), only GM deletes
- starterTemplates:
  - Teach a skill, then remove this item (skill left blank)
  - Heal 1 health box on use
  - boss phase: say a line + turn on an effect at a health point, once
  - boss phase: swap which abilities the boss uses at that health point
- approval: Dungeon Info lists unapproved events with Approve / Approve all; saving as GM approves

- performance: runActorEvents does one allEvents call per owner, prefilters by trigger, one player lookup per fire
