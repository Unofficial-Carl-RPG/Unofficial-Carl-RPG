export const CARL_RPG = {};

/**
 * The set of Ability Scores used within the system.
 * @type {Object}
 */
CARL_RPG.abilities = {
  str: 'CARL_RPG.Ability.Str.long',
  int: 'CARL_RPG.Ability.Int.long',
  con: 'CARL_RPG.Ability.Con.long',
  dex: 'CARL_RPG.Ability.Dex.long',
  cha: 'CARL_RPG.Ability.Cha.long',
};

/**
 * The equipment slots a piece of gear can occupy (from the character sheet).
 * @type {Object}
 */
CARL_RPG.gearSlots = {
  head: 'CARL_RPG.Item.Gear.Slots.head',
  torso: 'CARL_RPG.Item.Gear.Slots.torso',
  arms: 'CARL_RPG.Item.Gear.Slots.arms',
  hands: 'CARL_RPG.Item.Gear.Slots.hands',
  legs: 'CARL_RPG.Item.Gear.Slots.legs',
  feet: 'CARL_RPG.Item.Gear.Slots.feet',
  accessory: 'CARL_RPG.Item.Gear.Slots.accessory',
};

/**
 * How many pieces of gear can be equipped in each slot at once (from the
 * character sheet: one each for the body slots, up to 10 accessories).
 * @type {Object<string, number>}
 */
CARL_RPG.gearSlotLimits = {
  head: 1,
  torso: 1,
  arms: 1,
  hands: 1,
  legs: 1,
  feet: 1,
  accessory: 10,
};

/**
 * Leveling up. A crawler earns `pointsPerLevel` stat points for every level
 * above 1; the points can only be spent once the floor reaches `spendFloor`
 * (until then they are banked).
 */
CARL_RPG.levelUp = {
  pointsPerLevel: 3,
  spendFloor: 3,
};

/**
 * Races and classes. They are chosen on `originFloor` (race first, then class);
 * players can't take one before then. Each race has one or more categories, and
 * a prerequisite can ask for "a race of this category".
 */
CARL_RPG.originFloor = 3;

/**
 * Kinds of mob. Basic mobs are the normal kind. Elites and bosses get one action
 * per crawler in the encounter (see documents/combatant.mjs). A crawler mob is
 * just like a basic mob but shows Crawler Killer skulls (see
 * helpers/crawler-number.mjs).
 */
CARL_RPG.mobTypes = {
  basic: 'CARL_RPG.MobTypes.basic',
  elite: 'CARL_RPG.MobTypes.elite',
  boss: 'CARL_RPG.MobTypes.boss',
  crawler: 'CARL_RPG.MobTypes.crawler',
};
/** The mob kinds that get one action per crawler in the encounter. */
CARL_RPG.mobTypesPerCrawler = ['elite', 'boss'];

/**
 * Character creation (see helpers/creation.mjs). Stats come from the standard
 * array; skills are picked in pairs, each group starting at its rank; a weapon
 * grants its first skill at `weaponRank`.
 */
CARL_RPG.creation = {
  standardArray: [2, 3, 4, 5, 6],
  // Roll For Stats: each stat is 1d6, re-rolling 1s, one stat at a time in order.
  statRoll: { die: 6, rerollBelow: 2, delayMs: 2000 },
  statMethods: {
    standardArray: 'CARL_RPG.Creation.Methods.standardArray',
    roll: 'CARL_RPG.Creation.Methods.roll',
  },
  skillsPerGroup: 2,
  skillGroups: [
    { id: 'childhood', rank: 1 },
    { id: 'adolescence', rank: 1 },
    { id: 'hobby', rank: 2 },
    { id: 'career', rank: 3 },
  ],
  weaponRank: 3,
};
CARL_RPG.raceCategories = {
  earthBased: 'CARL_RPG.Origin.Categories.earthBased',
  alien: 'CARL_RPG.Origin.Categories.alien',
};

