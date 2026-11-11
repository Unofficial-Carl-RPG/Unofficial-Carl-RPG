/*
 * Damage of gear that rolls with a skill.
 *
 * Gear ticked Weapon with a Skill check action uses the rolled skill's damage (its
 * base formula with the upgrades reached). With Override damage ticked and a damage
 * formula on the gear, that formula replaces the skill's base formula and the skill's
 * upgrades still apply on top. Gear that isn't a weapon keeps its own damage and adds
 * the skill's.
 */

import { computeEffective } from './upgrades.mjs';

/**
 * The damage text a skill-check item rolls (before @rankDamage is expanded).
 * @param {object} gear         The item's system data (weapon, overrideDamage, damage)
 * @param {object} skillSystem  The rolled skill's system data
 * @returns {string}
 */
export function rolledDamageText(gear, skillSystem) {
  const own = String(gear?.damage ?? '').trim();
  const skillDamage = String(skillSystem?.effective?.damage ?? '').trim();
  if (!gear?.weapon) return [own, skillDamage].filter(Boolean).join(' + ');
  if (!gear.overrideDamage || !own) return skillDamage;
  // The gear's formula stands in for the skill's base; its upgrades still apply.
  const view = Object.create(skillSystem, { damage: { value: own } });
  return String(computeEffective(view).damage ?? '').trim();
}

/**
 * Gear saved before Weapon existed: it counts as a weapon when it rolled a skill or had
 * damage, and keeps using its own damage (Override damage on) when it had any. Only acts
 * on a whole stored item, never on the partial data of an update.
 */
export function migrateWeapon(source) {
  if (source.weapon !== undefined) return source;
  if ([source.slot, source.equipped, source.quantity, source.action].some((v) => v === undefined)) {
    return source;
  }
  const hasDamage = !!String(source.damage ?? '').trim();
  source.weapon = source.action?.type === 'skill' || hasDamage;
  source.overrideDamage = source.weapon && hasDamage;
  return source;
}
