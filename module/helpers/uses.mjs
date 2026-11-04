import { logUse } from './change-log.mjs';

/**
 * Usage limits.
 *
 * An item can only be used a set number of times before it has to recharge
 * (`system.uses`: `max` uses, `spent` so far, and how it `recharge`s). A max of 0
 * means no limit. Using the item spends a use; a use comes back when its recharge
 * comes round: at the end of a round, the end of a combat, when the floor changes,
 * or after a short, long or full rest (a longer rest also gives back what a
 * shorter one does). "Every N rounds" is a cooldown: the uses come back at the
 * end of the Nth round after one was spent (see tickCooldowns), or when the
 * combat ends.
 */

/** The recharge settings each kind of rest gives back. */
export const RECHARGE_BY_REST = {
  short: ['short'],
  long: ['short', 'long'],
  full: ['short', 'long', 'full'],
};

/** Whether an item has a limit on its uses. */
export const isLimited = (item) => (item?.system?.uses?.max ?? 0) > 0;

/** How many uses an item has left (Infinity if it has no limit). */
export function usesLeft(item) {
  if (!isLimited(item)) return Infinity;
  const { max, spent } = item.system.uses;
  return Math.max(0, max - spent);
}

/**
 * Spend uses of an item (one by default; nothing happens if it has no limit). An Observer
 * using an item has it done by the GM's client (see helpers/relay.mjs).
 * @param {Item} item
 */
export async function spendUse(item, amount = 1) {
  if (!isLimited(item) || amount < 1 || usesLeft(item) < amount) return;
  const { updateWithRelay } = await import('./relay.mjs');
  const left = usesLeft(item) - amount;
  await updateWithRelay(item, { 'system.uses.spent': item.system.uses.spent + amount });
  logUse(item.actor, left);
}

/**
 * Give back the uses of an actor's items that recharge on one of these occasions.
 * @param {Actor} actor
 * @param {string[]} when  Values of CONFIG.CARL_RPG.usesRecharge
 */
export async function restoreUses(actor, when) {
  const updates = actor.items
    .filter(
      (item) =>
        isLimited(item) &&
        item.system.uses.spent > 0 &&
        when.includes(item.system.uses.recharge)
    )
    .map((item) => ({ _id: item.id, 'system.uses.spent': 0, 'system.uses.waited': 0 }));
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
}

/**
 * A round ended: count a round for every spent "Every N rounds" item, and give
 * its uses back once N have passed (the round the use was spent in counts as one).
 * @param {Actor} actor
 */
export async function tickCooldowns(actor) {
  const updates = [];
  for (const item of actor.items) {
    if (!isLimited(item) || item.system.uses.recharge !== 'rounds') continue;
    const { spent, waited, every } = item.system.uses;
    if (spent <= 0) {
      if (waited) updates.push({ _id: item.id, 'system.uses.waited': 0 });
      continue;
    }
    if (waited + 1 >= every) {
      updates.push({ _id: item.id, 'system.uses.spent': 0, 'system.uses.waited': 0 });
    } else {
      updates.push({ _id: item.id, 'system.uses.waited': waited + 1 });
    }
  }
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
}