/**
 * Tags. Any item can carry a list of regular tags (`system.tags`), and rules
 * can ask for them (a prerequisite, an item requirement, an event condition...).
 * A tag is just text, matched ignoring case. Classes also have categories
 * (`system.categories`): a separate list, with the suggested ones below plus
 * custom ones, that counts as tags too, so a rule asking for the tag "Fighter"
 * matches a class with that category. See helpers/tags.mjs.
 */
CARL_RPG.classCategories = [
  'Arcanist',
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Mage',
  'Monk',
  'Paladin',
  'Rogue',
];

/** What a race or class can require of a crawler (all must be met). */
CARL_RPG.prerequisiteTypes = {
  stat: 'CARL_RPG.Origin.Prereq.stat',
  skillRank: 'CARL_RPG.Origin.Prereq.skillRank',
  level: 'CARL_RPG.Origin.Prereq.level',
  race: 'CARL_RPG.Origin.Prereq.race',
  raceCategory: 'CARL_RPG.Origin.Prereq.raceCategory',
  achievement: 'CARL_RPG.Origin.Prereq.achievement',
  classTag: 'CARL_RPG.Origin.Prereq.classTag',
};

/**
 * The event system. Items hold events (a trigger, optional conditions and an
 * ordered list of actions); everything is picked from these menus. See
 * helpers/events.mjs for how they run.
 */
CARL_RPG.eventTriggers = {
  used: 'CARL_RPG.Events.Triggers.used',
  added: 'CARL_RPG.Events.Triggers.added',
  removed: 'CARL_RPG.Events.Triggers.removed',
  equipped: 'CARL_RPG.Events.Triggers.equipped',
  unequipped: 'CARL_RPG.Events.Triggers.unequipped',
  phaseStart: 'CARL_RPG.Events.Triggers.phaseStart',
  phaseEnd: 'CARL_RPG.Events.Triggers.phaseEnd',
  // The end of the round is when the Cleanup phase starts.
  roundEnd: 'CARL_RPG.Events.Triggers.roundEnd',
  opened: 'CARL_RPG.Events.Triggers.opened',
  actionSpent: 'CARL_RPG.Events.Triggers.actionSpent',
  hit: 'CARL_RPG.Events.Triggers.hit',
  miss: 'CARL_RPG.Events.Triggers.miss',
  takesDamage: 'CARL_RPG.Events.Triggers.takesDamage',
  restTaken: 'CARL_RPG.Events.Triggers.restTaken',
  combatStart: 'CARL_RPG.Events.Triggers.combatStart',
  combatEnd: 'CARL_RPG.Events.Triggers.combatEnd',
  floorChange: 'CARL_RPG.Events.Triggers.floorChange',
  levelUp: 'CARL_RPG.Events.Triggers.levelUp',
  advanced: 'CARL_RPG.Events.Triggers.advanced',
  effectGained: 'CARL_RPG.Events.Triggers.effectGained',
  effectEnded: 'CARL_RPG.Events.Triggers.effectEnded',
};
/**
 * Triggers that belong to the actor rather than to using an item. They run on every
 * item, effect (and, for a pet, upgrade) the actor has: see runActorEvents. A pet's
 * own events can only use these.
 */
CARL_RPG.eventTriggersActor = [
  'phaseStart',
  'phaseEnd',
  'roundEnd',
  'actionSpent',
  'takesDamage',
  'restTaken',
  'combatStart',
  'combatEnd',
  'floorChange',
  'levelUp',
];
/** Triggers that only make sense on an effect (it is turned on, or ends). */
CARL_RPG.eventTriggersEffectOnly = ['effectGained', 'effectEnded'];
/** Triggers that only make sense on a skill or spell (its rank goes up). */
CARL_RPG.eventTriggersSkillOnly = ['advanced'];
/** Triggers that need a combat phase picked. */
CARL_RPG.eventTriggersWithPhase = ['phaseStart', 'phaseEnd'];
/** Triggers that only make sense on gear. */
CARL_RPG.eventTriggersGearOnly = ['equipped', 'unequipped'];
/** Triggers that only make sense on loot boxes. */
CARL_RPG.eventTriggersLootOnly = ['opened'];

