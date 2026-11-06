
/**
 * Damage Effects.
 *
 * A Damage Effect is a passive skill (`system.damageEffect.enabled`) with its own rank
 * and upgrades. Before rolling to hit with one of the attack skills it lists
 * (`system.damageEffect.skills`, names or identifiers separated by commas), a crawler
 * may choose it in the roll pop-up. At most one effect is used per roll.
 *
 * What an effect does comes from its upgrades (rank 1 is the base text, so its base
 * changes sit in an upgrade at rank 1), through the `de*` change types of
 * CONFIG.CARL_RPG.upgrades.changes. They are folded at the effect's current rank by
 * `effectRules`, never stored:
 *  - addDice         dice or a number added to the base damage (can use @rankDamage, which
 *                    reads the EFFECT's rank); adds up
 *  - baseByRank      the base damage dice result is multiplied by the effect's Rank before
 *                    modifiers and buffs are added
 *  - totalMultiplier the whole damage is multiplied (after modifiers and the Amazing bonus)
 *  - healthMax       only targets at or under this percent of their Health Bar
 *  - sameSize        only targets of the attacker's size
 *  - sizeMax         only targets up to this many sizes above the attacker's (-1 smaller only)
 *  - cooldown        none, once per round, or a number of game hours
 *  - stunOption      the pop-up offers "instead of damage" (the effect's own events apply
 *                    the debuff; they read the `damageOption` condition)
 * The filters (healthMax, sameSize, sizeMax) are checked per target; a target that fails
 * one takes the normal damage.
 *
 * Cooldowns: a round cooldown clears when the round ends (or the combat does); hours pass
 * on rests (CONFIG.CARL_RPG.damageEffects.restHours). The owner can reset one by hand.
 * A cooldown only starts when the effect really changed an attack (it applied to a target
 * that was hit).
 */
import { changeProblem, unlockedUpgrades } from './upgrades.mjs';
import { listAccepts, listEntries } from './skill-list.mjs';

/** Whether an item is a Damage Effect. */
export const isDamageEffect = (item) =>
  item?.type === 'skill' && !!item.system?.damageEffect?.enabled;

/*  Rules                                       */

/**
 * What an effect does at its current rank.
 * @param {object} system  The effect skill's system data (rank, upgrades)
 */
export function effectRules(system) {
  const rules = {
    addDice: [],
    baseByRank: false,
    totalMultiplier: 1,
    healthMax: null,
    sameSize: false,
    sizeMax: null,
    cooldown: { kind: 'none', hours: 0 },
    stunOption: false,
  };
  for (const upgrade of unlockedUpgrades(system)) {
    for (const change of upgrade.changes ?? []) {
      if (changeProblem(change)) continue;
      const value = String(change.value ?? '').trim();
      const n = Math.trunc(Number(value));
      switch (change.type) {
        case 'deAddDice':
          rules.addDice.push(value);
          break;
        case 'deBaseByRank':
          rules.baseByRank = true;
          break;
        case 'deTotalMultiplier':
          rules.totalMultiplier = Number(value);
          break;
        case 'deHealthMax':
          rules.healthMax = Number(value);
          break;
        case 'deSameSize':
          rules.sameSize = true;
          break;
        case 'deSizeMax':
          rules.sizeMax = n;
          break;
        case 'deCooldownHours':
          rules.cooldown = n > 0 ? { kind: 'hours', hours: n } : { kind: 'none', hours: 0 };
          break;
        case 'deCooldownRound':
          rules.cooldown = { kind: 'round', hours: 0 };
          break;
        case 'deCooldownNone':
          rules.cooldown = { kind: 'none', hours: 0 };
          break;
        case 'deStunOption':
          rules.stunOption = n > 0;
          break;
      }
    }
  }
  return rules;
}

/** Whether the effect only works against some targets. */
export const hasFilters = (rules) =>
  rules.healthMax !== null || rules.sameSize || rules.sizeMax !== null;

/**
 * Whether an effect works against one target.
 * @param {object} rules
 * @param {{attackerSize: number, targetSize: number, healthPct: number}} facts
 *   Size Classes (1 to 8) and the target's Health Bar percent
 */
export function appliesTo(rules, { attackerSize, targetSize, healthPct }) {
  if (rules.healthMax !== null && !(healthPct <= rules.healthMax)) return false;
  if (rules.sameSize && targetSize !== attackerSize) return false;
  if (rules.sizeMax !== null && targetSize > attackerSize + rules.sizeMax) return false;
  return true;
}

/** The percent of its Health Bar an actor has left (100 if it has no bar). */
export function healthPercentOf(actor) {
  const health = actor?.system?.health;
  const max = Number(health?.max);
  if (!health || !(max > 0)) return 100;
  return (Number(health.value) / max) * 100;
}

/*  Damage                                      */

/**
 * The sum of the dice in a rolled damage formula (dice that are subtracted count
 * negative), apart from flat numbers and modifiers.
 * @param {Roll|null} roll
 */
