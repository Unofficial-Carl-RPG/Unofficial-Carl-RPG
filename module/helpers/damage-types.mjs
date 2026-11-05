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
