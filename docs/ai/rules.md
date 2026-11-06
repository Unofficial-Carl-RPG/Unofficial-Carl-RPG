# rules

## useFlow
- entry: CarlRPGItem.roll(event, {depth, declared}) in documents/item.mjs
- order:
  - 1 Mob ability in Mobs Declare phase (depth 0, not declared, no Shift): declareInsteadOfUsing -> stored as a declaration, returns
  - 2 Dying actor cannot act (warn)
  - 3 hotlistOnlySpells setting: spell must be on hotlist (depth 0, GM exempt)
  - 4 checkRequirements(item): warns every unmet requirement
  - 5 uses: needs spans.uses.min uses left
  - 6 roll pop-up (click only; Shift skips; not for events/macros/mobs): extra bonus (number|dice), stat change, advantage/disadvantage, Damage Effect (see damageEffects), Roll Modifier menu + Surprise tick (see rollMods), amount to pay for ranged costs (capped at what user has; Shift pays least)
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
- applyDamage(amount, {ignoreDR, damageType}):
  - damage type: effects with damageMods halve (resist), zero (immune) or double (vulnerable)
  - crawler/pet: net = max(amount - (dr.total + held Roll Modifier DR), 0); boxes = floor(net / health.perBox) (leftover below a box is lost); health.value -= boxes (min 0); posts a damage card
  - mob: net = max(amount - (drTotal + held Roll Modifier DR), 0); health.value -= net
  - held Roll Modifier DR (flag tempDR) is added for this damage and then cleared, even when ignoreDR skips it; see rollMods
  - after: hurtWhileDying (boxes>0), runActorEvents takesDamage
  - health reaching 0 (GM client): crawler/Crawler-mob -> startDying; other mob -> defeatMob; >0 -> cancelDying
- attackCardButtons: carl-apply-damage with multiplier x2 / x1 / x0.5 (GM), carl-undo-damage per target (restores exact boxes lost, clears Dying it caused, once), carl-apply-effect per target+effect (GM), carl-mob-roll (crawler rolls defense or skips)
- noTargets: unopposed check still shows result; damage applies to whatever the GM has targeted when clicked
- crit: doubles damage dice before stats/buffs