export function diceSumOf(roll) {
  let sign = 1;
  let sum = 0;
  for (const term of roll?.terms ?? []) {
    if (term.operator !== undefined) {
      if (term.operator === '-') sign = -1;
      else if (term.operator === '+') sign = 1;
      continue;
    }
    if (term.roll) sum += sign * diceSumOf(term.roll);
    else if (typeof term.faces === 'number') sum += sign * (Number(term.total) || 0);
    sign = 1;
  }
  return sum;
}

/**
 * One target's damage.
 * @param {object} p
 * @param {number} p.total     The rolled damage (dice and modifiers)
 * @param {number} p.diceSum   Just the dice of it
 * @param {number} [p.extra]   What the effect's extra dice rolled
 * @param {number} [p.bonus]   The Amazing Success bonus (the Floor)
 * @param {object|null} p.rules  null when no effect is used
 * @param {number} p.rank      The effect's Rank
 * @param {boolean} p.applies  Whether the effect works against this target
 */
export function damageWithEffect({ total, diceSum, extra = 0, bonus = 0, rules, rank, applies }) {
  if (!rules || !applies) return Math.max(0, Math.floor(total + bonus));
  const dice = rules.baseByRank ? diceSum * Math.max(0, rank) : diceSum;
  const base = dice + (total - diceSum) + extra + bonus;
  return Math.max(0, Math.floor(base * (rules.totalMultiplier ?? 1)));
}

/*  Which effects can be chosen                 */

/** The entries of an effect's list (lower case): attack skill names and #tags (see skill-list.mjs). */
export function acceptedSkills(effect) {
  return listEntries(effect?.system?.damageEffect?.skills);
}

/**
 * Whether an effect lists this attack skill: by name or identifier, or by a #tag the skill
 * or the item being used carries.
 */
export function effectAccepts(effect, skill, item = null) {
  if (!skill) return false;
  return listAccepts(acceptedSkills(effect), skill, item);
}

/** The cooldown an effect is still under: hours left, and whether a round one is running. */
export function cooldownLeft(system) {
  const rules = system.damageRules ?? effectRules(system);
  const { kind, hours } = rules.cooldown;
  const left = Number(system.damageEffect?.cooldownHours) || 0;
  return {
    hours: kind === 'hours' ? Math.min(left, hours) : 0,
    round: kind === 'round' && !!system.damageEffect?.cooldownRound,
  };
}

/** Whether an effect is off cooldown. */
export function isReady(effect) {
  const left = cooldownLeft(effect.system);
  return left.hours <= 0 && !left.round;
}

/**
 * The effects an actor can choose for an attack skill: theirs, listing the skill, off cooldown.
 * @param {Actor|null} actor
 * @param {Item|null} skill  The attack skill (the one the roll uses)
 * @param {Item|null} [used]  The item being used, when it is not the skill (its tags count)
 * @returns {Item[]}
 */
export function availableEffects(actor, skill, used = null) {
  if (!actor || !skill) return [];
  return actor.items.filter(
    (item) => isDamageEffect(item) && effectAccepts(item, skill, used) && isReady(item)
  );
}

/*  Cooldowns                                   */

const relayed = async (doc, data) => {
  const { updateWithRelay } = await import('./relay.mjs');
  return updateWithRelay(doc, data);
};

/** Start an effect's cooldown (nothing for one that has none). */
export async function startCooldown(effect) {
  const { kind, hours } = (effect.system.damageRules ?? effectRules(effect.system)).cooldown;
  if (kind === 'hours') {
    await relayed(effect, { 'system.damageEffect.cooldownHours': hours });
  } else if (kind === 'round') {
    await relayed(effect, { 'system.damageEffect.cooldownRound': true });
  }
}

/** Clear an effect's cooldown by hand. */
export async function resetCooldown(effect) {
  await relayed(effect, {
    'system.damageEffect.cooldownHours': 0,
    'system.damageEffect.cooldownRound': false,
  });
}

/** The effects of an actor that match a test. */
const effectsOf = (actor) => (actor?.items?.filter?.(isDamageEffect) ?? []);

/** A round (or a combat) ended: round cooldowns clear. */
export async function clearRoundCooldowns(actor) {
  const updates = effectsOf(actor)
    .filter((item) => item.system.damageEffect.cooldownRound)
    .map((item) => ({ _id: item.id, 'system.damageEffect.cooldownRound': false }));
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
}

/**
 * Game hours pass because of a rest (a short rest is 1 hour, a long one 8, a full one 24).
 * @param {Actor} actor
 * @param {'short'|'long'|'full'} rest
 */
export async function passRestHours(actor, rest) {
  const hours = CONFIG.CARL_RPG.damageEffects.restHours[rest] ?? 0;
  if (!hours) return;
  const updates = effectsOf(actor)
    .filter((item) => item.system.damageEffect.cooldownHours > 0)
    .map((item) => ({
      _id: item.id,
      'system.damageEffect.cooldownHours': Math.max(0, item.system.damageEffect.cooldownHours - hours),
    }));
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
}
