/**
 * Room in a gear slot. Each slot holds a number of items (CONFIG.CARL_RPG.gearSlotLimits).
 * Most gear takes one place; two-handed gear takes every place in the Hands slot.
 * Pure logic, so it can be tested without Foundry.
 */

/**
 * Whether gear is two-handed. Only gear in the Hands slot can be.
 * @param {{slot?: string, twoHanded?: boolean}} system  The gear's system data
 * @returns {boolean}
 */
export function isTwoHanded(system) {
  return system?.slot === 'hands' && !!system?.twoHanded;
}

/**
 * How many places of its slot a piece of gear takes up.
 * @param {{slot?: string, twoHanded?: boolean}} system  The gear's system data
 * @param {number} limit  How many places the slot has
 * @returns {number}
 */
export function slotCost(system, limit) {
  return isTwoHanded(system) ? Math.max(limit, 1) : 1;
}

/**
 * Work out what has to come off to equip a piece of gear into its slot.
 *
 * @param {{id: string, system: object}} gear  The gear to equip
 * @param {{id: string, system: object}[]} held  Other gear equipped in the same slot
 * @param {number} limit  How many places the slot has
 * @returns {{fits: boolean, options: string[][]}}  `fits` when there is room already.
 *   Otherwise each option is a set of ids that makes room if unequipped: every single
 *   item that frees enough on its own, or, if none can, everything held in the slot.
 */
export function planEquip(gear, held, limit) {
  const used = held.reduce((sum, g) => sum + slotCost(g.system, limit), 0);
  const deficit = used + slotCost(gear.system, limit) - limit;
  if (deficit <= 0) return { fits: true, options: [] };

  const singles = held.filter((g) => slotCost(g.system, limit) >= deficit);
  if (singles.length) return { fits: false, options: singles.map((g) => [g.id]) };
  return { fits: false, options: [held.map((g) => g.id)] };
}
