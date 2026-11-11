/**
 * Damage types.
 *
 * The GM keeps one list of damage types, edited in the Damage Types form (system settings):
 * each has an id, a label, an icon (a Font Awesome class string), a colour and a description.
 * Modules add their own with `CONFIG.CARL_RPG.damageTypes.register({ id, label, icon, color,
 * description, source })` (also `game.carlRpg.damageTypes`); call it from your module's `init`
 * hook or later. A module type is listed after the GM's own, shows its source, and the GM can
 * hide it or override its label, icon, colour and description, but not its id. If the GM's list
 * already has that id, the GM's type is the one used.
 *
 * Saved as the world setting `damageTypeConfig`: `{ list: [type], modules: { id: overrides } }`.
 * A world that never saved it still reads the old comma-separated `damageTypes` setting.
 *
 * An item can deal one of them (`system.damageType`, blank for none) and can
 * be Armor-Piercing (`system.armorPiercing`: the damage ignores Damage Resistance).
 * An upgrade can change both (see helpers/upgrades.mjs).
 *
 * An effect can make its actor resist (half damage), be immune to (none) or be
 * vulnerable to (double) a type, while it is on. It keeps these in its flags as
 * `damageMods`, a list of `{ type, mode }`, edited on the effect sheet. They are
 * used when damage is applied (see Actor#applyDamage).
 */
const NS = 'carl-rpg';
/** The old setting: a comma-separated list of names. Read only while the config below is unsaved. */
export const DAMAGE_TYPES_SETTING = 'damageTypes';
/** The GM's damage types and their overrides of module types. */
export const DAMAGE_TYPE_CONFIG_SETTING = 'damageTypeConfig';

/** The id an item stores for a damage type name ("Cold Iron" is "cold-iron"). */
export const damageTypeId = (label) =>
  String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * A damage type with every field tidied: the id is a slug (made from the label when blank),
 * the icon keeps only class-name characters, the colour is a #rrggbb hex or blank.
 * @param {object} raw
 * @returns {{id: string, label: string, icon: string, color: string, description: string}}
 */
export function normalizeDamageType(raw) {
  const label = String(raw?.label ?? '').trim();
  const id = damageTypeId(raw?.id || label);
  const color = String(raw?.color ?? '').trim().toLowerCase();
  return {
    id,
    label: label || id,
    icon: String(raw?.icon ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 -]+/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    color: HEX_COLOR.test(color) ? color : '',
    description: String(raw?.description ?? '').trim(),
  };
}

/** The starter list, as rows (a copy the form can edit). */
export const defaultDamageTypeList = () =>
  CONFIG.CARL_RPG.damageTypeDefaults.map((d) => normalizeDamageType(d));

/* -------------------------------------------- */
/*  The registry modules add types to           */
/* -------------------------------------------- */

const registered = new Map();

/** What a module calls: CONFIG.CARL_RPG.damageTypes and game.carlRpg.damageTypes. */
export const damageTypeRegistry = {
  /**
   * Add (or replace) a damage type.
   * @param {object} entry  {id?, label, icon?, color?, description?, source?}; the id is made
   *   from the label when blank; `source` is the module id, shown in the GM's form
   * @returns {object} The type as it is kept
   */
  register(entry) {
    const type = normalizeDamageType(entry);
    if (!type.id) throw new TypeError('carl-rpg | A damage type needs a label or an id.');
    registered.set(type.id, { ...type, source: String(entry?.source ?? '').trim() });
    return { ...registered.get(type.id) };
  },
  /** Take a type back out; true if it was there. */
  unregister(id) {
    return registered.delete(damageTypeId(id));
  },
  /** One registered type (not the GM's own), or undefined. */
  get(id) {
    const type = registered.get(damageTypeId(id));
    return type ? { ...type } : undefined;
  },
  /** Every registered type, in the order they were added. */
  list() {
    return [...registered.values()].map((type) => ({ ...type }));
  },
  /** Empty the registry (for tests). */
  _clear() {
    registered.clear();
  },
};

