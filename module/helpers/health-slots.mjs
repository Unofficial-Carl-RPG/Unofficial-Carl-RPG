/**
 * Health Bar slots.
 *
 * A bar is `max` slots, lowest first: slot 1 is the last one lost, slot `max` (the "100%" slot) is
 * the first. Each slot absorbs `perBox` damage (the CON modifier, or the stat a Health stat row
 * names), and effects can change the bar two ways:
 *
 *  - the slot count: the modifier `healthSlots` (+N or -N, at least 1 slot and at most 100 remain;
 *    see slotCountOf). Applied to crawlers and pets (on top of their own number of boxes) and
 *    mobs (on top of their max health, since each of a mob's health points is a slot);
 *  - one slot's value: a Health Bar slot value build row `{kind: 'healthSlotValue', target: 'top'|
 *    'bottom', position, amount}` adds `amount` (negative allowed, a slot is always worth at
 *    least 1) to the slot `position` places from the top (1 = the 100% slot) or from the bottom
 *    (1 = the lowest slot). A row naming a slot the bar does not have is skipped.
 *
 * Damage is taken slot by slot from the highest filled one: a slot is lost when the damage left
 * reaches its value, and what does not fill the next slot is dropped (CONFIG.CARL_RPG.damageRounding,
 * 'floor'). With no slot rows every slot is worth `perBox`, which gives the old
 * "boxes = damage / perBox" exactly.
 *
 * Pure (no Foundry globals), so it can be checked under plain Node.
 */

export const SLOT_KIND = 'healthSlotValue';
export const MIN_SLOTS = 1;
export const MAX_SLOTS = 100;

const whole = (n) => Math.trunc(Number(n)) || 0;

/** The slot count after the `healthSlots` modifier: whole, at least 1, at most 100. */
export function slotCountOf(base, bonus = 0) {
  return Math.min(Math.max(whole(base) + whole(bonus), MIN_SLOTS), MAX_SLOTS);
}

/** A row's position: a whole number of 1 or more (1 for anything else). */
export const slotPosition = (n) => Math.max(1, whole(n));

/** Whether a Health Bar slot value row has a position that is not a whole number of 1 or more. */
export function slotRowProblem(row) {
  const n = Number(String(row?.position ?? '').trim());
  return !(Number.isInteger(n) && n >= 1);
}

/** The usable rows, as `{from, position, amount}`. */
export function slotRows(rows) {
  return (rows ?? [])
    .filter((row) => row?.kind === SLOT_KIND && (row.target === 'top' || row.target === 'bottom'))
    .map((row) => ({ from: row.target, position: slotPosition(row.position), amount: whole(row.amount) }));
}

/**
 * What each slot absorbs, lowest slot first.
 * @param {number} count    Slots in the bar
 * @param {number} perBox   Base value of a slot
 * @param {object[]} [rows]  Health Bar slot value build rows
 * @returns {number[]}
 */
export function slotValues(count, perBox, rows = []) {
  const base = Math.max(1, whole(perBox) || 1);
  const n = Math.max(0, whole(count));
  const values = Array.from({ length: n }, () => base);
  for (const { from, position, amount } of slotRows(rows)) {
    const index = from === 'top' ? n - position : position - 1;
    if (index >= 0 && index < n) values[index] += amount;
  }
  return values.map((value) => Math.max(1, value));
}

/** The damage a whole bar absorbs. */
export const capacityOf = (values) => (values ?? []).reduce((sum, value) => sum + value, 0);

/**
 * How many slots damage takes off the filled ones. Works from a health object
 * (`{value, perBox, slots?}`): a slot missing from `slots` is worth `perBox` (1 when unknown).
 * Damage past the last filled slot is counted at `perBox` a slot, as it always was.
 * @param {number} net  Damage left after Damage Resistance
 * @param {{value?: number, perBox?: number, slots?: number[]}} health
 * @param {'floor'|'ceil'|'round'} [rounding]  What a part of a slot counts as
 * @returns {number}
 */
export function boxesLost(net, health, rounding = 'floor') {
  const roundFn = Math[rounding] ?? Math.ceil;
  const perBox = Number(health?.perBox);
  const valueAt = (i) => {
    const own = Number(health?.slots?.[i]);
    return own > 0 ? own : perBox > 0 ? perBox : 1;
  };
  let left = Math.max(0, Number(net) || 0);
  let lost = 0;
  for (let i = Math.max(0, whole(health?.value)) - 1; i >= 0 && left > 0; i--) {
    const value = valueAt(i);
    if (left >= value) {
      left -= value;
      lost++;
      continue;
    }
    if (roundFn(left / value) >= 1) lost++;
    left = 0;
  }
  if (left > 0) lost += roundFn(left / (perBox > 0 ? perBox : 1));
  return lost;
}
