/**
 * The optional "Hotlist-only spells" rule: with the world setting on, a crawler can
 * only cast a spell that is on their hotlist. Skills and items are never affected.
 * The GM is not held to it, and neither are spells another item or event casts
 * (only a direct use is blocked, see Item#roll).
 */
const NS = 'carl-rpg';
export const HOTLIST_ONLY_SETTING = 'hotlistOnlySpells';

/** Off by default. */
export function registerHotlistRule() {
  game.settings.register(NS, HOTLIST_ONLY_SETTING, {
    name: 'CARL_RPG.Hotlist.OnlyName',
    hint: 'CARL_RPG.Hotlist.OnlyHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });
}

/** Whether the setting is on. */
export function hotlistOnlySpells() {
  try {
    return !!game.settings.get(NS, HOTLIST_ONLY_SETTING);
  } catch (err) {
    return false;
  }
}

/** Whether the item is in one of the crawler's hotlist slots. */
export function onHotlist(item) {
  const actor = item.parent;
  const hotlist = actor?.system?.hotlist;
  if (!hotlist) return false;
  return (hotlist.items ?? []).slice(0, hotlist.size ?? 0).includes(item.id);
}

/** Whether the rule stops this item being cast right now. */
export function castBlockedByHotlist(item) {
  if (item.type !== 'spell' || game.user?.isGM || !hotlistOnlySpells()) return false;
  if (item.parent?.type !== 'crawler') return false;
  return !onHotlist(item);
}
