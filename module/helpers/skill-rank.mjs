/**
 * The effective rank of a skill or spell: its stored rank moved by the "Skill rank
 * bonus" build benefits on its owner's effects that are on. A row covers all skills and
 * spells, one by its Identifier, every one with a tag, every one of a stat or the ones the
 * player picked (the same scope as Skill cap, see skill-cap.mjs) and holds a whole number,
 * negative allowed; every covering row of every effect adds up.
 *
 * The effective rank is never stored. It is worked out whenever the skill is prepared
 * (`system.effectiveRank`, with `system.rankBonus` the amount the rows add up to) and is
 * the rank everything reads: the roll bonus, the upgrades reached (and the effects they
 * unlock), `@rank` in formulas, `@rankDamage`, Roll Modifiers and Damage Effects, the
 * lists and the quick bar. Advancement, the rank cap and the Grant a skill event keep
 * to the stored rank.
 *
 *  - never below 0 (a skill at rank 0 can be lifted by a positive bonus)
 *  - a bonus never lifts the rank past the skill cap (15, or 20 with Skill cap, none for
 *    a pet); a stored rank already above the cap is left as it is
 *  - a row may hold a minimum (`min`): when the rows add up to a penalty, a skill whose
 *    stored rank is 1 or more is not dropped below the highest minimum of the rows that
 *    cover it (nor lifted above its stored rank). A stored rank of 0 stays 0.
 *    `system.rankMin` is the minimum while it is holding the rank up (else 0) and
 *    `system.rankChange` what the rank really moved by.
 *
 * The rows are read as if effects locked by an upgrade were judged by stored ranks (see
 * `buildModsOf`'s `stored` option), so a rank bonus can never depend on itself.
 */
import { buildModsOf, rankMinOf } from './build-mods.mjs';
import { skillCapOf, skillCapRowCovers } from './skill-cap.mjs';

const whole = (n) => Math.trunc(Number(n)) || 0;

/**
 * What an actor's effects do to the rank of one of its skills or spells.
 * @param {Actor|null} actor
 * @param {Item|null} item  The skill or spell
 * @returns {{bonus: number, min: number}}  `bonus`: a whole number, negative allowed;
 *   `min`: the highest minimum of the covering rows (0: none)
 */
export function skillRankModsOf(actor, item) {
  let bonus = 0;
  let min = 0;
  for (const row of buildModsOf(actor, { stored: true })) {
    if (row.kind !== 'skillRankBonus' || !skillCapRowCovers(row, item)) continue;
    bonus += whole(row.amount);
    min = Math.max(min, rankMinOf(row));
  }
  return { bonus, min };
}

/**
 * What an actor's effects add to the rank of one of its skills or spells.
 * @param {Actor|null} actor
 * @param {Item|null} item  The skill or spell
 * @returns {number}  A whole number, negative allowed
 */
export const skillRankBonusOf = (actor, item) => skillRankModsOf(actor, item).bonus;

/**
 * The rank a minimum holds a penalised skill at: the minimum, never above the stored
 * rank. 0 when no minimum applies (no penalty, no minimum, or a stored rank of 0).
 * @param {number} rank   The stored rank
 * @param {number} bonus  Whole number, negative allowed
 * @param {number} min    The minimum (0: none)
 * @returns {number}
 */
export function rankFloorOf(rank, bonus, min) {
  const base = Math.max(0, whole(rank));
  const least = Math.max(0, whole(min));
  return whole(bonus) < 0 && base >= 1 && least > 0 ? Math.min(base, least) : 0;
}

/**
 * A rank with a bonus added.
 * @param {number} rank   The stored rank
 * @param {number} bonus  Whole number, negative allowed
 * @param {number} [cap]  The skill cap; a bonus does not lift the rank past it
 * @param {number} [min]  A penalty does not drop a rank of 1 or more below it (0: none)
 * @returns {number}
 */
export function effectiveRankOf(rank, bonus, cap = Infinity, min = 0) {
  const base = Math.max(0, whole(rank));
  const add = whole(bonus);
  if (!add) return base;
  const moved = Math.max(0, Math.min(base + add, Math.max(base, cap)));
  return Math.max(moved, rankFloorOf(base, add, min));
}

/**
 * Work out a skill's or spell's effective rank onto its system data (`system.rankBonus`,
 * `system.effectiveRank`, `system.rankChange` and `system.rankMin`).
 * @param {object} system  The skill's system data
 * @param {Item|null} item
 * @param {Actor|null} actor  Its owner, if any
 */
export function applyEffectiveRank(system, item, actor) {
  const { bonus, min } = actor ? skillRankModsOf(actor, item) : { bonus: 0, min: 0 };
  const cap = bonus > 0 ? skillCapOf(actor, item, { stored: true }) : Infinity;
  const base = Math.max(0, whole(system.rank));
  const floor = rankFloorOf(base, bonus, min);
  system.rankBonus = bonus;
  system.effectiveRank = effectiveRankOf(system.rank, bonus, cap, min);
  system.rankChange = system.effectiveRank - base;
  // (the minimum only shows while it is what keeps the rank up)
  system.rankMin = floor > 0 && base + bonus < floor ? floor : 0;
}

/**
 * The rank to read for a skill, spell or mob ability: the effective rank, else the
 * stored one.
 * @param {object|null} system  The item's system data
 * @returns {number}
 */
export const rankOf = (system) => system?.effectiveRank ?? system?.rank ?? 0;