## rankDamage
- token: @rankDamage in a damage formula = the dice for the rank (table in constants.md). Skill, spell and mobAbility read their own rank (a pet's skills: the floor); gear/item that roll with a skill read that skill's rank for both their own and the skill's damage. Anything else, rank 0 or no item = 0. File helpers/rank-damage.mjs.
- when: expanded to plain dice right before the damage Roll: attacks.mjs resolveCheck and resolveMobCheck (expandRankDamage(effectiveOf(item).damage, item)); a weapon's joined weapon+skill damage is expanded in item.mjs #useRollingSkill with the skill. effective.damage and the sheets keep the raw token (like @str.mod).
- moves: rank bonus (added to the rank, then the table is read) then row step (rows along the table; below the first row = nothing, past the last = 2d10). Sources: skill/spell upgrade changes rankDamageBonus / rankDamageStep (effective.rankBonus / rankStep, not applied to the stored damage) plus the owner's effect buildMods rows of the same kinds whose scope (all|skill|tag, as skillCap) covers the item; all add up. Rank 0 ignores them.
- dice: a natural 20 doubles the dice but not the flat 1 of rank 1; dieStep upgrades do not change the rank dice; a multi-term result is wrapped in parentheses after - * /; @rankDamageX and @rankDamage.x are not the token.

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
- sideOf: mob side = actor type mob; everything else (crawler, pet, mount) crawler side

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
- advancement: skill/spell marked Can Advance: one d20 that must beat current rank; success +1. Rank <=4 any time; rank >=5 shows end-of-floor reminder and allows ONE try per floor (item flag advanceFloor = floor of last try). Capped at skillCap (15, or 20 via skillCap build row). AI Favor is not offered on advancement. Advancement rolls are not logged in recap.
- ammunition: cost rows with resource ammo; see items-effects.md. Spent after Mana/Junk, note lines on the card, change-log line per row, @cost.ammo and @cost.total read it
- uses: system.uses.max>0 limits uses; costs row 'uses' spends; recharge: round (each round end), rounds (every N rounds, cooldown counted by tickCooldowns, or combat end), combat, floor (floorChange), short|long|full rest (longer rests also restore shorter)

## upgrades
- holders: skill, spell (by rank), pet (by level)
- rule: every upgrade with rank <= current rank applies, in rank order then listed order; worked out at use/prepare time from current rank, never written (lower the rank and they vanish)
- shape: {id, rank, description, changes[{type, value, stat}], grants[uuids, pets], unlocksEffects[identifier|name], events[]}
- changes: damageAdd (dice/number), damageReplace, dieStep (+/- along dieLadder), manaCost/junkCost/usesCost (move both ends of a ranged cost, floor 0, adds a cost where none), rollBonus, rollTarget (checkTargets id), armorPiercing, damageType, rankDamageBonus/rankDamageStep (whole numbers, see rankDamage); a Damage Effect's de* changes (see damageEffects); a Roll Modifier's rm* changes (see rollMods)
- ui: sheet description lists all upgrades (locked dimmed), chat card lists only unlocked, Attributes tab shows effective values at current rank. Default new ranks 5,10,15,20 (rank editable, any number).

## damageEffects
- file: helpers/damage-effects.mjs (pure rules + cooldown updates); pop-up in roll-dialog.mjs promptRoll({damageEffects}); chosen in item.mjs roll(); worked out in attacks.mjs resolveCheck(item, roll, {damageEffect})
- what: a skill with system.damageEffect.enabled (passive, own rank and upgrades). system.damageEffect.skills lists the attack skills it works with (names, identifiers or #tags, comma separated, case-insensitive; the EFFECT holds the list; see skillLists). A weapon that rolls a skill uses that skill, but its own tags count for a #tag entry. Unarmed Combat is listed by no effect, so it shows no choice.
- choose: roll pop-up (click, depth 0, not a mob, not Shift) shows a Damage Effect menu: None (default) or one effect the actor owns that lists the skill and is off cooldown. At most one per roll. An effect with the stun option adds a tick 'instead of damage' (no damage is rolled; the item's other numbers stand).
- rules (effectRules, folded from the upgrades reached at the effect's own rank; rank 1 is the base text so base changes sit in an upgrade at rank 1; later changes override scalars, addDice adds up):
  - deAddDice: extra dice/number rolled once (crit doubles the dice), added to base damage for each target it works against; @rankDamage reads the EFFECT's rank
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
  - rmDice: dice or number added to the damage of each target whose degree meets the row's condition; rolled once per row (natural 20 doubles it like the damage), @rankDamage reads the MODIFIER's rank; only when the rolled item has a damage formula; added after a chosen Damage Effect's multiplier (not multiplied by it); the card headline counts them as for a hit (or the unopposed result); the modifier's name is added to the card heading
  - rmDR: DR for the next damage (see tempDR); set when the modifier is used (rolled or not), after costs and the action are paid
- when (per row, optional; allowed ids in CONFIG.CARL_RPG.rollMods.allowed): '' always; disadvantage|advantage = the roll's final mode (after the build's advantage cancels a chosen disadvantage); surprise = the pop-up tick; hit|amazing|crit|miss = each target's degree (rmDice only; amazing = amazing or critHit, crit = critHit, miss = not a hit). rmRank and rmDR only offer the first four. A change whose condition its kind cannot use is skipped and the sheet warns.
- tempDR: actor flag flags.carl-rpg.tempDR = {modifierItemId: {amount, name}}. A modifier used again replaces its own entry; other modifiers add. applyDamage adds the total to DR and clears the flag. Also cleared at Cleanup (roundEnd) and when the combat ends (events.mjs). An Observer's use is relayed to the GM client (helpers/relay.mjs allows only entries of the actor's own modifiers within the amount their rules can give). Set with updateWithRelay; cleared with the '-=tempDR' key.
- ui: Attributes tab ticks Roll Modifier and lists the skills; the Upgrades tab then offers rmRank/rmDice/rmDR and an 'Only when' menu on those rows (changing a row's kind resets its condition). No cooldown and no events of its own.
- notes: the pop-up menu allows one chosen modifier plus the self one. A rank bonus is shown in the bonus badge too (the combined bonus).

## skillLists
- file: helpers/skill-list.mjs (pure; used by damage-effects.mjs and roll-mods.mjs)
- entries: comma separated, any one matching is enough. A name or Identifier of the skill the roll uses; #tag = any skill with that tag; #a+#b (later # optional) = all those tags. Roll Modifiers also take the word self (skipped for other skills)
- tags: the skill's system.tags plus the used item's (a javelin tagged thrown rolled with Ranged Attacks); both count together, so #thrown+#fire can be met across them. Case-insensitive; tags from the same data as helpers/tags.mjs
- api: listEntries(text), entryTags(entry), listAccepts(entries, skill, item, {skip}); effectAccepts/modAccepts/availableEffects/availableMods take the used item as an extra last argument (CarlRPGItem.roll passes this)

## targeting
- file: helpers/targeting.mjs
- when: every use at depth 0 for non-mob items, after the pop-up (so counts can read @cost), before anything is spent
- modes: none = plain use; count = pick up to N tokens (prompt window stays open while clicking tokens, 'Selected N of M', remove buttons, Select nearest, range warning, range ring around user's token); self = no prompt; area = place a Foundry measured template (circle|cone|ray|rect) with live 'N tokens inside'; if player cannot create templates the GM confirms
- range: an amount in feet (number or formula over roll data, no dice, same data as count/size, incl. @rank and @cost) or melee/touch (5 ft) or unlimited; blank, 0 or less = no limit. rangeInfo(text, data) in helpers/amounts.mjs returns {kind none|melee|touch|unlimited|feet|pending|invalid, feet}; item.rangeInfo() reads it with the item's costData. Count mode marks targets beyond it 'out of range'; area mode warns when the template origin is placed beyond it (still goes ahead). Shown as a Range badge (so in tooltips too) for count/area items, and under the Range field on the sheet when it is a formula; an unreadable range is flagged like other bad formulas
- filter: enemies|allies|any (at least one target required unless self/area)
- mobAbilities: GM gets same prompt when declaring; targets stored with the declaration
- lastingAreas: lasts N rounds (0 = until GM removes), template tinted by kind (fire|difficult|poison), card posted on placement and each round end with Apply buttons per token and effect; nothing applied automatically, no movement penalty
- result: picks become the user's Foundry targets, so attacks read game.user.targets

- tags: helpers/tags.mjs: sameTag/itemHasTag/classHasTag, case-insensitive; used by prerequisites (classTag), item requirements, event conditions, skillCap scope, wizard skill pool. Tag manager/suggestions read world AND compendium items.
- damageTypes: helpers/damage-types.mjs: world setting damageTypes (comma list). Items carry damageType + armorPiercing (upgrades can set). Effects carry damageMods.
- hotlistOnlySpells: optional world rule: crawlers may only directly cast spells on their hotlist (GM and event/macro casts exempt; skills and items unaffected)
- aiFavor: crawler resource. Spend 1 to reroll a d20 before the result shows (item rolls, stat checks, defending rolls; not nat 20/1; shows the roll but not success). Or buy an action. GM award: Dungeon Info Award AI Favor, /aifavor, event action.
- skillGrants: Skills an item added record flags.carl-rpg.grantedBy [item ids] and raised. On item removal a granted skill is removed only if no other item still grants it and its rank is not above what it was given (raised flag). Whisper notice to owner+GM. Grant a skill action and advancement set raised (permanent).
