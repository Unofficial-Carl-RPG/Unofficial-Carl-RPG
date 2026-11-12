/**
 * What the damage window can change about one damage roll (pure rules; the window itself is
 * promptDamage in roll-dialog.mjs, the roll is rollAttackDamage in attacks.mjs).
 *
 *  - Bonus damage: a number or dice, rolled once and added to each target that is hit
 *    (a natural 20 doubles its dice, like any other bonus dice).
 *  - Damage multiplier: the whole damage of each target is multiplied (halves round down),
 *    after the item's own multipliers.
 *  - Damage type and second type: replace the item's own for this roll.
 *  - Ignore DR: the damage skips Damage Resistance (what Armor-Piercing does).
 */

/** The value of the second-type menu that means "no second type". */
export const NO_ALSO_TYPE = '-';

/**
 * The bonus damage as a formula.
 * @param {string} text  What was typed ("2", "+2", "1d4")
 * @param {(formula: string) => boolean} [validate]  Whether a formula can be rolled
 * @returns {{formula: string}|null|{error: true}}  null when nothing was typed, error when it can't be rolled
 */
export function bonusFormula(text, validate = (formula) => Roll.validate(formula)) {
  const formula = String(text ?? '')
    .trim()
    .replace(/^\+\s*/, '');
  if (!formula) return null;
  return validate(formula) ? { formula } : { error: true };
}

/**
 * The multiplier typed in the window (blank, zero or anything unreadable = x1).
 * @param {string|number} value
 * @returns {number}
 */
export function manualMultiplier(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The damage types a roll uses once the window's choices are read.
 * @param {{type?: string, also?: string}} choice  What the menus gave ('' = as written)
 * @param {{type?: string, also?: string}} current  The item's own (upgrades included)
 * @returns {{damageType: string, damageTypeAlso: string}}
 */
export function chosenTypes({ type = '', also = '' } = {}, { type: ownType = '', also: ownAlso = '' } = {}) {
  const damageType = type || ownType || '';
  let damageTypeAlso = also === NO_ALSO_TYPE ? '' : also || ownAlso || '';
  // (a second type the same as the first, or with no first, does nothing)
  if (!damageType || damageTypeAlso === damageType) damageTypeAlso = '';
  return { damageType, damageTypeAlso };
}

/**
 * Whether the window changed anything about the damage (for the card's note).
 * @param {{bonus?: object|null, multiplier?: number, type?: string, also?: string, ignoreDR?: boolean}} manual
 * @param {{armorPiercing?: boolean}} [current]
 */
export function changesDamage(manual, current = {}) {
  if (!manual) return false;
  return !!(
    manual.bonus ||
    (manual.multiplier ?? 1) !== 1 ||
    manual.type ||
    manual.also ||
    !!manual.ignoreDR !== !!current.armorPiercing
  );
}
