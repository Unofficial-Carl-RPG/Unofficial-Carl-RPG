/**
 * Where the system gets its lists of items from.
 *
 * Several places offer a list of items to choose from: the achievements the GM can
 * award, the races and classes a crawler chooses between, the backgrounds and
 * skills in character creation. By default each list is the world's own items, but
 * the GM can say, for each of them, which item compendiums it also draws from (or
 * not the world's items at all). The choice is a world setting, edited from a
 * button in the system settings (see sheets/sources-settings.mjs).
 *
 * The purposes are in CONFIG.CARL_RPG.compendiumPurposes; each says which item type
 * its list is made of.
 *
 * A player doesn't need permission to open a chosen compendium to see its items in
 * these lists: if their client can't read it, the GM's client supplies the items
 * (see helpers/gm-docs.mjs).
 */
import { listFromGM } from './gm-docs.mjs';

const NS = 'carl-rpg';
export const SOURCES_SETTING = 'compendiumSources';

/** What every purpose starts with: the world's items, and no compendiums. */
function defaults() {
  return Object.fromEntries(
    Object.keys(CONFIG.CARL_RPG.compendiumPurposes).map((purpose) => [
      purpose,
      { world: true, packs: [] },
    ])
  );
}

/** The item types a purpose's list is made of: its main type, then any extra ones. */
export function purposeTypes(purpose) {
  const { type, extraTypes = [] } = CONFIG.CARL_RPG.compendiumPurposes[purpose];
  return [type, ...extraTypes];
}

/**
 * The sources chosen for each purpose: whether the world's items count, and the
 * ids of the compendiums that do.
 * @returns {Object<string, {world: boolean, packs: string[]}>}
 */
export function getSources() {
  const saved = game.settings.get(NS, SOURCES_SETTING) ?? {};
  const sources = defaults();
  for (const purpose of Object.keys(sources)) {
    const entry = saved[purpose];
    if (!entry) continue;
    sources[purpose] = {
      world: entry.world !== false,
      packs: Array.isArray(entry.packs)
        ? entry.packs.filter((id) => typeof id === 'string')
        : [],
    };
  }
  return sources;
}

/**
 * Every item a list can offer: the world's items of the purpose's type (if the
 * world counts) and those of each chosen compendium this user can see. Sorted by
 * name; an item that appears twice is only listed once.
 * @param {string} purpose  A key of CONFIG.CARL_RPG.compendiumPurposes
 * @returns {Promise<Item[]>}
 */
export async function sourceItems(purpose) {
  const types = purposeTypes(purpose);
  const { world, packs } = getSources()[purpose];

  const found = new Map();
  if (world) {
    for (const item of game.items) {
      if (types.includes(item.type)) found.set(item.uuid, item);
    }
  }

  // The chosen compendiums that exist. A player who can't open one of them gets
  // all of the purpose's compendium items from the GM's client instead.
  const chosen = packs
    .map((id) => game.packs.get(id))
    .filter((pack) => pack?.documentName === 'Item');
  const fromPacks =
    !game.user.isGM && chosen.some((pack) => !pack.visible)
      ? await listFromGM(purpose)
      : await readPacks(purpose);
  for (const doc of fromPacks) {
    if (!found.has(doc.uuid)) found.set(doc.uuid, doc);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every actor a purpose offers: the world's actors of its type (if the world counts)
 * and those of each chosen actor compendium this user can see. Sorted by name, with
 * no repeats.
 * @param {string} purpose  A key of CONFIG.CARL_RPG.compendiumPurposes whose documentName is Actor
 * @returns {Promise<Actor[]>}
 */
export async function sourceActors(purpose) {
  const { type } = CONFIG.CARL_RPG.compendiumPurposes[purpose];
  const { world, packs } = getSources()[purpose];

  const found = new Map();
  if (world) {
    for (const actor of game.actors) {
      if (actor.type === type) found.set(actor.uuid, actor);
    }
  }
  for (const id of packs) {
    const pack = game.packs.get(id);
    if (pack?.documentName !== 'Actor' || !pack.visible) continue;
    try {
      for (const doc of await pack.getDocuments({ type })) {
        if (!found.has(doc.uuid)) found.set(doc.uuid, doc);
      }
    } catch (err) {
      console.warn(`carl-rpg | could not read the compendium ${id}`, err);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The items of a purpose's type in the compendiums chosen for it, read directly
 * (compendiums this user can't open are skipped).
 * @param {string} purpose
 * @returns {Promise<Item[]>}
 */
export async function readPacks(purpose) {
  const types = purposeTypes(purpose);
  const { packs } = getSources()[purpose];
  const docs = [];
  for (const id of packs) {
    const pack = game.packs.get(id);
    if (!pack || pack.documentName !== 'Item' || !pack.visible) continue;
    try {
      for (const type of types) docs.push(...(await pack.getDocuments({ type })));
    } catch (err) {
      console.warn(`carl-rpg | could not read the compendium ${id}`, err);
    }
  }
  return docs;
}

/** Register the setting (edited with the Compendium Sources window). */
export function registerSourcesSetting() {
  game.settings.register(NS, SOURCES_SETTING, {
    name: 'CARL_RPG.Sources.Setting',
    scope: 'world',
    config: false,
    type: new foundry.data.fields.ObjectField({ initial: {} }),
    default: {},
  });
}