/** The world settings, and the registry for modules. */
export function registerDamageTypes() {
  // The old comma-separated list: no longer shown, read only until the form is first saved.
  game.settings.register(NS, DAMAGE_TYPES_SETTING, {
    name: 'CARL_RPG.Damage.TypesName',
    scope: 'world',
    config: false,
    type: String,
    default: CONFIG.CARL_RPG.defaultDamageTypes,
  });
  game.settings.register(NS, DAMAGE_TYPE_CONFIG_SETTING, {
    name: 'CARL_RPG.Damage.TypesName',
    scope: 'world',
    config: false,
    type: new foundry.data.fields.ObjectField({ initial: {} }),
    default: {},
  });
  game.carlRpg ??= {};
  game.carlRpg.damageTypes = damageTypeRegistry;
}

/** Types added to the starter list after some worlds had already saved their own. */
export const ADDED_DAMAGE_TYPES = ['Slashing', 'Piercing', 'Bludgeoning'];

/**
 * The damage types as they stand: the GM's list in order, then the module types the GM's list
 * lacks (with the GM's overrides). Pure: the settings and the registry are passed in.
 * @param {object} [p]
 * @param {object} [p.config]  The saved `damageTypeConfig`
 * @param {string} [p.legacy]  The old comma-separated list, used while `config.list` is unsaved
 * @param {object[]} [p.registered]  The registry's types
 * @returns {{id, label, icon, color, description, module: boolean, hidden: boolean, source: string}[]}
 */
export function resolveDamageTypes({ config, legacy, registered: reg = damageTypeRegistry.list() } = {}) {
  const saved = config && typeof config === 'object' ? config : {};
  let own;
  if (Array.isArray(saved.list)) {
    own = saved.list.map(normalizeDamageType);
  } else {
    const names = typeof legacy === 'string' ? legacy : CONFIG.CARL_RPG.defaultDamageTypes;
    own = names.split(',').map((name) => {
      const type = normalizeDamageType({ label: name });
      const starter = defaultDamageTypeList().find((d) => d.id === type.id);
      return starter ? { ...type, icon: starter.icon, color: starter.color, description: starter.description } : type;
    });
  }
  const seen = new Set();
  const list = [];
  for (const type of own) {
    if (!type.id || seen.has(type.id)) continue;
    seen.add(type.id);
    list.push({ ...type, module: false, hidden: false, source: '' });
  }
  const overrides = saved.modules && typeof saved.modules === 'object' ? saved.modules : {};
  for (const entry of reg) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const over = overrides[entry.id] ?? {};
    const type = normalizeDamageType({
      id: entry.id,
      label: over.label || entry.label,
      icon: over.icon || entry.icon,
      color: over.color || entry.color,
      description: over.description || entry.description,
    });
    list.push({ ...type, module: true, hidden: !!over.hidden, source: entry.source ?? '' });
  }
  return list;
}

const readSetting = (key) => {
  try {
    return game.settings.get(NS, key);
  } catch (err) {
    return undefined;
  }
};

/**
 * Every damage type, the ones the GM hid included (so an item or effect that already uses one
 * still has its name and stays valid).
 * @returns {{id, label, icon, color, description, module: boolean, hidden: boolean, source: string}[]}
 */
export const allDamageTypes = () =>
  resolveDamageTypes({
    config: readSetting(DAMAGE_TYPE_CONFIG_SETTING),
    legacy: readSetting(DAMAGE_TYPES_SETTING),
  });

/** The damage types to offer in menus: all but the hidden ones, in the GM's order. */
export const damageTypes = () => allDamageTypes().filter((d) => !d.hidden);

/** A type's name for display (the id itself if it has since left the list). */
export const damageTypeLabel = (id) =>
  allDamageTypes().find((d) => d.id === id)?.label ?? String(id ?? '');

/** The types for a menu, with "None" first. */
export function damageTypeOptions() {
  return {
    '': game.i18n.localize('CARL_RPG.Damage.NoType'),
    ...Object.fromEntries(damageTypes().map((d) => [d.id, d.label])),
  };
}

/**
 * What is wrong with a list the form is about to save, as a key under CARL_RPG.Damage.Menu.Problem
 * (null when it is fine): a blank label or id, or an id used twice.
 * @param {{id: string, label: string}[]} list
 * @returns {'EmptyLabel'|'EmptyId'|'DuplicateId'|null}
 */
export function damageTypeListProblem(list) {
  const seen = new Set();
  for (const type of list) {
    if (!String(type?.label ?? '').trim()) return 'EmptyLabel';
    const id = damageTypeId(type.id);
    if (!id) return 'EmptyId';
    if (seen.has(id)) return 'DuplicateId';
    seen.add(id);
  }
  return null;
}

