/**
 * Tags.
 *
 * Any item can carry a list of tags (`system.tags`: plain text). Rules that need
 * them (prerequisites, item requirements, event conditions, ...) ask through
 * these helpers, so a new use of tags only has to call one of them. A tag is
 * matched ignoring case and surrounding spaces, so "fighter" is "Fighter".
 *
 * A class also has CATEGORIES (`system.categories`: Fighter, Mage, ... or a
 * custom one). They are kept separate from its regular tags, but they work as
 * tags too: anything that asks whether an item has a tag matches its categories
 * as well.
 */
import { purposeTypes, sourceItems } from './sources.mjs';
import { actsAsClass } from './class-combo.mjs';

/** The form of a tag used for comparing. */
export const tagKey = (tag) => String(tag ?? '').trim().toLowerCase();

/** Whether two tags are the same. */
export const sameTag = (a, b) => tagKey(a) === tagKey(b) && tagKey(a) !== '';

/** Whether a list of tags includes a tag. */
export const listHasTag = (tags, tag) =>
  (tags ?? []).some((t) => sameTag(t, tag));

/** Everything an item answers to as a tag: its tags plus its categories. */
export const itemTags = (item) => [
  ...(item?.system?.tags ?? []),
  ...(item?.system?.categories ?? []),
];

/** Whether an item has a tag (as a regular tag or as a category). */
export const itemHasTag = (item, tag) => listHasTag(itemTags(item), tag);

/**
 * Whether a crawler's class (or its Race and Class combo, if it has no class item)
 * or any of its subclasses has a tag.
 */
export const classHasTag = (actor, tag) =>
  itemHasTag(
    actor?.itemTypes?.class?.[0] ?? (actor?.itemTypes?.race ?? []).find(actsAsClass),
    tag
  ) || (actor?.itemTypes?.subclass ?? []).some((sub) => itemHasTag(sub, tag));

/**
 * A copy of a tag list with a tag added (nothing changes if it is already
 * there). Empty tags are ignored.
 */
export function withTag(tags, tag) {
  const text = String(tag ?? '').trim();
  if (!text || listHasTag(tags, text)) return [...(tags ?? [])];
  return [...(tags ?? []), text];
}

/** A copy of a tag list with a tag removed. */
export const withoutTag = (tags, tag) =>
  (tags ?? []).filter((t) => !sameTag(t, tag));

/**
 * Every tag (and category) used by the world's items of a type, plus the
 * suggested ones, sorted: used to suggest tags when typing one in.
 * @param {string} type        An item type ("class")
 * @param {string[]} suggested The suggested tags for that type
 */
export async function knownTags(type, suggested = []) {
  const found = new Map();
  for (const tag of suggested) found.set(tagKey(tag), tag);
  // The items of the list this type belongs to: the world's and the chosen
  // compendiums' (a player gets them through the GM's client, see sources.mjs).
  const purpose = Object.keys(CONFIG.CARL_RPG.compendiumPurposes).find((key) =>
    purposeTypes(key).includes(type)
  );
  const items = purpose ? await sourceItems(purpose) : game.items.contents;
  for (const item of items) {
    if (item.type !== type) continue;
    for (const tag of itemTags(item)) {
      if (!found.has(tagKey(tag))) found.set(tagKey(tag), tag);
    }
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/*  One-time move of class tags to categories   */

/**
 * Class tags were first stored as regular tags. Move them to categories, for the
 * world's classes and the classes crawlers hold (GM only). Running it again is
 * harmless: only a class with tags and no categories is changed. It runs as a
 * migration step (see helpers/migration.mjs).
 */
export async function migrateClassTags() {
  if (!game.user.isGM) return;

  const move = async (item) => {
    const tags = item.system.tags ?? [];
    if (item.type !== 'class' || !tags.length) return;
    if ((item.system.categories ?? []).length) return;
    await item.update({ 'system.categories': [...tags], 'system.tags': [] });
  };
  for (const item of game.items) await move(item);
  for (const actor of game.actors) {
    for (const item of actor.items) await move(item);
  }
}
