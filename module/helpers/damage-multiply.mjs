
/**
 * Damage multipliers.
 *
 * A skill or spell upgrade can multiply the damage it deals (the `damageMultiply` change):
 * Magic Missile's base damage x3 at rank 15, Shock Treatment's x5 at melee range, a x4 on a
 * Critical Hit. A row has:
 *  - value  the multiplier (a number above 0; it can be a fraction)
 *  - scope  `total` (everything the target takes: the dice, modifiers, bonus dice, the
 *           Amazing Floor bonus) or `base` (just the item's own dice result; flat modifiers
 *           and extras are added after, like a Damage Effect's "base x Rank")
 *  - when   an optional "Only when" condition (CONFIG.CARL_RPG.rollMods.allowed.damageMultiply):
 *           the roll's mode, a Surprise attack or melee range (ticks in the roll pop-up), or
 *           the degree of success against each target (hit, Amazing or better, Critical Hit)
 *
 * Rows that apply to a target do not add up: the highest one for each scope is used. Each
 * part of a target's damage is multiplied on its own and rounded down, so a type that is
 * resisted afterwards halves the multiplied number.
 *
 * A row that is only for a Critical Hit takes the place of the critical's x2 on the item's own
 * dice: they are rolled once, not doubled, and the multiplier works on them instead. Bonus dice
 * from Damage Effects and Roll Modifiers are still doubled by the critical.
 */
import { degreeMet, whenMet } from './roll-mods.mjs';
import { damageWithEffect } from './damage-effects.mjs';
import { damageParts, partsMatter, partsTotal, scaleParts } from './damage-types.mjs';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** A row's scope (a blank or unknown one is the total). */
export const scopeOf = (row) => (row?.scope === 'base' ? 'base' : 'total');

/**
 * The rows of a use: those whose condition on the roll itself holds (degree conditions are
 * checked against each target later).
 * @param {{value: number, scope: string, when: string}[]} rows  See computeEffective
 * @param {{mode?: string, surprise?: boolean, melee?: boolean}} roll  The final mode and the ticks
 */
export function resolveMultipliers(rows, roll = {}) {
  return (rows ?? []).filter((row) => whenMet(row.when ?? '', roll));
}

/** Whether a row only works at melee range (the roll pop-up then shows the tick). */
export const needsMelee = (rows) => (rows ?? []).some((row) => row.when === 'melee');

/** Whether a row takes the place of the Critical Hit's x2 on the item's own dice. */
export const critReplaces = (rows) => (rows ?? []).some((row) => row.when === 'crit');

/**
 * The multipliers for one degree of success: the highest applying row of each scope, 1 when
 * none applies.
 * @param {{value: number, scope: string, when: string}[]} rows  Already resolved for the roll
 * @param {string} degree
 * @returns {{base: number, total: number}}
 */
export function multiplierFor(rows, degree) {
  const best = { base: null, total: null };
  for (const row of rows ?? []) {
    if (!degreeMet(row.when ?? '', degree)) continue;
    const scope = scopeOf(row);
    best[scope] = best[scope] === null ? row.value : Math.max(best[scope], row.value);
  }
  return { base: best.base ?? 1, total: best.total ?? 1 };
}

/**
 * The item's dice multiplied: only the dice result grows, the flat modifiers stay.
 * @param {number} total  The rolled damage (dice and modifiers)
 * @param {number} diceSum  Just the dice of it
 * @param {number} times
 * @returns {{total: number, diceSum: number}}
 */
export function scaleBase(total, diceSum, times) {
  const m = Number(times);
  if (!(m > 0) || m === 1) return { total, diceSum };
  return { total: total + diceSum * (m - 1), diceSum: diceSum * m };
}

/**
 * One target's damage: the item's own roll (its dice multiplied by the base multiplier), a
 * Damage Effect's changes, the Roll Modifiers' dice and the Amazing bonus, split into the
 * damage types, then every part multiplied by the total multiplier.
 * @param {object} p
 * @param {number} p.damage  The rolled damage (dice and modifiers)
 * @param {number} p.diceSum  Just the dice of it
 * @param {number} [p.extra]  What a Damage Effect's extra dice rolled
 * @param {number} [p.bonus]  The Amazing Success bonus (the Floor)
 * @param {object|null} [p.rules]  The chosen Damage Effect's rules (see damage-effects.mjs)
 * @param {number} [p.rank]  That effect's Rank
 * @param {boolean} [p.applies]  Whether the effect works against this target
 * @param {number} [p.modTotal]  What the Roll Modifiers' untyped dice add for this target
 * @param {{types: string[], amount: number}[]} [p.typed]  The dice with a type of their own
 * @param {string} [p.ownType]  The attack's damage type
 * @param {string} [p.alsoType]  The attack's second damage type (its own damage is split)
 * @param {{base: number, total: number}} [p.mult]  See multiplierFor
 * @returns {{damage: number, parts: {type: string, amount: number}[]|null}}
 *   `parts` only when the damage is of more than the attack's one type
 */
export function targetDamage({
  damage,
  diceSum,
  extra = 0,
  bonus = 0,
  rules = null,
  rank = 0,
  applies = false,
  modTotal = 0,
  typed = [],
  ownType = '',
  alsoType = '',
  mult = { base: 1, total: 1 },
}) {
  const scaled = scaleBase(damage, diceSum, mult.base);
  const base =
    damageWithEffect({
      total: scaled.total,
      diceSum: scaled.diceSum,
      extra,
      bonus,
      rules,
      rank,
      applies,
    }) + modTotal;
  const times = mult.total;
  const parts = damageParts(base, ownType, typed, alsoType);
  if (partsMatter(parts, ownType)) {
    const scaledParts = scaleParts(parts, times);
    return { damage: partsTotal(scaledParts), parts: scaledParts };
  }
  return { damage: Math.max(0, Math.floor(base * times)), parts: null };
}

/** A short note for the chat card's heading about the multipliers in play ('' when none). */
export function multiplierNote({ base = 1, total = 1 } = {}) {
  const notes = [];
  if (base !== 1) notes.push(t('CARL_RPG.Attack.MultipliedBase', { value: base }));
  if (total !== 1) notes.push(t('CARL_RPG.Attack.MultipliedTotal', { value: total }));
  return notes.length ? ` (${notes.join(', ')})` : '';
}
