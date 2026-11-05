# constants

- note: CONFIG.CARL_RPG from module/helpers/config.mjs. Edit there, not here.
- abilities: str, int, con, dex, cha
- statModifier: getStatModifier(v): v<=2->1, <=5->2, <=9->3, <=19->4, <=49->5, <=99->6, <=149->7, <=199->8, <=299->9, else 10

## gearSlots
- head: 1
- torso: 1
- arms: 1
- hands: 1
- legs: 1
- feet: 1
- accessory: 10
- note: value = max equipped per slot; hands slot is labelled Held in UI; equipping into a full slot prompts which to swap

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
- defaultDamageTypes: Physical, Fire, Cold, Lightning, Poison, Acid, Necrotic, Psychic
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
- changes: damageAdd, damageReplace, dieStep, manaCost, junkCost, usesCost, rollBonus, rollTarget, armorPiercing, damageType

## petUpgrades
- defaultLevel: 15
- levelStep: 5
- changes: statBonus, sizeStep, dr, evade, move, mana, actions

## skillCap
- default: 15
- boosted: 20
- scopes: all, skill, tag

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
- buildKinds: checkDie, healthStat, statCap, skillCap
- effectModifierKeys: str, int, con, dex, cha, dr, evade, move, surprise, mana, hotlist, actions, seeValues, sortValue, step, classCombo, advStr..advCha, skillStr..skillCha
- itemRequirementTypes: mana, stat, gold, actions, classTag
