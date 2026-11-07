/**
 * The numbers about a use's d20 roll and damage that events can read, as `@roll.margin`,
 * `@roll.bonus`, `@roll.mod`, `@roll.rank` and `@damage.total`, `@damage.dice`,
 * `@damage.base` (see eventData in events.mjs). Plain numbers only, so they can travel with a
 * request handed to the GM's client. A value that does not exist for a trigger is left out,
 * so a formula that reads it counts as unresolved (a condition is false, an amount is 0).
 */
import { evalAmount } from './amounts.mjs';

const finite = (n) => (Number.isFinite(n) ? n : undefined);

/**
 * What the d20 roll was made of, before any target is compared with it.
 *  - bonus: everything added as an extra bonus (the pop-up, the build, a Roll Modifier's Rank);
 *           0 if blank or if it has dice in it
 *  - mod:   the modifier of the stat the roll used (after a pop-up stat change)
 *  - rank:  the rank added to the roll (the rolled skill's, else the item's own)
 * @param {{bonus?: string, stat?: string|null}} [options]  The roll pop-up's answers
 * @param {object} [data]                 The roller's roll data
 * @param {string|null} [defaultStat]     The stat used when the pop-up did not change it
 * @param {number} [rank]
 * @returns {{bonus: number, mod?: number, rank: number}}
 */
export function rollNumbers({ options = {}, data = {}, defaultStat = null, rank = 0 } = {}) {
  const stat = options.stat || defaultStat;
  const bonus = String(options.bonus ?? '').trim();
  return {
    bonus: bonus ? (evalAmount(bonus, data) ?? 0) : 0,
    ...(stat ? { mod: finite(Number(data?.[stat]?.mod)) } : {}),
    rank: Number(rank) || 0,
  };
}

/**
 * How far a roll was over (or, negative, under) the number it had to reach.
 * @param {number|undefined|null} total
 * @param {number|undefined|null} dc
 * @returns {number|undefined}  undefined with no roll or no number to reach
 */
export function marginOf(total, dc) {
  if (total === undefined || total === null || dc === undefined || dc === null) return undefined;
  return finite(Number(total) - Number(dc));
}

/**
 * The damage numbers one target gets: the use's, with `total` set to what that target takes.
 * A target that took nothing (a miss) has no `total`.
 * @param {{total?: number, dice: number, base: number}|null|undefined} damage  See damageNumbers
 * @param {number|null} [dealt]
 * @returns {{total?: number, dice: number, base: number}|undefined}
 */
export function damageOfTarget(damage, dealt = null) {
  if (!damage) return undefined;
  const { total, ...rest } = damage;
  return dealt === null || dealt === undefined ? rest : { ...rest, total: dealt };
}

/**
 * The damage numbers of a use. `total` is what one target takes (after a critical, the
 * degree bonus and modifier dice, before DR), `dice` the sum of the base damage's dice and
 * `base` the base damage roll.
 * @param {{base?: number|null, dice?: number|null}} rolled  The base damage, once rolled
 * @param {number|null} [total]
 * @returns {{total?: number, dice: number, base: number}|null}  null if no damage was rolled
 */
export function damageNumbers(rolled, total = null) {
  if (!rolled || rolled.base === undefined || rolled.base === null) return null;
  return {
    ...(total === null || total === undefined ? {} : { total }),
    dice: Number(rolled.dice) || 0,
    base: Number(rolled.base) || 0,
  };
}
