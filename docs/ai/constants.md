# constants

- note: CONFIG.CARL_RPG from module/helpers/config.mjs. Edit there, not here.
- abilities: str, int, con, dex, cha
- statModifier: getStatModifier(v): v<=2->1, <=5->2, <=9->3, <=19->4, <=49->5, <=99->6, <=149->7, <=199->8, <=299->9, else 10

## gearSlots
- head: 1
- torso: 1
- arms: 1
- hands: 2
- legs: 1
- feet: 1
- accessory: 10
- note: value = max equipped per slot; hands slot is labelled Held in UI and has 2 places (two-handed gear takes both); equipping without room prompts what to swap out (helpers/gear-slots.mjs planEquip)

## levelUp
- pointsPerLevel: 3
- spendFloor: 3

- originFloor: 3
- mobTypes: basic, elite, boss, crawler
- mobTypesPerCrawler: elite, boss

## creation
- standardArray: 2, 3, 4, 5, 6
- statRoll:
  - die: 6
  - rerollBelow: 2
  - delayMs: 2000
- statMethods: standardArray, roll
- skillsPerGroup: 2
- skillGroups:
  - id=childhood; rank=1
  - id=adolescence; rank=1
  - id=hobby; rank=2
  - id=career; rank=3
- weaponRank: 3

- raceCategories: earthBased, alien
- classCategories: Arcanist, Barbarian, Bard, Cleric, Druid, Fighter, Mage, Monk, Paladin, Rogue
- prerequisiteTypes: stat, skillRank, level, race, raceCategory, achievement, classTag

## sizes
- order: tiny, small, petite, medium, large, huge, colossal, gargantuan
- sizeClass: index+1 (tiny 1 .. gargantuan 8); UI shows 'Medium (4)'

- combatPhases:
  - id=declare; side=mob
  - id=react; side=crawler
  - id=resolve; side=mob
  - id=action; side=crawler
  - id=cleanup; side=all

## checks
- base: 10
- unopposedFloorFactor: 2
- statCheckFloorFactor: 1

- checkTargets: unopposed, evade, str, int, con, dex, cha, size
- attackDegrees: critHit, amazing, success, nearMiss, fail, majorFail, critFail
- damageRounding: floor
- defaultDamageTypes: Physical, Slashing, Piercing, Bludgeoning, Fire, Cold, Lightning, Poison, Acid, Necrotic, Psychic
- damageModes: resist, immune, vulnerable

## rests
- kinds: short, long, full
- recovery:
  - short:
    - health: 5
    - mana: half of total, rounded down
  - long:
    - health: full
    - mana: full
  - full:
    - health: full
    - mana: full

## injuries
- minor:
  - penaltyAllStats: -2
  - duration: short
  - upgradedDuration: long
- major:
  - penaltyAllStats: -5
  - duration: long
  - upgradedDuration: full

- effectKinds: buff, debuff, passive
- maxActiveBuffs: 3
- effectDurations: , short, long, full, combat
- usesRecharge: never, round, rounds, combat, floor, short, long, full

## lootTiers
- bronze: 1d10
- silver: (1d10)*100
- gold: (1d10)*1000
- platinum: (2d6)*1000
- legendary: (1d10)*10000
- celestial: 0
- note: value = default gold formula; a box may override

## upgrades
- defaultRanks: 5, 10, 15, 20
- rankStep: 5
- dieLadder: 4, 6, 8, 10, 12, 20
- changes: damageAdd, damageReplace, dieStep, manaCost, junkCost, usesCost, rollBonus, rollTarget, armorPiercing, damageType, rankDamageBonus, rankDamageStep, areaShape, areaShapeExtra, areaSizeAdd, areaSizeReplace, splashAdd, deAddDice, deBaseByRank, deTotalMultiplier, deHealthMax, deSameSize, deSizeMax, deCooldownHours, deCooldownRound, deCooldownNone, deStunOption, rmRank, rmDice, rmDR
- change rows also carry when (string, default ''): the 'Only when' condition of a Roll Modifier change
- change rows also carry size (string, default '') and keep (bool): an areaShapeExtra change's own size amount and whether the area's own shape is placed too
- areaOnly: areaShape, areaShapeExtra, areaSizeAdd, areaSizeReplace (offered on Area targeting); countArea: areaShapeExtra (the only areaOnly change also offered on Count targeting: the item's area version); splashOnly: splashAdd (offered on Count or Area targeting)
- damageEffectOnly: the de* changes above; the Upgrades tab offers them only on a skill that is a Damage Effect
- rollModOnly: rmRank, rmDice, rmDR; offered only on a skill that is a Roll Modifier

## rollMods
- self: the word 'self' in a modifier's skill list means its own use
- when: ids '' (always), disadvantage, advantage, surprise, hit, amazing, crit, miss
- allowed: rmRank and rmDR: '', disadvantage, advantage, surprise; rmDice: all of them

## damageEffects
- restHours: short 1, long 8, full 24 (game hours a rest passes for Damage Effect cooldowns; there is no game clock)

## petUpgrades
- defaultLevel: 15
- levelStep: 5
- changes: statBonus, sizeStep, dr, evade, move, mana, actions

## skillCap
- default: 15
- boosted: 20
- scopes: all, skill, tag (also the scope of skillRankBonus, rankDamageBonus and rankDamageStep rows)

## rankDamage
- table: rows {from, formula} in config rankDamage; rank 1 = 1, 2-3 = 1d2, 4-5 = 1d4, 6-7 = 1d6, 8-9 = 1d8, 10-11 = 1d10, 12-13 = 1d12, 14-15 = 1d8 + 1d6, 16-17 = 2d8, 18-19 = 1d10 + 1d8, 20+ = 2d10; rank 0 = nothing
- ladder: the same rows are what a row step moves along

- maxEventDepth: 5

## compendiumPurposes
- achievements: achievement
- races: race
- species: species
- classes: class+subclass
- backgrounds: background
- skills: skill
- mobs: Actor type mob

## systemAnnouncementKinds
- died: no banner, needs crawler
- boss: banner
- stairs: banner
- floor: banner
- general: no banner

- soundCues: boss, natural, dying, achievement, loot
- buildKinds: checkDie, healthStat, statCap, skillCap, skillRankBonus, rankDamageBonus, rankDamageStep
- effectModifierKeys: str, int, con, dex, cha, dr, evade, move, surprise, mana, hotlist, actions, seeValues, sortValue, step, classCombo, advStr..advCha, skillStr..skillCha
- itemRequirementTypes: mana, stat, gold, actions, classTag
