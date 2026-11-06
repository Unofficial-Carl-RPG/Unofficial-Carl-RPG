/**
 * The effective rank of a skill or spell: its stored rank moved by the "Skill rank
 * bonus" build benefits on its owner's effects that are on. A row covers all skills and
 * spells, one by its Identifier, or every one with a tag (the same scope as Skill cap,
 * see skill-cap.mjs) and holds a whole number, negative allowed; every covering row of
 * every effect adds up.
 *
 * The effective rank is never stored. It is worked out whenever the skill is prepared
 * (`system.effectiveRank`, with `system.rankBonus` the amount added) and is the rank
 * everything reads: the roll bonus, the upgrades reached (and the effects they
 * unlock), `@rank` in formulas, `@rankDamage`, Roll Modifiers and Damage Effects, the
 * lists and the quick bar. Advancement, the rank cap and the Grant a skill event keep
 * to the stored rank.
 *
 *  - never below 0 (a skill at rank 0 can be lifted by a positive bonus)
 *  - a bonus never lifts the rank past the skill cap (15, or 20 with Skill cap, none for
 *    a pet); a stored rank already above the cap is left as it is
 *
 * The rows are read as if effects locked by an upgrade were judged by stored ranks (see
 * `buildModsOf`'s `stored` option), so a rank bonus can never depend on itself.
 */
import { buildModsOf } from './build-mods.mjs';
import { skillCapOf, skillCapRowCovers } from './skill-cap.mjs';

const whole = (n) => Math.trunc(Number(n)) || 0;

/**
 * What an actor's effects add to the rank of one of its skills or spells.
 * @param {Actor|null} actor
 * @param {Item|null} item  The skill or spell
 * @returns {number}  A whole number, negative allowed
 */
export function skillRankBonusOf(actor, item) {
  let bonus = 0;
  for (const row of buildModsOf(actor, { stored: true })) {
    if (row.kind !== 'skillRankBonus' || !skillCapRowCovers(row, item)) continue;
    bonus += whole(row.amount);
  }
  return bonus;
}

/**
 * A rank with a bonus added.
 * @param {number} rank   The stored rank
 * @param {number} bonus  Whole number, negative allowed
 * @param {number} [cap]  The skill cap; a bonus does not lift the rank past it
 * @returns {number}
 */
export function effectiveRankOf(rank, bonus, cap = Infinity) {
  const base = Math.max(0, whole(rank));
  const add = whole(bonus);
  if (!add) return base;
  return Math.max(0, Math.min(base + add, Math.max(base, cap)));
}

/**
 * Work out a skill's or spell's effective rank onto its system data
 * (`system.rankBonus` and `system.effectiveRank`).
 * @param {object} system  The skill's system data
 * @param {Item|null} item
 * @param {Actor|null} actor  Its owner, if any
 */
export function applyEffectiveRank(system, item, actor) {
  const bonus = actor ? skillRankBonusOf(actor, item) : 0;
  const cap = bonus > 0 ? skillCapOf(actor, item, { stored: true }) : Infinity;
  system.rankBonus = bonus;
  system.effectiveRank = effectiveRankOf(system.rank, bonus, cap);
}

/**
 * The rank to read for a skill, spell or mob ability: the effective rank, else the
 * stored one.
 * @param {object|null} system  The item's system data
 * @returns {number}
 */
export const rankOf = (system) => system?.effectiveRank ?? system?.rank ?? 0;