/**
 * Save the GM's list and their overrides of module types.
 * @param {{list: object[], modules: object}} data
 */
export async function saveDamageTypes({ list, modules }) {
  const keep = (value) => (value === '' || value === false || value == null ? undefined : value);
  const overrides = {};
  for (const [id, over] of Object.entries(modules ?? {})) {
    const row = {
      label: keep(String(over?.label ?? '').trim()),
      icon: keep(normalizeDamageType({ label: 'x', icon: over?.icon }).icon),
      color: keep(normalizeDamageType({ label: 'x', color: over?.color }).color),
      description: keep(String(over?.description ?? '').trim()),
      hidden: keep(!!over?.hidden),
    };
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length) overrides[id] = clean;
  }
  await game.settings.set(NS, DAMAGE_TYPE_CONFIG_SETTING, {
    list: list.map(normalizeDamageType),
    modules: overrides,
  });
}

/**
 * How an actor's effects that are on treat a damage type.
 * @param {Actor} actor
 * @param {string} type
 * @returns {Set<'resist'|'immune'|'vulnerable'>}
 */
export function damageModesOf(actor, type) {
  const modes = new Set();
  if (!type) return modes;
  for (const effect of actor?.effects ?? []) {
    if (effect.disabled || effect.isSuppressed) continue;
    for (const row of effect.getFlag?.(NS, 'damageMods') ?? []) {
      if (row?.type === type && row.mode in CONFIG.CARL_RPG.damageModes) modes.add(row.mode);
    }
  }
  return modes;
}

/** What the damage is multiplied by: immune 0, resist ½, vulnerable 2 (resist and vulnerable cancel). */
export function damageMultiplier(modes) {
  if (modes.has('immune')) return 0;
  const resist = modes.has('resist');
  const vulnerable = modes.has('vulnerable');
  return resist && !vulnerable ? 0.5 : vulnerable && !resist ? 2 : 1;
}

/**
 * Damage of a type, as the actor takes it (halves round down).
 * @param {number} amount
 * @param {Actor} actor
 * @param {string} type
 * @returns {{amount: number, multiplier: number}}
 */
export function adjustForType(amount, actor, type) {
  const multiplier = damageMultiplier(damageModesOf(actor, type));
  return { amount: Math.floor(amount * multiplier), multiplier };
}

/*  Bonus dice with a type of their own         */

/**
 * The types a bonus row names (a Damage Effect's or Roll Modifier's extra dice): its type and
 * the optional second one, without blanks or repeats. Empty means untyped: the dice take the
 * attack's own type.
 * @param {{bonusType?: string, bonusAlso?: string}} change
 * @returns {string[]}
 */
export function rowTypes(change) {
  const first = String(change?.bonusType ?? '').trim();
  const second = String(change?.bonusAlso ?? '').trim();
  return first ? [...new Set([first, second].filter(Boolean))] : [];
}

/** Whether a bonus row names a type it cannot use: one off the GM's list, or a second with no first. */
export function rowTypesProblem(change) {
  const first = String(change?.bonusType ?? '').trim();
  const second = String(change?.bonusAlso ?? '').trim();
  if (second && !first) return true;
  const known = allDamageTypes().map((d) => d.id);
  return [first, second].some((id) => id && !known.includes(id));
}

/**
 * An amount split evenly between some types; the first gets any odd points, so nothing is lost.
 * @param {number} amount
 * @param {number} count  How many types
 * @returns {number[]}
 */
export function splitAmount(amount, count) {
  const total = Math.max(0, Math.floor(Number(amount) || 0));
  const n = Math.max(1, Math.floor(count) || 1);
  const each = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? total - each * (n - 1) : each));
}

/**
 * One target's damage as parts, one for each damage type, so resistances can act on each on
 * its own. The attack's own damage (with any untyped bonus dice) comes first; a typed bonus
 * is split evenly between the types it names. Parts of one type merge; empty ones are left out.
 * An attack with a second type (`alsoType`) splits all its own-type damage (the dice and any
 * untyped bonus dice) evenly between the two, the first getting an odd point; a second type
 * does nothing on an attack with no type of its own, or the same one.
 * @param {number} base  The attack's own damage
 * @param {string} baseType  The attack's damage type ('' for none)
 * @param {{types: string[], amount: number}[]} [typed]  The typed bonus dice, rolled
 * @param {string} [alsoType]  The attack's second damage type ('' for none)
 * @returns {{type: string, amount: number}[]}
 */