/** Things an event can check before it runs. */
CARL_RPG.eventConditions = {
  stat: 'CARL_RPG.Events.Conditions.stat',
  mana: 'CARL_RPG.Events.Conditions.mana',
  phase: 'CARL_RPG.Events.Conditions.phase',
  rollMin: 'CARL_RPG.Events.Conditions.rollMin',
  rollMax: 'CARL_RPG.Events.Conditions.rollMax',
  nat20: 'CARL_RPG.Events.Conditions.nat20',
  nat1: 'CARL_RPG.Events.Conditions.nat1',
  degree: 'CARL_RPG.Events.Conditions.degree',
  lootItem: 'CARL_RPG.Events.Conditions.lootItem',
  lootGold: 'CARL_RPG.Events.Conditions.lootGold',
  classTag: 'CARL_RPG.Events.Conditions.classTag',
  effect: 'CARL_RPG.Events.Conditions.effect',
  inCombat: 'CARL_RPG.Events.Conditions.inCombat',
  floor: 'CARL_RPG.Events.Conditions.floor',
  health: 'CARL_RPG.Events.Conditions.health',
  chance: 'CARL_RPG.Events.Conditions.chance',
  targetSize: 'CARL_RPG.Events.Conditions.targetSize',
  targetKind: 'CARL_RPG.Events.Conditions.targetKind',
  restKind: 'CARL_RPG.Events.Conditions.restKind',
};
/** The kinds of target an event condition can ask about (for "the target is a ...") */
CARL_RPG.eventTargetKinds = {
  crawler: 'CARL_RPG.Events.TargetKinds.crawler',
  pet: 'CARL_RPG.Events.TargetKinds.pet',
  mob: 'CARL_RPG.Events.TargetKinds.mob',
  basic: 'CARL_RPG.Events.TargetKinds.basic',
  elite: 'CARL_RPG.Events.TargetKinds.elite',
  boss: 'CARL_RPG.Events.TargetKinds.boss',
};
/** Rests, for the "the rest taken is" condition (any longer rest also counts the shorter ones). */
CARL_RPG.eventRestKinds = {
  short: 'CARL_RPG.Events.RestKinds.short',
  long: 'CARL_RPG.Events.RestKinds.long',
  full: 'CARL_RPG.Events.RestKinds.full',
};

/**
 * The degrees of success of an attack (see helpers/attacks.mjs), for the "the
 * attack's result is" event condition.
 */
CARL_RPG.attackDegrees = {
  critHit: 'CARL_RPG.Attack.Degrees.critHit',
  amazing: 'CARL_RPG.Attack.Degrees.amazing',
  success: 'CARL_RPG.Attack.Degrees.success',
  nearMiss: 'CARL_RPG.Attack.Degrees.nearMiss',
  fail: 'CARL_RPG.Attack.Degrees.fail',
  majorFail: 'CARL_RPG.Attack.Degrees.majorFail',
  critFail: 'CARL_RPG.Attack.Degrees.critFail',
};

/**
 * What an item's roll is checked against (set on each item as
 * `system.check.target`; see helpers/attacks.mjs). Unopposed is the default.
 *  - unopposed: needs no target: base + (Floor x unopposedFloorFactor)
 *  - evade:     an attack: the target's Evade
 *  - a stat:    base + the target's modifier for that stat + the Floor
 *  - size:      base + the target's Size Class (Tiny is 1, up to Gargantuan 8)
 *               + the Floor
 */
CARL_RPG.checkTargets = {
  unopposed: 'CARL_RPG.Check.Targets.unopposed',
  evade: 'CARL_RPG.Check.Targets.evade',
  ...Object.fromEntries(
    ['str', 'int', 'con', 'dex', 'cha']
      .filter((key) => key in CARL_RPG.abilities)
      .map((key) => [key, CARL_RPG.abilities[key]])
  ),
  size: 'CARL_RPG.Check.Targets.size',
};

