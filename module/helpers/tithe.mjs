/**
 * The tithe. A crawler's deity takes a share of the gold the crawler gets from loot
 * boxes and mobs (not from other gold). The share is the deity's percent, rounded
 * down, and is taken off the gold; nobody is paid it. Any crawler with a deity pays,
 * at any tier.
 */
export const DEFAULT_TITHE = 5;

/**
 * The gold a crawler keeps after its deity's tithe, and the tithe itself.
 * @param {Actor} actor  The crawler receiving the gold
 * @param {number} gold  The gold from a loot box or a mob
 * @returns {{tithe: number, net: number}}
 */
export function titheOf(actor, gold) {
  const deity = actor?.itemTypes?.deity?.[0];
  if (!deity || !(gold > 0)) return { tithe: 0, net: gold };
  const rate = deity.system.tithe ?? DEFAULT_TITHE;
  const tithe = Math.floor((gold * rate) / 100);
  return { tithe, net: gold - tithe };
}