export function damageParts(base, baseType, typed = [], alsoType = '') {
  const own = baseType ?? '';
  const also = own && alsoType && alsoType !== own ? alsoType : '';
  const parts = [];
  const add = (type, amount) => {
    if (!(amount > 0)) return;
    const part = parts.find((p) => p.type === type);
    if (part) part.amount += amount;
    else parts.push({ type, amount });
  };
  let ownAmount = Math.floor(Number(base) || 0);
  for (const row of typed) {
    if (!(row.types ?? []).length && row.amount > 0) ownAmount += row.amount;
  }
  if (also) splitAmount(ownAmount, 2).forEach((share, i) => add(i ? also : own, share));
  else add(own, ownAmount);
  for (const row of typed) {
    const types = row.types ?? [];
    if (types.length) splitAmount(row.amount, types.length).forEach((share, i) => add(types[i], share));
  }
  return parts;
}

/** Whether parts say more than one number does: several types, or one that is not the attack's own. */
export const partsMatter = (parts, baseType = '') =>
  parts.length > 1 || (parts.length === 1 && parts[0].type !== (baseType ?? ''));

/** The damage in a list of parts. */
export const partsTotal = (parts) => parts.reduce((sum, p) => sum + p.amount, 0);

/** Parts at a multiplier (x2, x1, x1/2); each part rounds down on its own. */
export const scaleParts = (parts, multiplier) =>
  parts.map((p) => ({ type: p.type, amount: Math.floor(p.amount * multiplier) }));

/**
 * Damage in several types, as the actor takes it: each part is resisted, stopped or doubled by
 * its own type, then they are added up (DR comes off the total afterwards).
 * @param {{type: string, amount: number}[]} parts
 * @param {Actor} actor
 * @returns {{amount: number, changes: {multiplier: number, type: string}[]}}
 *   `changes` are the types that changed their part, for the chat note
 */
export function adjustParts(parts, actor) {
  let amount = 0;
  const changes = [];
  for (const part of parts) {
    const adjusted = adjustForType(part.amount, actor, part.type);
    amount += adjusted.amount;
    if (adjusted.multiplier !== 1 && part.amount > 0) {
      changes.push({ multiplier: adjusted.multiplier, type: part.type });
    }
  }
  return { amount, changes };
}

/** Parts for display: "4 Bludgeoning + 2 Fire" (a part with no type is just its number). */
export function partsLabel(parts) {
  return parts
    .map((p) =>
      p.type
        ? game.i18n.format('CARL_RPG.Damage.Part', { amount: p.amount, type: damageTypeLabel(p.type) })
        : String(p.amount)
    )
    .join(' + ');
}

/** The line for the chat when a type changed the damage (empty when it didn't). */
export function damageTypeNote(multiplier, name, type) {
  const key = { 0: 'Immune', 0.5: 'Resisted', 2: 'Vulnerable' }[multiplier];
  if (!key) return '';
  return game.i18n.format(`CARL_RPG.Damage.${key}`, {
    name,
    type: damageTypeLabel(type),
  });
}

/**
 * A comma-separated list of damage types with any of these names that it lacks added
 * at the end. A list that has them all comes back as it was.
 * @param {string} raw
 * @param {string[]} names
 */
export function withDamageTypes(raw, names) {
  const text = String(raw ?? '');
  const have = new Set(text.split(',').map(damageTypeId).filter(Boolean));
  const add = names.filter((name) => !have.has(damageTypeId(name)));
  if (!add.length) return raw;
  const base = text.replace(/[,\s]+$/, '');
  return base ? `${base}, ${add.join(', ')}` : add.join(', ');
}

/**
 * Migration step: add Slashing, Piercing and Bludgeoning to a world's saved list of
 * damage types (a world that never saved one already gets them from the default).
 */
export async function addPhysicalSubtypes() {
  const raw = game.settings.get(NS, DAMAGE_TYPES_SETTING);
  if (typeof raw !== 'string') return;
  const next = withDamageTypes(raw, ADDED_DAMAGE_TYPES);
  if (next !== raw) await game.settings.set(NS, DAMAGE_TYPES_SETTING, next);
}
