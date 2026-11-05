# rules

## useFlow
- entry: CarlRPGItem.roll(event, {depth, declared}) in documents/item.mjs
- order:
  - 1 Mob ability in Mobs Declare phase (depth 0, not declared, no Shift): declareInsteadOfUsing -> stored as a declaration, returns
  - 2 Dying actor cannot act (warn)
  - 3 hotlistOnlySpells setting: spell must be on hotlist (depth 0, GM exempt)
  - 4 checkRequirements(item): warns every unmet requirement
  - 5 uses: needs spans.uses.min uses left
  - 6 roll pop-up (click only; Shift skips; not for events/macros/mobs): extra bonus (number|dice), stat change, advantage/disadvantage, amount to pay for ranged costs (capped at what user has; Shift pays least)
  - 7 build benefits (advantage, per-stat skill bonus) applied to every roll
  - 8 chooseTargets(item, costData) for non-mob depth 0 (mode count/area; self = no prompt)
  - 9 claim an action in combat (passive skills and depth>0 free; none left -> confirm 'use anyway')
  - 10 weapon whose skill is gone cannot roll (whispers GM)
  - 11 pay Mana/Junk (short -> confirm; 'anyway' spends all remaining, never below 0)
  - 12 spend the action; Interrupt in react phase sets combatant flag interruptUsed
  - 13 spend uses
  - 14 _rollCore: card with item header (image, name, badges), short description (full expander), reached upgrades; roll posted; AI Favor reroll offered (not on nat 20/1, not to non-crawlers)
  - 15 resolveCheck: degree vs each target (or Floor DC), damage roll, attack card with buttons
  - 16 events: rolling skill's 'used', item 'used', per hit 'hit', per miss 'miss'; summaries collected into attack message flags.carl-rpg.attack.fired (GM-only line)

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
  - crawler/pet: net = max(amount - dr.total, 0); boxes = floor(net / health.perBox) (leftover below a box is lost); health.value -= boxes (min 0); posts a damage card
  - mob: net = max(amount - drTotal, 0); health.value -= net
  - after: hurtWhileDying (boxes>0), runActorEvents takesDamage
  - health reaching 0 (GM client): crawler/Crawler-mob -> startDying; other mob -> defeatMob; >0 -> cancelDying
- attackCardButtons: carl-apply-damage with multiplier x2 / x1 / x0.5 (GM), carl-undo-damage per target (restores exact boxes lost, clears Dying it caused, once), carl-apply-effect per target+effect (GM), carl-mob-roll (crawler rolls defense or skips)
- noTargets: unopposed check still shows result; damage applies to whatever the GM has targeted when clicked
- crit: doubles damage dice before stats/buffs

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
- uses: system.uses.max>0 limits uses; costs row 'uses' spends; recharge: round (each round end), rounds (every N rounds, cooldown counted by tickCooldowns, or combat end), combat, floor (floorChange), short|long|full rest (longer rests also restore shorter)

## upgrades
- holders: skill, spell (by rank), pet (by level)
- rule: every upgrade with rank <= current rank applies, in rank order then listed order; worked out at use/prepare time from current rank, never written (lower the rank and they vanish)
- shape: {id, rank, description, changes[{type, value, stat}], grants[uuids, pets], unlocksEffects[identifier|name], events[]}
- changes: damageAdd (dice/number), damageReplace, dieStep (+/- along dieLadder), manaCost/junkCost/usesCost (move both ends of a ranged cost, floor 0, adds a cost where none), rollBonus, rollTarget (checkTargets id), armorPiercing, damageType
- ui: sheet description lists all upgrades (locked dimmed), chat card lists only unlocked, Attributes tab shows effective values at current rank. Default new ranks 5,10,15,20 (rank editable, any number).

## targeting
- file: helpers/targeting.mjs
- when: every use at depth 0 for non-mob items, after the pop-up (so counts can read @cost), before anything is spent
- modes: none = plain use; count = pick up to N tokens (prompt window stays open while clicking tokens, 'Selected N of M', remove buttons, Select nearest, range warning, range ring around user's token); self = no prompt; area = place a Foundry measured template (circle|cone|ray|rect) with live 'N tokens inside'; if player cannot create templates the GM confirms
- filter: enemies|allies|any (at least one target required unless self/area)
- mobAbilities: GM gets same prompt when declaring; targets stored with the declaration
- lastingAreas: lasts N rounds (0 = until GM removes), template tinted by kind (fire|difficult|poison), card posted on placement and each round end with Apply buttons per token and effect; nothing applied automatically, no movement penalty
- result: picks become the user's Foundry targets, so attacks read game.user.targets

- tags: helpers/tags.mjs: sameTag/itemHasTag/classHasTag, case-insensitive; used by prerequisites (classTag), item requirements, event conditions, skillCap scope, wizard skill pool. Tag manager/suggestions read world AND compendium items.
- damageTypes: helpers/damage-types.mjs: world setting damageTypes (comma list). Items carry damageType + armorPiercing (upgrades can set). Effects carry damageMods.
- hotlistOnlySpells: optional world rule: crawlers may only directly cast spells on their hotlist (GM and event/macro casts exempt; skills and items unaffected)
- aiFavor: crawler resource. Spend 1 to reroll a d20 before the result shows (item rolls, stat checks, defending rolls; not nat 20/1; shows the roll but not success). Or buy an action. GM award: Dungeon Info Award AI Favor, /aifavor, event action.
- skillGrants: Skills an item added record flags.carl-rpg.grantedBy [item ids] and raised. On item removal a granted skill is removed only if no other item still grants it and its rank is not above what it was given (raised flag). Whisper notice to owner+GM. Grant a skill action and advancement set raised (permanent).