/**
 * Skill and spell upgrades (see helpers/upgrades.mjs). A skill or spell holds a
 * list of upgrades; each has a rank, a description, changes picked from a menu
 * and, optionally, events and effects it unlocks. Every upgrade at or below the
 * skill's current rank applies, in rank order.
 *  - defaultRanks: the ranks a new upgrade starts at, in order (then +rankStep)
 *  - dieLadder:    the dice sizes "step the dice" moves along
 *  - changes:      the menu of changes an upgrade can make; `spellOnly` ones are
 *                  only offered on spells
 */
CARL_RPG.upgrades = {
  defaultRanks: [5, 10, 15, 20],
  rankStep: 5,
  dieLadder: [4, 6, 8, 10, 12, 20],
  changes: {
    damageAdd: 'CARL_RPG.Upgrades.Changes.damageAdd',
    damageReplace: 'CARL_RPG.Upgrades.Changes.damageReplace',
    dieStep: 'CARL_RPG.Upgrades.Changes.dieStep',
    manaCost: 'CARL_RPG.Upgrades.Changes.manaCost',
    rollBonus: 'CARL_RPG.Upgrades.Changes.rollBonus',
    rollTarget: 'CARL_RPG.Upgrades.Changes.rollTarget',
  },
  spellOnly: ['manaCost'],
};

/**
 * The lists of items the system offers, each of which the GM can draw from the
 * world's items and/or chosen compendiums (see helpers/sources.mjs). `type` is
 * the item type the list is made of.
 */
CARL_RPG.compendiumPurposes = {
  achievements: { type: 'achievement', label: 'CARL_RPG.Sources.Purposes.achievements' },
  races: { type: 'race', label: 'CARL_RPG.Sources.Purposes.races' },
  classes: { type: 'class', label: 'CARL_RPG.Sources.Purposes.classes' },
  backgrounds: { type: 'background', label: 'CARL_RPG.Sources.Purposes.backgrounds' },
  skills: { type: 'skill', label: 'CARL_RPG.Sources.Purposes.skills' },
};

/**
 * Pet upgrades (see helpers/upgrades.mjs). A pet's upgrades work like a skill's,
 * but are reached at a level.
 *  - defaultLevel: the level a new upgrade starts at (then +levelStep for more)
 *  - changes:      the menu of changes an upgrade can make. Each adds to a number
 *                  the way an active effect does, except the size, which steps
 *                  along CONFIG.CARL_RPG.sizes.
 *  - triggers:     the only event triggers that make sense for a pet's own events
 */
CARL_RPG.petUpgrades = {
  defaultLevel: 15,
  levelStep: 5,
  changes: {
    statBonus: 'CARL_RPG.Upgrades.PetChanges.statBonus',
    sizeStep: 'CARL_RPG.Upgrades.PetChanges.sizeStep',
    dr: 'CARL_RPG.Upgrades.PetChanges.dr',
    evade: 'CARL_RPG.Upgrades.PetChanges.evade',
    move: 'CARL_RPG.Upgrades.PetChanges.move',
    mana: 'CARL_RPG.Upgrades.PetChanges.mana',
    actions: 'CARL_RPG.Upgrades.PetChanges.actions',
  },
  // (A pet's own events use the actor triggers: see CARL_RPG.eventTriggersActor.)
  triggers: [
    'phaseStart',
    'phaseEnd',
    'roundEnd',
    'actionSpent',
    'takesDamage',
    'restTaken',
    'combatStart',
    'combatEnd',
    'floorChange',
    'levelUp',
  ],
};

/**
 * The kinds of rest, shortest first. A rest ends the effects that last "until" it
 * or a shorter rest (a long rest also ends effects that last until a short rest).
 * See helpers/rests.mjs.
 */
CARL_RPG.rests = ['short', 'long', 'full'];

/**
 * What each kind of rest gives back (see helpers/rests.mjs).
 *  - health: health boxes healed, or 'full'
 *  - mana:   the fraction of the crawler's total mana recovered (rounded down),
 *            or 'full'
 */
CARL_RPG.restRecovery = {
  short: { health: 5, mana: 0.5 },
  long: { health: 'full', mana: 'full' },
  full: { health: 'full', mana: 'full' },
};

/**
 * How long an effect can last (`flags.carl-rpg.lastsUntil` on the effect), for
 * the effect sheet's menu. Blank means until it is removed.
 */
