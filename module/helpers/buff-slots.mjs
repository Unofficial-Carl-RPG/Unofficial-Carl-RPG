
/**
 * Buff slots. An actor can have a few buffs on at once (CONFIG.CARL_RPG.maxActiveBuffs).
 * A buff ticked "Stacks" joins a group (its "Stacks as" text, else its identifier or
 * name); every buff of a group shares ONE slot and switches on and off together, so a
 * skill whose upgrades each add to the same buff only ever uses one slot.
 *
 * These helpers are pure: they work on anything shaped like an effect
 * ({ id, kind, disabled, equipControlled, slotGroup }). slotGroup is null for a buff
 * that doesn't stack (see CarlRPGActiveEffect#slotGroup).
 */

/**
 * The group name an effect stacks under, or null when it doesn't stack.
 * @param {string} kind
 * @param {boolean} stacks    The Stacks tick
 * @param {string} stackAs    The "Stacks as" text
 * @param {string} fallback   Its identifier, else its name
 * @returns {string|null}
 */
export function groupNameOf(kind, stacks, stackAs, fallback) {
  if (kind !== 'buff' || !stacks) return null;
  const name = String(stackAs ?? '').trim() || String(fallback ?? '').trim();
  return name ? name.toLowerCase() : null;
}

/** The other effects that share this effect's slot (not equipment-controlled ones). */
export function slotMates(effects, effect) {
  if (!effect.slotGroup) return [];
  return [...effects].filter(
    (e) => e !== effect && e.slotGroup === effect.slotGroup && !e.equipControlled
  );
}

/**
 * The buffs using a slot right now: one entry per slot (the first active member of
 * a group stands for the group). Equipment-controlled buffs use none.
 * @param {Iterable<object>} effects
 * @param {object|null} [skip]  An effect to leave out
 */
export function usedBuffSlots(effects, skip = null) {
  const slots = new Map();
  for (const e of effects) {
    if (e === skip || e.kind !== 'buff' || e.disabled || e.equipControlled) continue;
    const key = e.slotGroup ? `group:${e.slotGroup}` : e.id;
    if (!slots.has(key)) slots.set(key, e);
  }
  return [...slots.values()];
}
