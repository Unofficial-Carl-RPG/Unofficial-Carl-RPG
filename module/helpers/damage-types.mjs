/**
 * Damage types.
 *
 * The GM keeps one list of damage types (a world setting, a comma-separated
 * list). An item can deal one of them (`system.damageType`, blank for none) and can
 * be Armor-Piercing (`system.armorPiercing`: the damage ignores Damage Resistance).
 * An upgrade can change both (see helpers/upgrades.mjs).
 *
 * An effect can make its actor resist (half damage), be immune to (none) or be
 * vulnerable to (double) a type, while it is on. It keeps these in its flags as
 * `damageMods`, a list of `{ type, mode }`, edited on the effect sheet. They are
 * used when damage is applied (see Actor#applyDamage).
 */
const NS = 'carl-rpg';
export const DAMAGE_TYPES_SETTING = 'damageTypes';

/** The world setting: the GM's list of damage types. */
export function registerDamageTypes() {
  game.settings.register(NS, DAMAGE_TYPES_SETTING, {
    name: 'CARL_RPG.Damage.TypesName',
    hint: 'CARL_RPG.Damage.TypesHint',
    scope: 'world',
    config: true,
    type: String,
    default: CONFIG.CARL_RPG.defaultDamageTypes,
  });
}

/** Types added to the starter list after some worlds had already saved their own. */
export const ADDED_DAMAGE_TYPES = ['Slashing', 'Piercing', 'Bludgeoning'];

/** The id an item stores for a damage type name ("Cold Iron" is "cold-iron"). */
export const damageTypeId = (label) =>
  String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The damage types, in the order the GM wrote them.
 * @returns {{id: string, label: string}[]}
 */
export function damageTypes() {
  let raw;
  try {
    raw = game.settings.get(NS, DAMAGE_TYPES_SETTING);
  } catch (err) {
    raw = undefined;
  }
  if (typeof raw !== 'string') raw = CONFIG.CARL_RPG.defaultDamageTypes;
  const seen = new Set();
  const list = [];
  for (const part of raw.split(',')) {
    const label = part.trim();
    const id = damageTypeId(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, label });
  }
  return list;
}

/** A type's name for display (the id itself if it has since left the list). */
export const damageTypeLabel = (id) =>
  damageTypes().find((d) => d.id === id)?.label ?? String(id ?? '');

/** The types for a menu, with "None" first. */
export function damageTypeOptions() {
  return {
    '': game.i18n.localize('CARL_RPG.Damage.NoType'),
    ...Object.fromEntries(damageTypes().map((d) => [d.id, d.label])),
  };
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
  const known = damageTypes().map((d) => d.id);
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
