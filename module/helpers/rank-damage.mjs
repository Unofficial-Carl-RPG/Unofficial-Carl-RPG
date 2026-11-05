
/**
 * Rank damage: the `@rankDamage` scalar for a damage formula.
 *
 * A skill, spell or mob ability can put `@rankDamage` in its damage formula (for
 * example `@rankDamage + @str.mod`). When the damage is rolled it becomes the dice
 * for the ability's rank (CONFIG.CARL_RPG.rankDamage: rank 1 is "1", 2-3 "1d2",
 * 4-5 "1d4" ... 20 "2d10"). A weapon or item that rolls with a skill uses that
 * skill's rank, both for its own `@rankDamage` and the skill's. Rank 0, or an item
 * with no rank and no skill, adds nothing ("0"). A natural 20 doubles the dice like
 * any other dice; the flat "1" of rank 1 is not doubled.
 *
 * Two things move the lookup, each a whole number that can be negative:
 *  - the rank bonus  is added to the rank before the table is read (rank 4 with +2
 *                    reads as rank 6)
 *  - the row step    moves that many rows along the table afterwards (rank 4 with
 *                    +1 is the 6-7 row); below the first row is nothing, and the
 *                    last row is the top
 * Both come from the skill's upgrades (changes `rankDamageBonus` and
 * `rankDamageStep`) and from build benefit rows on the actor's effects of the same
 * names, which cover all skills, one skill or the skills with a tag and add together.
 * A skill at rank 0 gets nothing whatever the bonus and step.
 */
import { buildModsOf } from './build-mods.mjs';
import { skillCapRowCovers } from './skill-cap.mjs';

const HAS_TOKEN = /@rankDamage(?![\w.])/;
const TOKEN = /@rankDamage(?![\w.])/g;

/** The item types whose own rank `@rankDamage` reads. */
const RANKED = ['skill', 'spell', 'mobAbility'];

const whole = (n) => Math.trunc(Number(n)) || 0;

/** Whether a formula uses the `@rankDamage` scalar. */
export const usesRankDamage = (formula) => HAS_TOKEN.test(String(formula ?? ''));

/**
 * The dice for a rank.
 * @param {number} rank
 * @param {{bonus?: number, step?: number}} [moves]  See the top of this file
 * @returns {string}  A dice formula, or '' for nothing
 */
export function rankDamageFormula(rank, { bonus = 0, step = 0 } = {}) {
  const rows = CONFIG.CARL_RPG.rankDamage;
  const base = whole(rank);
  if (base <= 0) return '';
  const lookup = base + whole(bonus);
  const at = rows.findLastIndex((row) => lookup >= row.from) + whole(step);
  return at < 0 ? '' : rows[Math.min(at, rows.length - 1)].formula;
}

/**
 * The rank bonus and row step an actor's effects give a skill or spell.
 * @param {Actor|null} actor
 * @param {Item|null} item
 * @returns {{bonus: number, step: number}}
 */
export function rankDamageMods(actor, item) {
  let bonus = 0;
  let step = 0;
  for (const row of buildModsOf(actor)) {
    if (row.kind !== 'rankDamageBonus' && row.kind !== 'rankDamageStep') continue;
    if (!skillCapRowCovers(row, item)) continue;
    if (row.kind === 'rankDamageBonus') bonus += whole(row.amount);
    else step += whole(row.amount);
  }
  return { bonus, step };
}

/**
 * The dice `@rankDamage` is right now for a skill, spell or mob ability: its rank,
 * moved by its upgrades and by its owner's effects. '' for any other item.
 * @param {Item|null} item
 * @returns {string}
 */
export function rankDamageOf(item) {
  if (!item || !RANKED.includes(item.type)) return '';
  const system = item.system ?? {};
  const effective = system.effective ?? {};
  const actor = rankDamageMods(item.actor ?? item.parent ?? null, item);
  return rankDamageFormula(system.rank, {
    bonus: whole(effective.rankBonus) + actor.bonus,
    step: whole(effective.rankStep) + actor.step,
  });
}

/**
 * A damage formula with `@rankDamage` worked out from a skill, spell or mob ability
 * (nothing is left of the scalar, so it can be rolled as it is).
 * @param {string} formula
 * @param {Item|null} item  The item whose rank is used
 * @returns {string}
 */
export function expandRankDamage(formula, item) {
  const text = String(formula ?? '');
  if (!usesRankDamage(text)) return text;
  const dice = rankDamageOf(item);
  return text.replace(TOKEN, (match, offset, source) => {
    if (!dice) return '0';
    // Dice with several terms keep together after a minus, times or divide.
    const before = source.slice(0, offset).trimEnd().slice(-1);
    const wrap = before !== '' && '-*/'.includes(before) && dice.includes('+');
    return wrap ? `(${dice})` : dice;
  });
}