CARL_RPG.effectDurations = {
  '': 'CARL_RPG.Rest.UntilRemoved',
  short: 'CARL_RPG.Rest.Until.short',
  long: 'CARL_RPG.Rest.Until.long',
  full: 'CARL_RPG.Rest.Until.full',
  combat: 'CARL_RPG.Rest.Until.combat',
};

/**
 * How often an item's uses come back (`system.uses.recharge`). "Never" means they
 * don't, until someone sets them again. A longer rest also gives back what a
 * shorter one does.
 */
CARL_RPG.usesRecharge = {
  never: 'CARL_RPG.Uses.Recharge.never',
  round: 'CARL_RPG.Uses.Recharge.round',
  combat: 'CARL_RPG.Uses.Recharge.combat',
  floor: 'CARL_RPG.Uses.Recharge.floor',
  short: 'CARL_RPG.Uses.Recharge.short',
  long: 'CARL_RPG.Uses.Recharge.long',
  full: 'CARL_RPG.Uses.Recharge.full',
};

/**
 * The injury debuffs a crawler gets after a combat in which a mob's attack went
 * badly for them on an Evade roll (see helpers/attacks.mjs): a Minor Injury if
 * they missed by 10 or more, a Major Injury on a natural 1.
 *  - penalty:          added to all five stats
 *  - duration:         lasts until this kind of rest
 *  - upgradedDuration: another injury of the same kind doesn't stack, but makes
 *                      it last until this rest instead
 */
CARL_RPG.injuries = {
  minor: {
    name: 'CARL_RPG.Injury.Minor.Name',
    description: 'CARL_RPG.Injury.Minor.Description',
    img: 'icons/svg/blood.svg',
    penalty: -2,
    duration: 'short',
    upgradedDuration: 'long',
  },
  major: {
    name: 'CARL_RPG.Injury.Major.Name',
    description: 'CARL_RPG.Injury.Major.Description',
    img: 'icons/svg/skull.svg',
    penalty: -5,
    duration: 'long',
    upgradedDuration: 'full',
  },
};

/** The numbers an unopposed or opposed check starts from. */
CARL_RPG.checks = {
  base: 10,
  unopposedFloorFactor: 2,
  // A plain stat check (the d20 + stat roll from the abilities sidebar) needs the base
  // plus the Floor.
  statCheckFloorFactor: 1,
};

/** Things that must be true for an item to be used at all. */
CARL_RPG.itemRequirements = {
  mana: 'CARL_RPG.Events.Requirements.mana',
  stat: 'CARL_RPG.Events.Requirements.stat',
  gold: 'CARL_RPG.Events.Requirements.gold',
  actions: 'CARL_RPG.Events.Requirements.actions',
  classTag: 'CARL_RPG.Events.Requirements.classTag',
};

/** What an event can do. */
CARL_RPG.eventActions = {
  useItem: 'CARL_RPG.Events.Actions.useItem',
  macro: 'CARL_RPG.Events.Actions.macro',
  toggleEffect: 'CARL_RPG.Events.Actions.toggleEffect',
  applyEffect: 'CARL_RPG.Events.Actions.applyEffect',
  addItem: 'CARL_RPG.Events.Actions.addItem',
  removeItem: 'CARL_RPG.Events.Actions.removeItem',
  mana: 'CARL_RPG.Events.Actions.mana',
  health: 'CARL_RPG.Events.Actions.health',
  message: 'CARL_RPG.Events.Actions.message',
  actions: 'CARL_RPG.Events.Actions.actions',
  gold: 'CARL_RPG.Events.Actions.gold',
  aiFavor: 'CARL_RPG.Events.Actions.aiFavor',
  rollTable: 'CARL_RPG.Events.Actions.rollTable',
  runEvent: 'CARL_RPG.Events.Actions.runEvent',
};

