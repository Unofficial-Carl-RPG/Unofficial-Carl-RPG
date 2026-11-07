# rules

## useFlow
- entry: CarlRPGItem.roll(event, {depth, declared}) in documents/item.mjs
- order:
  - 1 Mob ability in Mobs Declare phase (depth 0, not declared, no Shift): declareInsteadOfUsing -> stored as a declaration, returns
  - 2 Dying actor cannot act (warn)
  - 3 hotlistOnlySpells setting: spell must be on hotlist (depth 0, GM exempt)
  - 4 checkRequirements(item): warns every unmet requirement
  - 5 uses: needs spans.uses.min uses left
  - 6 roll pop-up (click only; Shift skips; not for events/macros/mobs): extra bonus (number|dice), stat change, advantage/disadvantage, Damage Effect (see damageEffects), Roll Modifier menu + Surprise tick (see rollMods), amount to pay for ranged costs (capped at what user has; Shift pays least), Area shape menu when upgrades give an Area item more than one shape (also opens for an item that doesn't roll; Shift uses the first); a Count item whose reached upgrades add a shape gets the same menu with 'Single target' first, then each shape with its size ('Cone 15 ft'); Shift = single target (see targeting countArea)
  - 7 build benefits (advantage, per-stat skill bonus) applied to every roll
  - 8 chooseTargets(item, costData) for non-mob depth 0 (mode count/area; self = no prompt)
  - 9 claim an action in combat (passive skills and depth>0 free; none left -> confirm 'use anyway')
  - 10 weapon whose skill is gone cannot roll (whispers GM)
  - 11 ammunition planned first (asks, spends nothing): several matching stacks with enough -> pick one; none with enough -> 'use anyway' spends what is left of the largest stack; cancel stops the use. Then pay Mana/Junk (short -> confirm; 'anyway' spends all remaining, never below 0), then the planned ammunition is spent (item Quantity goes down, stays at 0; Observer via the GM relay)
  - 12 spend the action; Interrupt in react phase sets combatant flag interruptUsed
  - 13 spend uses
  - 14 _rollCore: card with item header (image, name, badges), short description (full expander), reached upgrades; roll posted; AI Favor reroll offered (not on nat 20/1, not to non-crawlers)
  - 15 resolveCheck: degree vs each target (or Floor DC), damage roll, attack card with buttons; a chosen Damage Effect is worked out per target here; Roll Modifier dice are added per target by degree
  - 16 events: rolling skill's 'used', item 'used', per hit 'hit', per miss 'miss'; summaries collected into attack message flags.carl-rpg.attack.fired (GM-only line); a chosen Damage Effect that changed the attack then starts its cooldown and runs its own used events, and its hit events run for each hit target it worked against

## checks
- dc:
  - unopposed: 10 + 2 x Floor
  - evade: target Evade (crawler/pet evade.total, mob evadeTotal)
  - <stat>: 10 + target stat mod + Floor
  - size: 10 + target Size Class + Floor
  - sheetStatCheck: 10 + Floor (d20 + stat mod)
- degrees: natural 20 critHit (always hits, damage dice doubled before modifiers); margin>=10 amazing (+Floor damage); margin 0..9 success; -1..-2 nearMiss; -3..-9 fail; <=-10 majorFail; natural 1 critFail (always fails). Hit degrees: critHit, amazing, success.
- mobFloor: a mob target/owner pinned floor replaces global Floor in its numbers
- advantage: two d20 keep highest; disadvantage keep lowest

## damage
- applyDamage(amount, {ignoreDR, damageType, parts}):
  - damage type: effects with damageMods halve (resist), zero (immune) or double (vulnerable)
  - parts: [{type, amount}] (set when typed bonus dice are in the damage, see typedBonus). Each part is adjusted by its OWN type (halves round down), the results are added, then DR comes off the total. amount is the parts' total and damageType is ignored. The chat note names each type that changed its part (qualitative, no numbers). No parts = the one-type path above.
  - crawler/pet: net = max(amount - (dr.total + held Roll Modifier DR), 0); boxes = floor(net / health.perBox) (leftover below a box is lost); health.value -= boxes (min 0); posts a damage card
  - mob: net = max(amount - (drTotal + held Roll Modifier DR), 0); health.value -= net; the damage line (DR, health lost, health left, types resisted) is whispered to the GM only, so players never see mob numbers
  - held Roll Modifier DR (flag tempDR) is added for this damage and then cleared, even when ignoreDR skips it; see rollMods
  - after: hurtWhileDying (boxes>0), runActorEvents takesDamage
  - health reaching 0 (GM client): crawler/Crawler-mob -> startDying; other mob -> defeatMob; >0 -> cancelDying
- attackCardButtons: carl-apply-damage with multiplier x2 / x1 / x0.5 (GM; a resolved row that evaded shows the same damage amount and buttons to the GM only, so the GM can apply half by hand, nothing is applied or halved automatically, and 'all hits' skips them; once damage is applied the 'Applied N' amount shows to the GM only, a player sees no damage amount on that row), carl-undo-damage per target (restores exact boxes lost, clears Dying it caused, once), carl-apply-effect per target+effect (GM), carl-mob-roll (crawler rolls defense or skips)
- noTargets: unopposed check still shows result; damage applies to whatever the GM has targeted when clicked
- crit: doubles damage dice before stats/buffs
- attackCard parts: a target row (and the card, for the no-target case) carries parts only when typed bonus dice changed the damage. The row shows '(4 Bludgeoning + 2 Fire)' beside the damage; the x2/x1/x0.5 buttons scale each part (floor each) and apply them through applyDamage parts. The card heading shows the parts instead of the attack's single type. Splash rows never have parts. The card shows rolled amounts only, never what a target resisted, so no mob numbers leak.

## rankDamage
- token: @rankDamage in a damage formula = the dice for the rank (table in constants.md). Skill, spell and mobAbility read their own rank (the effective rank for skills and spells; a pet's skills: the floor); gear/item that roll with a skill read that skill's rank for both their own and the skill's damage. Anything else, rank 0 or no item = 0. File helpers/rank-damage.mjs.
- when: expanded to plain dice right before the damage Roll: attacks.mjs resolveCheck and resolveMobCheck (expandRankDamage(effectiveOf(item).damage, item)); a weapon's joined weapon+skill damage is expanded in item.mjs #useRollingSkill with the skill. effective.damage and the sheets keep the raw token (like @str.mod).
- moves: rank bonus (added to the rank, then the table is read) then row step (rows along the table; below the first row = nothing, past the last = 2d10). Sources: skill/spell upgrade changes rankDamageBonus / rankDamageStep (effective.rankBonus / rankStep, not applied to the stored damage) plus the owner's effect buildMods rows of the same kinds whose scope (all|skill|tag, as skillCap) covers the item; all add up. Rank 0 ignores them.
- dice: a natural 20 doubles the dice but not the flat 1 of rank 1; dieStep upgrades do not change the rank dice; a multi-term result is wrapped in parentheses after - * /; @rankDamageX and @rankDamage.x are not the token.
- events: an event action amount can use @rankDamage too (the holder's rank dice; a weapon's rolled skill), see events.md rankDamage.

## costDamage
- file: helpers/cost-damage.mjs (withCost, damageRollData); wired in attacks.mjs resolveCheck and resolveMobCheck; item.mjs roll() passes `paid` to resolveCheck
- what: damage formulas read @cost, what the use paid (the amounts picked in the roll pop-up, the least with Shift): @cost.mana, @cost.junk, @cost.uses, @cost.ammo, @cost.total; a bare @cost means @cost.total. Nothing paid = 0 (a mob pays nothing, so its @cost fields are 0 instead of failing). Read by the item's own damage (as upgraded), a chosen Damage Effect's extra and typed dice, Roll Modifier dice and the splash damage. Event amounts and the d20 formula do not read it.
- steps: Foundry rolls have no comparisons or ternaries, so turn an amount into a step with min, max and floor: -2 * max(0, 5 - @cost.mana) is -4 at 3 Mana, -2 at 4 and 0 from 5; min(1, max(0, @cost.mana - 5)) * @rankDamage is one rank die from 6 Mana.
- magicMissile (Mana 3 to 6 from rank 5, 5 normal): damage `1d4 + @int.mod - 2 * max(0, 5 - @cost.mana) + min(1, max(0, @cost.mana - 5)) * @rankDamage`; Mana cost amount `5 - 2 * min(1, floor(@rank / 5))`, max `5 + min(1, floor(@rank / 5))` (5 below rank 5, then 3 to 6). Tested in tests/cost-damage.test.mjs.
- notes: @cost is what was picked, even if 'use anyway' then spends less Mana. The rolled damage is held at 0 or more.

## damageMultiply
- file: helpers/damage-multiply.mjs (resolveMultipliers, multiplierFor, scaleBase, targetDamage, multiplierNote, needsMelee, critReplaces); wired in attacks.mjs resolveCheck (per-target damage rows) and item.mjs roll() (builds the rows); roll-mods.mjs carries the same rows on Roll Modifiers
- what: the upgrade change damageMultiply {value (number above 0, fractions ok), scope 'total'|'base' (blank = total), when}. total = everything the target takes (dice, modifiers, bonus dice, Amazing Floor bonus); base = only the item's own dice result (flat modifiers and extras are added after, like a Damage Effect's base x Rank). Examples: Magic Missile rank 15 base x3, Shock Treatment rank 15 total x5 with when melee, Vine Porn total x4 with when crit, Double Tap (a Roll Modifier) total x3 with when crit.
- when: allowed ids '', disadvantage, advantage, surprise, melee, hit, amazing, crit. Roll ones (mode, surprise, melee) are checked once when the roll is made (resolveMultipliers); hit|amazing|crit are checked against each target's degree (multiplierFor). melee is a roll pop-up tick 'At melee range' (shown only when a row of the item, the rolled skill or a Roll Modifier in play needs it); Shift, events, macros and items that do not roll never tick it.
- rows: item rows come from effectiveOf(item).multipliers [{value, scope, when}]; the rolled skill's (a weapon rolls a skill) and the chosen/self Roll Modifier's rows join them. Of the rows that apply to a target the highest of each scope wins (they do not add or stack).
- order: base multiplier on the item's dice (scaleBase) -> Damage Effect changes and Roll Modifier dice (damageWithEffect + modTotal) -> split into damage parts -> every part x the total multiplier, rounded down (scaleParts) -> resistance, immunity and vulnerability per part -> DR. A part resisted afterwards therefore halves the multiplied number. Splash rows and mob abilities are not multiplied.
- crit: a row with when crit takes the place of the Critical Hit's x2 on the item's own dice: on a natural 20 they are rolled once (not doubled) and the row multiplies them. Dice from Damage Effects and Roll Modifiers are still doubled. The chat heading adds '(base xN, total xN)' when a multiplier is in play (the headline uses the unopposed degree, else a hit or the crit).
- ui: Upgrades tab: kind Damage: multiply shows a number box, a Total damage/Base dice menu and the Only when menu (on a Roll Modifier too). Starting value 2, scope total. Tested in tests/damage-multiply.test.mjs.

## mobAttacks
- numberToBeat: item.system.check.number + mob floor
- vsCrawler: card row pending; crawler owner clicks Roll (pop-up; AI Favor reroll offered) = d20 + defenseModifier (Evade total | stat mod | Size Class) vs number; or skips (counts as standard Success for the attack). A player's result is relayed to the GM client (mobCheckRelay).
- degreeFlip:
  - crawler critFail: attack critHit (double damage)
  - crawler majorFail: attack amazing (+Floor damage)
  - crawler fail|nearMiss: attack success
  - crawler success|amazing|critHit: attack fails
- injuryOnEvadeOnly: attack degree amazing -> Minor Injury; critHit -> Major Injury; recorded on combatant flag injuries, applied via applyInjury when the combat is deleted (end of combat); same severity does not stack, it lengthens (minor short->long, major long->full)
- vsMob: no rolls: mob number vs the same DC a crawler would face, usual degrees, no nat 20/1
- unopposed: mob number vs 10 + 2 x Floor
- dyingCrawler: cannot roll; counts as skipped

## combat
- model: No initiative. Round = 5 phases: declare (mobs), react (crawlers), resolve (mobs), action (crawlers), cleanup (everyone). Within a phase the acting side goes together, any order. Tracker 'Next Turn' button is relabelled Next Phase; Previous Turn steps back (does not rerun events/declarations).
- phaseStorage: combat flag carl-rpg.phase (index). Phase change options: carlPrevPhase, carlDirection (forward|back).
- chat: every phase change posts a card (once, from the active GM); entering cleanup refills actions, ticks round-based effect durations/cooldowns, runs round-end events and fires Hooks 'carlrpg.cleanupPhase'
- actions: Generic pool. crawler/pet 2, mob typically 2, elite/boss one per crawler combatant. Using any skill/spell/gear/item/mob ability = 1 action; passive skills free; events/depth>0 free. Pips on tracker (click spends/restores for owners). resetActions at combat start and cleanup. GM Refill Actions button in tracker header (refillActions macro util) keeps bought extra actions and refills Dying crawlers too.
- interrupts: item.system.interrupt true + used in react phase: costs a normal action, sets interruptUsed (bolt on tracker); cleared at cleanup.
- buyAction: crawler spends 1 AI Favor for +1 action this round, once per round per crawler, crawler side only, not Dying; plus button on tracker pips and sheet; whispered to GM; cleared at cleanup.
- declarations: In declare phase GM uses mob ability -> stored (targets chosen via chooseTargets, kept on combat flag declarations {combatantId:[{id, kind ability|move, itemUuid, itemName, note, targets[], resolved}]}). Cap = combatant.maxActions. GM can declare a movement with a note. Announced to chat when react starts (never numbers); resolved in order by the GM client when resolve starts (ability -> item.roll(null,{declared:true}); move -> spends an action and posts); cleared when cleanup starts. Declarations only target tokens on the mob's own scene.
- defeat: mob at 0 health: defeatMob removes from all combats; Crawler-type follows Dying. End-of-combat GM whisper lists defeated, unlooted, loot-bearing mobs from THAT combat; tracker shows the same list with Loot buttons.
- sideOf: mob side = actor type mob; everything else (crawler, pet, mount) crawler side; a summon flag side overrides it (helpers/minion-side.mjs sideOfActor: a raised mob is crawler side)

## dying
- who: crawlers and Crawler-kind mobs
- start: health 0 -> Dying effect lasting max(1, CON mod) rounds; GM whisper with rounds left (public Dying card/message also shown)
- count: -1 at each round end and -1 for every hit that gets through (boxes>0); healing (any, rests included) cancels
- while: no actions (rolls blocked, treated as not rolling on defense); others' healing items still work through events
- death: count hits 0 -> permanent Dead effect, Foundry skull overlay, removed from combat; no public announcement, GM whisper only (sound cue dying)
- revive: GM Revive button in header of dead crawler, or Revive event action

## rests
- who: crawler's own small buttons on sheet (short/long/full), /rest chat command, hotbar macro, Dungeon Info party rests (GM)
- gate: players only in a Safe room unless setting restsOutsideSafeRoom; GM always
- effect: heal/mana per constants.rests.recovery; ends effects whose lastsUntil is that rest or shorter (long ends short+long, full ends all); restores item uses (recharge short/long/full chain); runs restTaken events; cancels Dying via healing

- leveling: GM Level Up button (or players if setting playersCanLevel) raises level by 1 -> 3 stat points per level above 1, banked until floor>=3, then Spend Points dialog: +1 per stat, no cap. Fires Hooks 'carlrpg.levelUp'(actor, newLevel) and levelUp events.
- advancement: skill/spell marked Can Advance: one d20 that must beat the STORED rank (not the effective one); success +1. Rank <=4 any time; rank >=5 shows end-of-floor reminder and allows ONE try per floor (item flag advanceFloor = floor of last try). Capped at skillCap (15, or 20 via skillCap build row). AI Favor is not offered on advancement. Advancement rolls are not logged in recap.
- ammunition: cost rows with resource ammo; see items-effects.md. Spent after Mana/Junk, note lines on the card, change-log line per row, @cost.ammo and @cost.total read it
- uses: system.uses.max>0 limits uses; costs row 'uses' spends; recharge: round (each round end), rounds (every N rounds, cooldown counted by tickCooldowns, or combat end), combat, floor (floorChange), short|long|full rest (longer rests also restore shorter)

## upgrades
- holders: skill, spell (by rank), pet (by level)
- rule: every upgrade with rank <= current rank (the effective rank, see items-effects skillRankBonus) applies, in rank order then listed order; worked out at use/prepare time from current rank, never written (lower the rank and they vanish)
- shape: {id, rank, description, changes[{type, value, stat}], grants[uuids, pets], unlocksEffects[identifier|name], events[]}
- changeFields: every change is {type, value, stat, when, bonusType, bonusAlso, scope}; scope is a damageMultiply change's 'total' or 'base' (blank = total); when is the Roll Modifier condition, bonusType/bonusAlso name damage types for deAddDice and rmDice only (see typedBonus)
- changes: damageAdd (dice/number), damageReplace, dieStep (+/- along dieLadder), manaCost/junkCost/usesCost (move both ends of a ranged cost, floor 0, adds a cost where none), rollBonus, rollTarget (checkTargets id), armorPiercing, damageType, areaShape (the area's shape; last wins)/areaShapeExtra (adds a shape the roll pop-up lets the player pick; the change can carry its own size amount, blank = the area's size, and keep = the area's own shape is placed after it too, e.g. a line that keeps the blast)/areaSizeAdd (feet, negative ok)/areaSizeReplace (amount; drops earlier additions)/splashAdd (feet, negative ok; the splash distance) (area changes are only offered on skills/spells with Area targeting, and only change that skill/spell's own area; on Count targeting only areaShapeExtra is offered (its size is required: the sheet flags a blank one, 'keep' is hidden and ignored), see targeting countArea; splashAdd on Count or Area targeting; effective.areaShape/areaShapes/areaSize/areaSizeDelta/areaExtras (by shape: {size, keep})/splashDelta, first of areaShapes = the shape used without a choice), rankDamageBonus/rankDamageStep (whole numbers, see rankDamage); a Damage Effect's de* changes (see damageEffects); a Roll Modifier's rm* changes (see rollMods); damageMultiply (multiplies the damage, see damageMultiply)
- ui: sheet description lists all upgrades (locked dimmed), chat card lists only unlocked, Attributes tab shows effective values at current rank. Default new ranks 5,10,15,20 (rank editable, any number).

## damageEffects
- file: helpers/damage-effects.mjs (pure rules + cooldown updates); pop-up in roll-dialog.mjs promptRoll({damageEffects}); chosen in item.mjs roll(); worked out in attacks.mjs resolveCheck(item, roll, {damageEffect})
- what: a skill with system.damageEffect.enabled (passive, own rank and upgrades). system.damageEffect.skills lists the attack skills it works with (names, identifiers or #tags, comma separated, case-insensitive; the EFFECT holds the list; see skillLists). A weapon that rolls a skill uses that skill, but its own tags count for a #tag entry. Unarmed Combat is listed by no effect, so it shows no choice.
- choose: roll pop-up (click, depth 0, not a mob, not Shift) shows a Damage Effect menu: None (default) or one effect the actor owns that lists the skill and is off cooldown. At most one per roll. An effect with the stun option adds a tick 'instead of damage' (no damage is rolled; the item's other numbers stand).
- rules (effectRules, folded from the upgrades reached at the effect's own rank; rank 1 is the base text so base changes sit in an upgrade at rank 1; later changes override scalars, addDice adds up):
  - deAddDice: extra dice/number rolled once (crit doubles the dice), added to base damage for each target it works against; @rankDamage reads the EFFECT's rank. A row with a damage type (bonusType, optional bonusAlso) is NOT base damage: it goes to rules.typedDice [{formula, types}] (addDice holds untyped rows only), is rolled once on its own, and for a target it works against becomes a typed part (after deTotalMultiplier: floor(roll x M), then split). deBaseByRank, the Amazing Floor bonus and the filters never touch it
  - deBaseByRank: base dice result x the effect's Rank, then modifiers and buffs are added
  - deTotalMultiplier: (dice + modifiers + extra + Amazing Floor bonus) x M
  - deHealthMax: only targets at or under that percent of Health Bar (value/max x 100)
  - deSameSize, deSizeMax N: target Size Class equal to / at most N above the attacker's (-1 = smaller only)
  - deCooldownHours H | deCooldownRound | deCooldownNone
  - deStunOption 1|0: offer / stop offering the instead-of-damage tick
- perTarget: filters are checked per target; a target that fails them takes the normal damage. Rows store effectApplied. The card headline shows the effect's damage only when it has no filters; the effect's name is always added to the heading when one was chosen. Players DO see the real per-target numbers (decided: no hiding of the multiplier), so a doubled row tells them the target is low.
- debuffs: the effect's own events apply them (applyEffect 'hit' events run for each hit target the effect worked against; 'used' events once). The damageOption condition lets one event run only when the instead-of-damage tick was set. Popularity loss, throwing and Held are description text only.
- cooldown: starts only if the effect changed the attack (it worked against a target that was hit; with no targets, only if it has no filters), not merely when chosen. hours: set to the rank's hours, drop by CONFIG.CARL_RPG.damageEffects.restHours on every rest the crawler takes (restActor, takeRest). round: cleared when Cleanup starts (roundEnd) and when the combat ends. Stale state is ignored (cooldownLeft caps hours at the current rank's cooldown, a round flag only counts while the cooldown is a round one). The owner resets it on the effect's Attributes tab. Observers can start one through the GM relay.
- notes: an effect at rank 0 is still offered but does nothing (its rank 1 base is not reached). AI Favor 'only if no Damage Effect is used' is description text only.

## rollMods
- file: helpers/roll-mods.mjs (pure rules, DR flag helpers); pop-up in roll-dialog.mjs promptRoll({rollMods, surpriseOption}); chosen and resolved in item.mjs roll(); dice worked out in attacks.mjs resolveCheck(item, roll, {modDice}); DR spent in documents/actor.mjs applyDamage
- what: a skill with system.rollMod.enabled (passive, own rank and upgrades). system.rollMod.skills lists the skills it changes (names, identifiers or #tags, comma separated, case-insensitive; see skillLists); the word self lists its own use. A weapon that rolls a skill uses that skill, but its own tags count for a #tag entry. Derived system.rollModRules = modRules(system).
- choose: roll pop-up (click, depth 0, not a mob, not Shift) shows a Roll Modifier menu: None (default) or one modifier the actor owns that lists the skill (never the skill itself). At most one per roll. A Surprise attack tick shows when any modifier in play (offered ones, the self one) has a row conditioned on surprise. Shift, events and macros skip the choice; a self modifier (the rolled skill lists self) still applies to its own use then.
- rules (modRules, folded from the upgrades reached at the modifier's own rank; rank 1 is the base text; rows add up, never replace):
  - rmRank: the modifier's Rank is added to the d20 roll as extra bonus (card badge '<name> +<rank>'); not on an item that does not roll; rank 0 adds nothing
  - rmDice: dice or number added to the damage of each target whose degree meets the row's condition; rolled once per row (natural 20 doubles it like the damage), @rankDamage reads the MODIFIER's rank; only when the rolled item has a damage formula; added after a chosen Damage Effect's multiplier (not multiplied by it); the card headline counts them as for a hit (or the unopposed result); the modifier's name is added to the card heading. A row with a damage type (bonusType, optional bonusAlso) is kept apart as a typed part (see typedBonus); modRules rows carry types only when typed, resolveMods dice rows always have types ([] when untyped)
  - rmDR: DR for the next damage (see tempDR); set when the modifier is used (rolled or not), after costs and the action are paid
  - damageMultiply: a multiplier row on the attacks the modifier is used with (see damageMultiply); modRules.multiply [{value, scope, when}], resolveMods().multipliers keeps those whose roll condition holds; needsMeleeMod tells the pop-up to show the melee tick
- when (per row, optional; allowed ids in CONFIG.CARL_RPG.rollMods.allowed): '' always; disadvantage|advantage = the roll's final mode (after the build's advantage cancels a chosen disadvantage); surprise = the pop-up tick; melee = the pop-up 'At melee range' tick (damageMultiply rows only); hit|amazing|crit|miss = each target's degree (rmDice only; amazing = amazing or critHit, crit = critHit, miss = not a hit). rmRank and rmDR only offer the first four. A change whose condition its kind cannot use is skipped and the sheet warns.
- tempDR: actor flag flags.carl-rpg.tempDR = {modifierItemId: {amount, name}}. A modifier used again replaces its own entry; other modifiers add. applyDamage adds the total to DR and clears the flag. Also cleared at Cleanup (roundEnd) and when the combat ends (events.mjs). An Observer's use is relayed to the GM client (helpers/relay.mjs allows only entries of the actor's own modifiers within the amount their rules can give). Set with updateWithRelay; cleared with the '-=tempDR' key.
- ui: Attributes tab ticks Roll Modifier and lists the skills; the Upgrades tab then offers rmRank/rmDice/rmDR and an 'Only when' menu on those rows (changing a row's kind resets its condition). No cooldown and no events of its own.
- notes: the pop-up menu allows one chosen modifier plus the self one. A rank bonus is shown in the bonus badge too (the combined bonus).

## typedBonus
- file: helpers/damage-types.mjs (rowTypes, rowTypesProblem, splitAmount, damageParts, partsMatter, partsTotal, scaleParts, adjustParts, partsLabel); glue in attacks.mjs resolveCheck (typedFor, damageFor)
- what: Damage Effect deAddDice rows and Roll Modifier rmDice rows can name a damage type from the world list (change.bonusType) and an optional second (change.bonusAlso, only with a first). Blank = untyped = old behaviour (the dice take the attack's type and merge into its damage). A type that has left the list, or a second without a first, makes changeProblem true (row skipped, sheet warns).
- mixed: two types split the row's rolled amount evenly (the first type gets any odd point), each share resolved on its own type. 'Both must be resisted' was NOT chosen.
- parts: per target damageParts(base, attackType, typedRows) = the attack's own damage (with untyped bonus dice and the Amazing Floor) first, then each typed row's shares; same types merge, zero parts drop. Only when parts differ from one plain number of the attack's type (partsMatter) are they stored on the row/card; otherwise damage is exactly the old number.
- rolls: each typed row is rolled once (crit doubles it), its Roll goes into the message rolls. Typed Roll Modifier rows still obey their 'Only when' degree condition per target; typed effect rows follow the effect's per-target filters.
- ui: upgrades.hbs shows a Type menu (blank = the attack's type) on deAddDice/rmDice rows and, once a Type is set, an 'Also' menu. Clearing Type clears Also; changing the change kind clears both. Summary text uses Summary.deAddDiceTyped/rmDiceTyped ('+1d6 Fire & Lightning damage').
- notYet: a skill's own damage cannot be mixed (damageType is one type); mob abilities take no bonus dice, so mob attacks have no parts.

## skillLists
- file: helpers/skill-list.mjs (pure; used by damage-effects.mjs and roll-mods.mjs)
- entries: comma separated, any one matching is enough. A name or Identifier of the skill the roll uses; #tag = any skill with that tag; #a+#b (later # optional) = all those tags. Roll Modifiers also take the word self (skipped for other skills)
- tags: the skill's system.tags plus the used item's (a javelin tagged thrown rolled with Ranged Attacks); both count together, so #thrown+#fire can be met across them. Case-insensitive; tags from the same data as helpers/tags.mjs
- api: listEntries(text), entryTags(entry), listAccepts(entries, skill, item, {skip}); effectAccepts/modAccepts/availableEffects/availableMods take the used item as an extra last argument (CarlRPGItem.roll passes this)

## targeting
- file: helpers/targeting.mjs
- when: every use at depth 0 for non-mob items, after the pop-up (so counts can read @cost), before anything is spent
- modes: none = plain use; count = pick up to N tokens (prompt window stays open while clicking tokens, 'Selected N of M', remove buttons, Select nearest, range warning, range ring around user's token); self = no prompt; area = place a Foundry measured template (circle|cone|ray|rect) with live 'N tokens inside' (the shape and size are the effective ones after upgrades; the shape picked in the roll pop-up when there are several); if player cannot create templates the GM confirms
- range: an amount in feet (number or formula over roll data, no dice, same data as count/size, incl. @rank and @cost) or melee/touch (5 ft) or unlimited; blank, 0 or less = no limit. rangeInfo(text, data) in helpers/amounts.mjs returns {kind none|melee|touch|unlimited|feet|pending|invalid, feet}; item.rangeInfo() reads it with the item's costData. Count mode marks targets beyond it 'out of range'; area mode warns when the template origin is placed beyond it (still goes ahead). Shown as a Range badge (so in tooltips too) for count/area items, and under the Range field on the sheet when it is a formula; an unreadable range is flagged like other bad formulas
- filter: enemies|allies|any (at least one target required unless self/area)
- mobAbilities: GM gets same prompt when declaring; targets stored with the declaration
- splash: file helpers/splash.mjs (pure geometry + the last placement's splash tokens), distance helper splashReach in helpers/area-plan.mjs. Area and Count items. Distance = targeting.splash (amount, feet) + the splashAdd upgrades (effective.splashDelta), never below 0. Area: extra distance beyond the placed area's edge (any shape: distance from the token centre to the template shape, same centre test as inside). Count: distance around each chosen target (straight line between token centres, splashAround). targeting.splashDamage = dice formula (blank = no damage); targeting.splashEffects = tick.
  - placement: tokens outside the area, within reach of its edge, passing the filter and visible, are targeted too and noted (noteArea) by token UUID; a token inside any of the item's areas is never splash; the area's limit counts only tokens inside. Area card lists them tagged (splash); its Apply buttons show for them only with splashEffects. Lasting-area round cards do not include splash.
  - countPlacement: after the target prompt is confirmed (targeting.mjs addCountSplash, also for a mob ability being declared) the visible tokens passing the filter within reach of any chosen target are added to the user's targets and noted (noteArea) as splash; a chosen target is never splash; no area card is posted (the attack card tags the rows 'Splash'). Fear (enemies, splashEffects, no splash damage): each creature within the blast radius runs its own check and the hit events at its own degree.
  - roll: item.roll takes the splash (depth 0) and passes it to resolveCheck. Splash targets share the one d20 and get their own degree against their own Evade/stat. A splash row has splash:true and damage = splash formula rolled once (natural 20 doubles its dice; Amazing adds the Floor; a blank formula = 0). No Damage Effect and no Roll Modifier dice on splash rows. Splash damage needs the item to have damage. The card tags the row 'Splash'; a splash row with 0 damage has no Apply buttons.
  - events: without splashEffects splash rows are left out of hit/miss events, of the degrees the used events read, and of the 'targeted' group (item.mjs passes ctx.targeted = the targets inside the area); with it they count like any target.
  - mob abilities: the splash is stored on the declaration targets (splash:true) and put back (setSplash) when it resolves; resolveMobCheck rolls the splash once (no crits); a crawler defends against the same number; the row's damage is the splash formula through mobDamage; stored on the card as attack.splashDamage.
  - badge: Splash N ft (upgrades included) on Count and Area items.
- areaSteps: helpers/area-plan.mjs areaSteps(cfg, effective, chosenShape, data) = what one area puts down, in order. The shape picked (or the item's own) at the area size (size amount + areaSizeDelta). A shape added by areaShapeExtra with a size of its own uses that size exactly (areaSizeAdd does not change it; a blank or unreadable size = the area size); with keep, the item's own shape and size follow as a second template ('Now place the X too'). A shape not in effective.areaShapes is ignored. The roll pop-up labels a keeping shape like 'Line + Circle'. For a Count item (cfg.mode count) only a shape in countAreaShapes gives a step (its own size, never keeping a base); no choice, 'single' or an unoffered shape gives []. Every template's tokens (and splash) are combined; a token counts once. Items with 'areas per use' repeat all the steps for each area.
- countArea: a Count item (Ice Blast, Thunderlash: 15 ft cone from rank 15; Lightning Bolt: 100 ft line from rank 10) with areaShapeExtra upgrades can be used as an area. helpers/area-plan.mjs countAreaShapes(cfg, effective) = the keys of effective.areaExtras when mode is count (else []), SINGLE_TARGET = 'single' (the pop-up id of the item's own use), originAtCaster(distance, tokenFeet). Pop-up (item.mjs roll): 'Single target' + 'Shape N ft' per shape; picking a shape makes chooseTargets (targeting.mjs) call chooseArea instead of the token prompt. Same damage, cost, action and check as single target; the one d20 is rolled against every creature inside (each its own Evade/stat) like an Area item. The area version: one template (areas 1, limit 0 = everything inside, not lasting; Count Range, Count count and the Area-only fields are not used), origin should be at the caster (warning if more than a grid square beyond the caster token's edge, no Range check), the caster's own token is never inside or in the splash, filter applies. Splash = the item's Splash + splashAdd upgrades measured from the template edge (splashDamage/splashEffects as for an Area item); the single-target version keeps splash around each pick. Before the rank, or with Shift, or for gear/items and mob abilities, nothing changes.
- lastingAreas: lasts N rounds (an amount: number or formula over roll data via lastsRounds in helpers/area-plan.mjs, e.g. Confusing Fog 2 + 4 * min(1, floor(@rank / 5)) + ...; 0 = until GM removes), template tinted by kind (fire|difficult|poison), card posted on placement and each round end with Apply buttons per token and effect; nothing applied automatically, no movement penalty
- result: picks become the user's Foundry targets, so attacks read game.user.targets

- tags: helpers/tags.mjs: sameTag/itemHasTag/classHasTag, case-insensitive; used by prerequisites (classTag), item requirements, event conditions, skillCap scope, wizard skill pool. Tag manager/suggestions read world AND compendium items.
- damageTypes: helpers/damage-types.mjs: world setting damageTypes (comma list). Items carry damageType + armorPiercing (upgrades can set). Effects carry damageMods.
- hotlistOnlySpells: optional world rule: crawlers may only directly cast spells on their hotlist (GM and event/macro casts exempt; skills and items unaffected)
- aiFavor: crawler resource. Spend 1 to reroll a d20 before the result shows (item rolls, stat checks, defending rolls; not nat 20/1; shows the roll but not success). Or buy an action. GM award: Dungeon Info Award AI Favor, /aifavor, event action.
- skillGrants: Skills an item added record flags.carl-rpg.grantedBy [item ids] and raised. On item removal a granted skill is removed only if no other item still grants it and its rank is not above what it was given (raised flag). Whisper notice to owner+GM. Grant a skill action and advancement set raised (permanent).
