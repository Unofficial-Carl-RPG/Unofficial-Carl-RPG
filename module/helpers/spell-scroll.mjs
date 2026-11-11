/**
 * Spell Scrolls: an item that holds a copy of a spell at a set rank. Using it casts that
 * spell at that rank, then spends one from its Quantity.
 *
 * The scroll is spell-like: its model extends the spell's (data/item-spell-scroll.mjs), and
 * dropping a spell on it copies the spell's own settings into the scroll's (a snapshot: later
 * edits to the spell don't reach it). Because the copy is the scroll's own data, it rolls,
 * targets, runs events and posts cards like any item, with nothing temporary to clean up.
 *
 *  - rank: the scroll's own, exactly. The crawler's Skill rank bonuses and the skill cap
 *    do not touch it (see data/item-feature.mjs fixedRank, and rank-damage.mjs)
 *  - costs: none. The copy has no Mana, Misc Junk, Uses or Ammunition costs and an upgrade's
 *    cost change is ignored (Item#costSpans). In combat it takes the usual single action
 *  - requirements: the scroll's own only (the spell's are not copied)
 *  - effects: the spell's own effects are not copied; events that point at an effect by UUID
 *    still find it
 *  - hotlist: with the Hotlist-only spells rule on, the scroll itself must be on the hotlist
 *
 * Pure (no Foundry classes), so it can be checked under plain Node.
 */

/** The item types that cast like a spell. */
export const SPELL_LIKE = ['spell', 'spellScroll'];

/** Whether an item is a spell or a spell scroll. */
export const isSpellLike = (item) => SPELL_LIKE.includes(item?.type);

/** Whether an item is a spell scroll. */
export const isScroll = (item) => item?.type === 'spellScroll';

/** The settings a scroll copies from its spell (the rest of the spell is left behind). */
export const COPIED_FIELDS = [
  'description',
  'shortDescription',
  'tags',
  'interrupt',
  'check',
  'damage',
  'damageType',
  'damageTypeAlso',
  'armorPiercing',
  'targeting',
  'events',
  'stat',
  'passive',
  'upgrades',
];

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const whole = (n) => Math.max(0, Math.trunc(Number(n)) || 0);

/** How many of the scroll are left. */
export const scrollLeft = (item) => whole(item?.system?.quantity);

/** Whether a spell has been put on the scroll. */
export const scrollHasSpell = (item) => !!String(item?.system?.spellSource?.name ?? '').trim();

/**
 * Why a scroll can't be used right now.
 * @param {object} item
 * @returns {null|'NoSpell'|'NoneLeft'}  null when it can be used
 */
export function scrollBlock(item) {
  if (!isScroll(item)) return null;
  if (!scrollHasSpell(item)) return 'NoSpell';
  if (scrollLeft(item) < 1) return 'NoneLeft';
  return null;
}

/** What is left after one is read (never below 0). */
export const afterReading = (item) => Math.max(0, scrollLeft(item) - 1);

/**
 * Who the spell on a scroll is, for a record of where it came from.
 * @param {{uuid?: string, name?: string, img?: string, system?: {identifier?: string}}} spell
 * @returns {{uuid: string, name: string, identifier: string, img: string}}
 */
export function sourceOf(spell) {
  return {
    uuid: String(spell?.uuid ?? ''),
    name: String(spell?.name ?? ''),
    identifier: String(spell?.system?.identifier ?? '').trim(),
    img: String(spell?.img ?? ''),
  };
}

/**
 * The scroll's own system data after a spell is put on it: the spell's settings copied,
 * the rank kept (or set), and no costs, uses or requirements.
 * @param {object} spellSystem  The spell's system data (its source)
 * @param {number} rank
 * @returns {object}  Update data for `system`
 */
export function systemFrom(spellSystem, rank) {
  const system = {};
  for (const key of COPIED_FIELDS) {
    if (spellSystem?.[key] !== undefined) system[key] = clone(spellSystem[key]);
  }
  system.rank = whole(rank);
  // A scroll is free to read: nothing the spell would spend or require is kept.
  system.costs = [];
  system.requirements = [];
  system.uses = { max: 0, spent: 0 };
  return system;
}

/**
 * The name and picture a scroll takes from the spell put on it, but only while it still
 * has its default ones (or the ones an earlier spell gave it): anything the GM changed is
 * kept.
 * @param {{name?: string, img?: string}} current  The scroll
 * @param {{name?: string, img?: string}|null} previous  The earlier spell on it, if any
 * @param {{name?: string, img?: string}} spell  The new spell
 * @param {{makeName: (spellName: string) => string, defaultName: string, defaultImg: string}} defaults
 * @returns {{name?: string, img?: string}}
 */
export function lookFrom(current, previous, spell, { makeName, defaultName, defaultImg }) {
  const out = {};
  const earlier = previous?.name ? makeName(previous.name) : null;
  const name = String(current?.name ?? '').trim();
  if ((!name || name === defaultName || name === earlier) && spell?.name) {
    out.name = makeName(spell.name);
  }
  const img = current?.img;
  if ((!img || img === defaultImg || (previous?.img && img === previous.img)) && spell?.img) {
    out.img = spell.img;
  }
  return out;
}

/**
 * Everything to update on a scroll when a spell is dropped on it.
 * @param {{name?: string, img?: string, system?: {rank?: number, spellSource?: object}}} scroll
 * @param {{name?: string, img?: string, uuid?: string, system?: object}} spell  The dropped spell
 * @param {object} spellSystem  The spell's system source data
 * @param {{makeName: Function, defaultName: string, defaultImg: string}} defaults
 * @returns {object}  Update data for the scroll (name, img and system)
 */
export function assignment(scroll, spell, spellSystem, defaults) {
  const previous = scroll?.system?.spellSource?.name ? scroll.system.spellSource : null;
  return {
    ...lookFrom(scroll, previous, spell, defaults),
    system: {
      ...systemFrom(spellSystem, scroll?.system?.rank ?? 1),
      spellSource: sourceOf(spell),
    },
  };
}

/** What a scroll's spell source looks like when nothing is on it. */
export const EMPTY_SOURCE = Object.freeze({ uuid: '', name: '', identifier: '', img: '' });