CARL_RPG.actionsModes = {
  spend: 'CARL_RPG.Events.ActionsModes.spend',
  restore: 'CARL_RPG.Events.ActionsModes.restore',
};
CARL_RPG.goldModes = {
  add: 'CARL_RPG.Events.GoldModes.add',
  remove: 'CARL_RPG.Events.GoldModes.remove',
};
CARL_RPG.aiFavorModes = {
  award: 'CARL_RPG.Events.AiFavorModes.award',
  spend: 'CARL_RPG.Events.AiFavorModes.spend',
};
/**
 * Who an action can affect. Blank is the owner of the item or effect (or the actor
 * dropped on the action, if there is one).
 */
CARL_RPG.eventTargetGroups = {
  '': 'CARL_RPG.Events.TargetGroups.owner',
  allies: 'CARL_RPG.Events.TargetGroups.allies',
  enemies: 'CARL_RPG.Events.TargetGroups.enemies',
  targeted: 'CARL_RPG.Events.TargetGroups.targeted',
  pets: 'CARL_RPG.Events.TargetGroups.pets',
  master: 'CARL_RPG.Events.TargetGroups.master',
};

CARL_RPG.effectActionModes = {
  toggle: 'CARL_RPG.Events.EffectModes.toggle',
  on: 'CARL_RPG.Events.EffectModes.on',
  off: 'CARL_RPG.Events.EffectModes.off',
  removeStack: 'CARL_RPG.Events.EffectModes.removeStack',
  removeAll: 'CARL_RPG.Events.EffectModes.removeAll',
};
CARL_RPG.manaModes = {
  spend: 'CARL_RPG.Events.ManaModes.spend',
  restore: 'CARL_RPG.Events.ManaModes.restore',
};
CARL_RPG.healthModes = {
  damage: 'CARL_RPG.Events.HealthModes.damage',
  heal: 'CARL_RPG.Events.HealthModes.heal',
};
CARL_RPG.macroRunOn = {
  user: 'CARL_RPG.Events.RunOn.user',
  gm: 'CARL_RPG.Events.RunOn.gm',
};

/** How deep events can trigger other events (an item using an item using...). */
CARL_RPG.maxEventDepth = 5;

/**
 * Loot box tiers, lowest to highest. `gold` is the default gold a box of that
 * tier pays when opened (a number or dice formula); a box can override it.
 * Bronze 1d10, Silver (1d10) x 100, Gold (1d10) x 1000, Platinum (2d6) x 1000,
 * Legendary (1d10) x 10000. Celestial pays no gold.
 * @type {Object<string, {label: string, color: string, gold: string}>}
 */
CARL_RPG.lootTiers = {
  bronze: { label: 'CARL_RPG.Loot.Tiers.bronze', color: '#cd7f32', gold: '1d10' },
  silver: { label: 'CARL_RPG.Loot.Tiers.silver', color: '#c0c0c0', gold: '(1d10)*100' },
  gold: { label: 'CARL_RPG.Loot.Tiers.gold', color: '#e0a526', gold: '(1d10)*1000' },
  platinum: { label: 'CARL_RPG.Loot.Tiers.platinum', color: '#8fd3d8', gold: '(2d6)*1000' },
  legendary: { label: 'CARL_RPG.Loot.Tiers.legendary', color: '#b05cff', gold: '(1d10)*10000' },
  celestial: { label: 'CARL_RPG.Loot.Tiers.celestial', color: '#5cc8ff', gold: '0' },
};

/**
 * Effect types. All effects are the same kind of document; this is set in
 * the effect's details.
 *  - buff: toggled on and off; at most CARL_RPG.maxActiveBuffs active at once
 *  - debuff: toggled on and off, no limit; only stacks if marked stackable
 *  - passive: toggled on and off, never counts toward any limit
 * @type {Object}
 */
CARL_RPG.effectKinds = {
  buff: 'CARL_RPG.Effect.Kinds.buff',
  debuff: 'CARL_RPG.Effect.Kinds.debuff',
  passive: 'CARL_RPG.Effect.Kinds.passive',
};

/** The most buffs that can be active on an actor at once. */
CARL_RPG.maxActiveBuffs = 3;

