import { manaCostOf } from '../data/costs.mjs';
import { damageTypeLabel, damageTypes, rowTypes, rowTypesProblem } from './damage-types.mjs';
import { validAmount } from './amounts.mjs';
/**
 * Skill, spell and pet upgrades.
 *
 * A skill or spell holds a list of upgrades (`system.upgrades`). So does a pet,
 * whose upgrades come at a level (the `rank` of an upgrade is the level it is
 * reached at; see `computePetUpgrades`). Each has a rank,
 * a description, a list of changes picked from a menu, the events it carries and
 * the effects it unlocks. Every upgrade at or below the skill's current rank
 * applies, in rank order and then in the order its changes are listed.
 *
 * Nothing is written to the skill: its effective numbers are worked out from its
 * current rank whenever they are needed (see `computeEffective`), so lowering a
 * rank undoes the upgrades again.
 *
 * Changes (CONFIG.CARL_RPG.upgrades.changes), each with a `value`:
 *  - damageAdd      add dice or a bonus to the damage ("1d6", "2")
 *  - damageReplace  replace the damage formula
 *  - dieStep        move every die in the damage up (or, if negative, down) the
 *                   dice sizes in CONFIG.CARL_RPG.upgrades.dieLadder
 *  - manaCost       change the Mana cost (it never goes below 0)
 *  - junkCost       change the Misc Junk cost
 *  - usesCost       change how many of its own uses it spends
 *                   (each cost change moves both ends of a range)
 *  - rollBonus      add a number to the d20 roll
 *  - rollTarget     roll against something else (a key of CONFIG.CARL_RPG.checkTargets)
 *  - armorPiercing  the damage ignores Damage Resistance (no value)
 *  - damageType     the damage becomes this type (an id from the GM's damage types)
 *  - areaShape      the area becomes this shape (a key of CONFIG.CARL_RPG.areaShapes); the last wins
 *  - areaShapeExtra the area can also be this shape: the roll pop-up offers the choice
 *  - areaSizeAdd    add feet to the area's size (negative ok)
 *  - areaSizeReplace the area's size becomes this amount (a number or formula); drops earlier additions
 *  - rankDamageBonus  add to the rank that @rankDamage is read at (see rank-damage.mjs)
 *  - rankDamageStep   move @rankDamage that many rows along its table
 *  - rmRank / rmDice / rmDR  a Roll Modifier's changes (see roll-mods.mjs); each has an
 *                   optional `when` condition
 *
 * A Damage Effect's deAddDice and a Roll Modifier's rmDice can also name a damage type
 * (`bonusType`, plus an optional second one, `bonusAlso`; see rowTypes in damage-types.mjs).
 */

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/*  Dice                                        */

/**
 * Move every die in a formula up (or down) the ladder of dice sizes. A die that
 * is already at the end of the ladder stays there, and a size that isn't on the
 * ladder is left alone.
 * @param {string} formula
 * @param {number} steps
 * @returns {string}
 */
export function stepDice(formula, steps) {
  const ladder = CONFIG.CARL_RPG.upgrades.dieLadder;
  if (!steps) return formula;
  return formula.replace(/(?<![\w@.])(\d*)d(\d+)/gi, (whole, count, size) => {
    const at = ladder.indexOf(Number(size));
    if (at < 0) return whole;
    const to = Math.min(ladder.length - 1, Math.max(0, at + steps));
    return `${count}d${ladder[to]}`;
  });
}

/** Whether text is a number or dice formula that can be rolled (data like @str.mod counts). */
export function validFormula(text) {
  const formula = String(text ?? '').trim();
  return !!formula && Roll.validate(formula);
}

/** Whether a Roll Modifier change has a condition its kind of change can't use. */
const whenProblem = (change) =>
  !(CONFIG.CARL_RPG.rollMods.allowed[change.type] ?? []).includes(change.when ?? '');

/** Join an addition onto a formula: "1d6" + "1d4" is "1d6 + 1d4", "-1" is "1d6 - 1". */
function addToFormula(formula, extra) {
  const base = String(formula ?? '').trim();
  const add = String(extra).trim();
  if (!base) return add;
  const sign = /^[+-]/.test(add);
  return sign ? `${base} ${add[0]} ${add.slice(1).trim()}` : `${base} + ${add}`;
}

/*  Working out the numbers                     */

/**
 * The rank an upgrade list is measured against: a skill's effective rank (its rank moved
 * by Skill rank bonus build benefits, see skill-rank.mjs), or a pet's level (a pet's
 * skills use the floor as their rank, but the pet's own upgrades follow its level).
 * `stored` reads the stored rank instead.
 */
