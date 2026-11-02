/**
 * Loot piles: opening a pile and taking what is in it. A crawler takes one item at a
 * time (claim), or the gold and junk either all at once (take all) or shared among the
 * crawlers in the combat (share), with any remainder going to the first. Gold from a
 * pile is tithed like other loot (see helpers/tithe.mjs). A pile with nothing left is
 * removed by the GM.
 */
import { grantStoreItem } from './store.mjs';
import { updateWithRelay } from './relay.mjs';
import { titheOf } from './tithe.mjs';

/** The crawlers in the active combat (any owner), or none outside a combat. */
function combatCrawlers() {
  if (!game.combat?.started) return [];
  return game.combat.combatants.contents
    .map((c) => c.actor)
    .filter((a) => a?.type === 'crawler');
}

/** The crawlers the current user can open a pile with: those in combat they own, or any they own. */
export function openersFor() {
  const inCombat = combatCrawlers().filter((a) => a.isOwner);
  if (inCombat.length) return inCombat;
  return game.actors.contents.filter((a) => a.type === 'crawler' && a.isOwner);
}

/** Give one of a pile's items to a crawler (one at a time). */
export async function claimItem(pile, index, crawler) {
  const row = pile.system.items[index];
  if (!row || !crawler) return false;
  const doc = await fromUuid(row.uuid);
  if (!doc) return false;
  await grantStoreItem(crawler, { item: doc, type: doc.type, key: doc.uuid, name: doc.name });
  const items = pile.system.items.map((i) => ({ uuid: i.uuid, quantity: i.quantity }));
  if (row.quantity > 1) items[index].quantity -= 1;
  else items.splice(index, 1);
  await updateWithRelay(pile, { 'system.items': items });
  await removeIfEmpty(pile);
  return true;
}

/**
 * Take a pile's gold and junk. `mode` is 'all' (the opener takes everything) or
 * 'share' (split evenly among the combat's crawlers, the remainder to the first).
 */
export async function takeGold(pile, opener, mode) {
  if (!opener) return false;
  const pool = mode === 'share' && combatCrawlers().length ? combatCrawlers() : [opener];
  const n = pool.length;
  const goldEach = Math.floor(pile.system.gold / n);
  const goldLeft = pile.system.gold - goldEach * n;
  const junkEach = Math.floor(pile.system.junk / n);
  const junkLeft = pile.system.junk - junkEach * n;

  for (let i = 0; i < n; i++) {
    const recipient = pool[i];
    const gold = goldEach + (i === 0 ? goldLeft : 0);
    const junk = junkEach + (i === 0 ? junkLeft : 0);
    if (gold) {
      const { net } = titheOf(recipient, gold);
      if (net) await recipient.addGold(net);
    }
    if (junk) {
      await updateWithRelay(recipient, {
        'system.junk': (recipient.system.junk ?? 0) + junk,
      });
    }
  }
  await updateWithRelay(pile, { 'system.gold': 0, 'system.junk': 0 });
  await removeIfEmpty(pile);
  return true;
}

/** A pile with nothing left is removed (the GM does it; players leave it empty). */
async function removeIfEmpty(pile) {
  const { gold, junk, items } = pile.system;
  if (gold || junk || items.length) return;
  if (game.user.isGM) await pile.delete();
}