/**
 * What an effect can modify. Effects write into the actor's `system.bonuses`,
 * which the actor data models add to the matching base values, so nothing an
 * effect does is ever saved into the actor's own numbers.
 * @type {Object<string, {label: string, key: string}>}
 */
CARL_RPG.effectModifiers = {
  str: { label: 'CARL_RPG.Effect.Mods.str', key: 'system.bonuses.str' },
  int: { label: 'CARL_RPG.Effect.Mods.int', key: 'system.bonuses.int' },
  con: { label: 'CARL_RPG.Effect.Mods.con', key: 'system.bonuses.con' },
  dex: { label: 'CARL_RPG.Effect.Mods.dex', key: 'system.bonuses.dex' },
  cha: { label: 'CARL_RPG.Effect.Mods.cha', key: 'system.bonuses.cha' },
  dr: { label: 'CARL_RPG.Effect.Mods.dr', key: 'system.bonuses.dr' },
  evade: { label: 'CARL_RPG.Effect.Mods.evade', key: 'system.bonuses.evade' },
  move: { label: 'CARL_RPG.Effect.Mods.move', key: 'system.bonuses.move' },
  surprise: { label: 'CARL_RPG.Effect.Mods.surprise', key: 'system.bonuses.surprise' },
  mana: { label: 'CARL_RPG.Effect.Mods.mana', key: 'system.bonuses.mana' },
  hotlist: { label: 'CARL_RPG.Effect.Mods.hotlist', key: 'system.bonuses.hotlist' },
  actions: { label: 'CARL_RPG.Effect.Mods.actions', key: 'system.bonuses.actions' },
};

/**
 * Creature sizes, smallest to largest (shared by crawlers and mobs).
 * @type {Object}
 */
CARL_RPG.sizes = {
  tiny: 'CARL_RPG.Size.tiny',
  small: 'CARL_RPG.Size.small',
  petite: 'CARL_RPG.Size.petite',
  medium: 'CARL_RPG.Size.medium',
  large: 'CARL_RPG.Size.large',
  huge: 'CARL_RPG.Size.huge',
  colossal: 'CARL_RPG.Size.colossal',
  gargantuan: 'CARL_RPG.Size.gargantuan',
};

/**
 * The sizes for a dropdown, each with its Size Class number after the name
 * (Tiny is 1 up to Gargantuan 8), like "Medium (4)". Call it when the menu is built.
 * @returns {Object<string, string>}
 */
CARL_RPG.sizeOptions = () =>
  Object.fromEntries(
    Object.entries(CARL_RPG.sizes).map(([key, label], index) => [
      key,
      `${game.i18n.localize(label)} (${index + 1})`,
    ])
  );

/**
 * The phases of a combat round, in order. `side` is who acts in that phase
 * ('all' means everyone, e.g. the cleanup phase).
 * @type {Array<{id: string, side: string}>}
 */
CARL_RPG.combatPhases = [
  { id: 'declare', side: 'mob' },
  { id: 'react', side: 'crawler' },
  { id: 'resolve', side: 'mob' },
  { id: 'action', side: 'crawler' },
  { id: 'cleanup', side: 'all' },
];

CARL_RPG.abilityAbbreviations = {
  str: 'CARL_RPG.Ability.Str.abbr',
  dex: 'CARL_RPG.Ability.Dex.abbr',
  con: 'CARL_RPG.Ability.Con.abbr',
  int: 'CARL_RPG.Ability.Int.abbr',
  cha: 'CARL_RPG.Ability.Cha.abbr',
};

CARL_RPG.getStatModifier = function(statValue) {
  const maxStatValue = [2, 5, 9, 19, 49, 99, 149, 199, 299];
  let mod = 1;
  for(const num of maxStatValue) {
    if(statValue <= num) return mod;

    mod++;
  }
  return mod;
};

/**
 * How damage that is not an even multiple of the CON modifier is rounded when
 * converting it to lost health boxes: 'ceil', 'floor' or 'round'.
 * 'floor' drops the remainder, i.e. boxes lost = (net - net % CON) / CON. That is
 * the rule: leftover damage is lost and does not carry over to the next hit.
 */
CARL_RPG.damageRounding = 'floor';