export const levelOf = (system, stored = false) =>
  (stored ? system.rank : (system.effectiveRank ?? system.rank)) ??
  system.attributes?.level?.value ??
  0;

/** The upgrades a skill (or pet) has reached, lowest rank first. */
export function unlockedUpgrades(system) {
  const rank = levelOf(system);
  return (system.upgrades ?? [])
    .filter((upgrade) => upgrade.rank <= rank)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Whether a change would do anything: its value has to be usable. (Changes that
 * can't be used are skipped, and the sheet warns about them.)
 */
export function changeProblem(change) {
  const value = String(change.value ?? '').trim();
  switch (change.type) {
    case 'damageAdd':
    case 'damageReplace':
      return !validFormula(value);
    case 'dieStep':
    case 'manaCost':
    case 'junkCost':
    case 'usesCost':
    case 'rollBonus':
    case 'rankDamageBonus':
    case 'rankDamageStep':
      return !Number.isFinite(Number(value)) || value === '';
    case 'rollTarget':
      return !(value in CONFIG.CARL_RPG.checkTargets);
    case 'armorPiercing':
      return false;
    case 'areaShape':
    case 'areaShapeExtra':
      return !Object.hasOwn(CONFIG.CARL_RPG.areaShapes, value);
    case 'areaSizeAdd':
      return !Number.isFinite(Number(value)) || value === '';
    case 'areaSizeReplace':
      return value === '' || !validAmount(value);
    case 'damageType':
      return !damageTypes().some((d) => d.id === value);
    // A Damage Effect's changes (see damage-effects.mjs).
    case 'deAddDice':
      return !validFormula(value) || rowTypesProblem(change);
    case 'deTotalMultiplier':
    case 'deHealthMax':
    case 'deSizeMax':
    case 'deCooldownHours':
    case 'deStunOption':
      return !Number.isFinite(Number(value)) || value === '';
    case 'deBaseByRank':
    case 'deSameSize':
    case 'deCooldownRound':
    case 'deCooldownNone':
      return false;
    // A Roll Modifier's changes (see roll-mods.mjs).
    case 'rmRank':
      return whenProblem(change);
    case 'rmDice':
      return !validFormula(value) || whenProblem(change) || rowTypesProblem(change);
    case 'rmDR':
      return (
        !Number.isFinite(Number(value)) || value === '' || Number(value) < 0 || whenProblem(change)
      );
    // A pet's changes.
    case 'statBonus':
      return (
        !(change.stat in CONFIG.CARL_RPG.abilities) ||
        !Number.isFinite(Number(value)) ||
        value === ''
      );
    case 'sizeStep':
    case 'dr':
    case 'evade':
    case 'move':
    case 'mana':
    case 'actions':
      return !Number.isFinite(Number(value)) || value === '';
    default:
      return true;
  }
}

/**
 * What a skill or spell actually uses at its current rank.
 * @param {object} system  The item's system data (uses its rank, damage, check,
 *                         manaCost and upgrades)
 * @returns {{damage: string, manaCost: number, rollBonus: number,
 *   rankBonus: number, rankStep: number,
 *   target: string, damageType: string, armorPiercing: boolean, areaShape: string,
 *   areaShapes: string[], areaSize: string, areaSizeDelta: number, unlocked: string[]}}
 *   `areaShapes` is the shapes the area can have (the first is the one used without a choice),
 *   `areaSize` the size amount and `areaSizeDelta` the feet added to it.
 *   `unlocked` is the ids of the upgrades that have been reached.
 */
export function computeEffective(system) {
  let damage = String(system.damage ?? '');
  let manaCost = manaCostOf(system.costs, system.manaCost);
  // What the upgrades add to the Mana cost in all (a cost that is a formula or a range
  // can't be worked out here, so it is shifted when it is used: see costSpans).
  let manaDelta = 0;
  let junkDelta = 0;
  let usesDelta = 0;
  let rollBonus = 0;
  // What the upgrades move @rankDamage by (see rank-damage.mjs).
  let rankBonus = 0;
  let rankStep = 0;
  let target = system.check?.target ?? 'unopposed';
  let damageType = system.damageType ?? '';
  let armorPiercing = !!system.armorPiercing;
  // An area's shape (and the others it can be), and its size (an amount, plus feet added).
  let areaShape = system.targeting?.shape ?? 'circle';
  const extraShapes = [];
  let areaSize = String(system.targeting?.size ?? '0');
  let areaSizeDelta = 0;

  const reached = unlockedUpgrades(system);
  for (const upgrade of reached) {
    for (const change of upgrade.changes ?? []) {
      if (changeProblem(change)) continue;
      const value = String(change.value).trim();
      switch (change.type) {
        case 'damageAdd':
          damage = addToFormula(damage, value);
          break;
        case 'damageReplace':
          damage = value;
          break;
        case 'dieStep':
          damage = stepDice(damage, Math.trunc(Number(value)));
          break;
        case 'manaCost':
          manaCost = Math.max(0, manaCost + Math.trunc(Number(value)));
          manaDelta += Math.trunc(Number(value));
          break;
        case 'junkCost':
          junkDelta += Math.trunc(Number(value));
          break;
        case 'usesCost':
          usesDelta += Math.trunc(Number(value));
          break;
        case 'rollBonus':
          rollBonus += Math.trunc(Number(value));
          break;
        case 'rollTarget':
          target = value;
          break;
        case 'armorPiercing':
          armorPiercing = true;
          break;
        case 'damageType':
          damageType = value;
          break;
        case 'areaShape':
          areaShape = value;
          break;
        case 'areaShapeExtra':
          if (!extraShapes.includes(value)) extraShapes.push(value);
          break;
        case 'areaSizeAdd':
          areaSizeDelta += Math.trunc(Number(value));
          break;
        case 'areaSizeReplace':
          areaSize = value;
          areaSizeDelta = 0;
          break;
        case 'rankDamageBonus':
          rankBonus += Math.trunc(Number(value));
          break;
        case 'rankDamageStep':
          rankStep += Math.trunc(Number(value));
          break;
      }
    }
  }
  return {
    damage,
    manaCost,
    manaDelta,
    junkDelta,
    usesDelta,
    rollBonus,
    rankBonus,
    rankStep,
    target,
    damageType,
    armorPiercing,
    areaShape,
    areaShapes: [areaShape, ...extraShapes.filter((shape) => shape !== areaShape)],
    areaSize,
    areaSizeDelta,
    unlocked: reached.map((u) => u.id),
  };
}

/**
 * What a pet's upgrades give it at its current level.
 *  - bonuses  extra points for the actor's `bonuses` (stats, Evade, Damage
 *             Resistance, Move, max mana, actions), added like effects do
 *  - size     the pet's size once its upgrades have moved it up or down the sizes
 *  - grants   UUIDs of the skills and spells the reached upgrades give it
 *  - unlocked ids of the upgrades that have been reached
 * @param {object} system  The pet's system data
 */
export function computePetUpgrades(system) {
  const bonuses = {};
  const grants = [];
  let sizeSteps = 0;

  const reached = unlockedUpgrades(system);
  for (const upgrade of reached) {
    for (const change of upgrade.changes ?? []) {
      if (changeProblem(change)) continue;
      const amount = Math.trunc(Number(change.value));
      switch (change.type) {
        case 'statBonus':
          bonuses[change.stat] = (bonuses[change.stat] ?? 0) + amount;
          break;
        case 'sizeStep':
          sizeSteps += amount;
          break;
        case 'dr':
        case 'evade':
        case 'move':
        case 'mana':
        case 'actions':
          bonuses[change.type] = (bonuses[change.type] ?? 0) + amount;
          break;
      }
    }
    for (const uuid of upgrade.grants ?? []) {
      if (!grants.includes(uuid)) grants.push(uuid);
    }
  }

  const sizes = Object.keys(CONFIG.CARL_RPG.sizes);
  const at = Math.max(0, sizes.indexOf(system.size));
  const size = sizes[Math.min(sizes.length - 1, Math.max(0, at + sizeSteps))];
  return { bonuses, size, grants, unlocked: reached.map((u) => u.id) };
}

/**
 * What an item uses right now. Skills and spells give their upgraded numbers;
 * everything else just gives its own.
 * @param {Item} item
 */
export function effectiveOf(item) {
  const system = item.system;
  return (
    system.effective ?? {
      damage: String(system.damage ?? ''),
      manaCost: manaCostOf(system.costs, system.manaCost),
      manaDelta: 0,
      junkDelta: 0,
      usesDelta: 0,
      rollBonus: 0,
      rankBonus: 0,
      rankStep: 0,
      target: system.check?.target ?? 'unopposed',
      damageType: system.damageType ?? '',
      armorPiercing: !!system.armorPiercing,
      areaShape: system.targeting?.shape ?? 'circle',
      areaShapes: [system.targeting?.shape ?? 'circle'],
      areaSize: String(system.targeting?.size ?? '0'),
      areaSizeDelta: 0,
      unlocked: [],
    }
  );
}

/*  Events carried by upgrades                  */

/**
 * Every event an item can run: its own, plus the events carried by the upgrades
 * it has reached.
 * @param {Item} item
 */
export function allEvents(item) {
  // An effect keeps its events in its flags.
  if (item.documentName === 'ActiveEffect') {
    return item.getFlag('carl-rpg', 'events') ?? [];
  }
  const own = item.system.events ?? [];
  if (!item.system.upgrades?.length) return own;
  const carried = unlockedUpgrades(item.system).flatMap((u) => u.events ?? []);
  return carried.length ? [...own, ...carried] : own;
}

/*  Effects unlocked by upgrades                */

/** How an effect is found again: its identifier, else its name. */
export function effectKey(effect) {
  const identifier = effect.getFlag?.('carl-rpg', 'identifier')?.trim?.();
  return identifier || effect.name;
}

/**
 * The rank at which an item unlocks an effect (the lowest rank of the upgrades
 * that list it), or null if no upgrade holds it back.
 * @param {Item} item
 * @param {string} key  See effectKey
 * @returns {number|null}
 */
export function unlockRankOf(item, key) {
  let rank = null;
  for (const upgrade of item.system.upgrades ?? []) {
    if (!(upgrade.unlocksEffects ?? []).includes(key)) continue;
    rank = rank === null ? upgrade.rank : Math.min(rank, upgrade.rank);
  }
  return rank;
}

/**
 * Whether an item still holds an effect back at its current rank.
 * @returns {number|null}  The rank it unlocks at, if it is still locked
 */
export function lockedRankFor(item, key, stored = false) {
  const need = unlockRankOf(item, key);
  if (need === null) return null;
  return levelOf(item.system, stored) >= need ? null : need;
}

/*  Describing upgrades                         */

/** A short sentence for each change, for an upgrade with no description of its own. */
export function summarizeChanges(upgrade, effectNames = [], grantNames = []) {
  const parts = [];
  for (const change of upgrade.changes ?? []) {
    const value = String(change.value ?? '').trim();
    if (changeProblem(change)) continue;
    const n = Math.trunc(Number(value));
    switch (change.type) {
      case 'damageAdd':
        // ("+1d6 damage", "-1 damage")
        parts.push(
          t('CARL_RPG.Upgrades.Summary.damageAdd', {
            value: /^[+-]/.test(value) ? value : `+${value}`,
          })
        );
        break;
      case 'damageReplace':
        parts.push(t('CARL_RPG.Upgrades.Summary.damageReplace', { value }));
        break;
      case 'dieStep':
        parts.push(
          t(n >= 0 ? 'CARL_RPG.Upgrades.Summary.dieUp' : 'CARL_RPG.Upgrades.Summary.dieDown', {
            count: Math.abs(n),
          })
        );
        break;
      case 'manaCost':
        parts.push(t('CARL_RPG.Upgrades.Summary.manaCost', { value: signed(n) }));
        break;
      case 'junkCost':
        parts.push(t('CARL_RPG.Upgrades.Summary.junkCost', { value: signed(n) }));
        break;
      case 'usesCost':
        parts.push(t('CARL_RPG.Upgrades.Summary.usesCost', { value: signed(n) }));
        break;
      case 'rollBonus':
        parts.push(t('CARL_RPG.Upgrades.Summary.rollBonus', { value: signed(n) }));
        break;
      case 'rollTarget':
        parts.push(
          t('CARL_RPG.Upgrades.Summary.rollTarget', {
            target: t(CONFIG.CARL_RPG.checkTargets[value]),
          })
        );
        break;
      case 'armorPiercing':
        parts.push(t('CARL_RPG.Upgrades.Summary.armorPiercing'));
        break;
      case 'areaShape':
      case 'areaShapeExtra':
        parts.push(
          t(`CARL_RPG.Upgrades.Summary.${change.type}`, {
            shape: t(CONFIG.CARL_RPG.areaShapes[value]).toLowerCase(),
          })
        );
        break;
      case 'areaSizeAdd':
        parts.push(t('CARL_RPG.Upgrades.Summary.areaSizeAdd', { value: signed(n) }));
        break;
      case 'areaSizeReplace':
        parts.push(t('CARL_RPG.Upgrades.Summary.areaSizeReplace', { value }));
        break;
      case 'rankDamageBonus':
        parts.push(t('CARL_RPG.Upgrades.Summary.rankDamageBonus', { value: signed(n) }));
        break;
      case 'rankDamageStep':
        parts.push(t('CARL_RPG.Upgrades.Summary.rankDamageStep', { value: signed(n) }));
        break;
      case 'damageType':
        parts.push(
          t('CARL_RPG.Upgrades.Summary.damageType', {
            type: damageTypes().find((d) => d.id === value)?.label ?? value,
          })
        );
        break;
      // A Damage Effect's changes.
      case 'deAddDice': {
        const type = typeLabelOf(change);
        parts.push(
          t(`CARL_RPG.Upgrades.Summary.deAddDice${type ? 'Typed' : ''}`, {
            value: /^[+-]/.test(value) ? value : `+${value}`,
            type,
          })
        );
        break;
      }
      case 'deBaseByRank':
        parts.push(t('CARL_RPG.Upgrades.Summary.deBaseByRank'));
        break;
      case 'deTotalMultiplier':
      case 'deHealthMax':
      case 'deSizeMax':
      case 'deCooldownHours':
        parts.push(t(`CARL_RPG.Upgrades.Summary.${change.type}`, { value }));
        break;
      case 'deSameSize':
      case 'deCooldownRound':
      case 'deCooldownNone':
        parts.push(t(`CARL_RPG.Upgrades.Summary.${change.type}`));
        break;
      case 'deStunOption':
        parts.push(t(n > 0 ? 'CARL_RPG.Upgrades.Summary.deStunOption' : 'CARL_RPG.Upgrades.Summary.deStunOptionOff'));
        break;
      // A Roll Modifier's changes.
      case 'rmRank':
        parts.push(t('CARL_RPG.Upgrades.Summary.rmRank') + whenSuffix(change));
        break;
      case 'rmDice': {
        const type = typeLabelOf(change);
        parts.push(
          t(`CARL_RPG.Upgrades.Summary.rmDice${type ? 'Typed' : ''}`, {
            value: /^[+-]/.test(value) ? value : `+${value}`,
            type,
          }) + whenSuffix(change)
        );
        break;
      }
      case 'rmDR':
        parts.push(t('CARL_RPG.Upgrades.Summary.rmDR', { value: n }) + whenSuffix(change));
        break;
      // A pet's changes.
      case 'statBonus':
        parts.push(
          t('CARL_RPG.Upgrades.Summary.statBonus', {
            stat: t(CONFIG.CARL_RPG.abilities[change.stat]),
            value: signed(n),
          })
        );
        break;
      case 'sizeStep':
        parts.push(
          t(n >= 0 ? 'CARL_RPG.Upgrades.Summary.sizeUp' : 'CARL_RPG.Upgrades.Summary.sizeDown', {
            count: Math.abs(n),
          })
        );
        break;
      case 'dr':
      case 'evade':
      case 'move':
      case 'mana':
      case 'actions':
        parts.push(
          t('CARL_RPG.Upgrades.Summary.petBonus', {
            what: t(`CARL_RPG.Upgrades.PetNames.${change.type}`),
            value: signed(n),
          })
        );
        break;
    }
  }
  for (const name of grantNames) {
    parts.push(t('CARL_RPG.Upgrades.Summary.grants', { name }));
  }
  for (const name of effectNames) {
    parts.push(t('CARL_RPG.Upgrades.Summary.unlocks', { name }));
  }
  return parts.join('; ');
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** The type(s) a bonus row names, for text: "Fire" or "Fire & Lightning" ('' when untyped). */
const typeLabelOf = (change) => rowTypes(change).map(damageTypeLabel).join(' & ');

/** " (only with Disadvantage)" after a Roll Modifier change that has a condition. */
const whenSuffix = (change) =>
  change.when ? ` (${t(`CARL_RPG.RollMod.WhenSummary.${change.when}`)})` : '';

/**
 * The upgrades of a skill or spell, for listing on its sheet or in chat: each
 * with its rank, its text (the description, or a summary of the changes), and
 * whether it has been reached.
 * @param {Item} item
 * @param {{reachedOnly?: boolean}} [options]
 * @returns {Array<{id: string, rank: number, text: string, unlocked: boolean}>}
 */
export function describeUpgrades(item, { reachedOnly = false, grantNames = {} } = {}) {
  const rank = levelOf(item.system);
  return [...(item.system.upgrades ?? [])]
    .sort((a, b) => a.rank - b.rank)
    .map((upgrade) => ({
      id: upgrade.id,
      rank: upgrade.rank,
      text:
        upgrade.description?.trim() ||
        summarizeChanges(
          upgrade,
          upgrade.unlocksEffects ?? [],
          (upgrade.grants ?? []).map((uuid) => grantNames[uuid]).filter(Boolean)
        ),
      unlocked: upgrade.rank <= rank,
    }))
    .filter((upgrade) => upgrade.text && (!reachedOnly || upgrade.unlocked));
}
