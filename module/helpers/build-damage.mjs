/**
 * Build benefits that change the damage a race, class or effect's actor deals.
 *
 * Two kinds of build row (see build-mods.mjs), both scoped like Skill cap (all skills and
 * spells, one by Identifier, every one with a tag, or the player's picks). A row covers a use
 * when it covers the item being used or the skill that item rolls with (a sword rolling Slice
 * Attack is covered by a row for the Blade Attack skill or for a tag either of them carries):
 *
 *  - damageDice   `dice` (a die, a number or a formula over the owner's roll data, like
 *                 `1d4 + @str.mod` or Rage's `@health.lost`, the Health Bar slots lost, see
 *                 health-data.mjs), optional `bonusType` and `bonusAlso` (damage types)
 *                 and `when` (the Roll Modifier conditions, see CONFIG.CARL_RPG.rollMods): extra
 *                 damage on the attacks the row covers, rolled like a Roll Modifier's dice (a
 *                 natural 20 doubles its dice, not its numbers; a typed row stays apart from the
 *                 attack's own damage and is resisted on its own type). `melee` is the roll
 *                 pop-up's tick, `within` is measured from the tokens, `hit`/`amazing`/`crit`/
 *                 `miss` read each target. The formula is worked out when the damage is rolled
 *  - damageStat   `from` and `to` (stat ids): the damage formula's `@<from>.mod` becomes
 *                 `@<to>.mod`. Offered as a menu in the roll pop-up ("As written" first), so
 *                 Shift, events and macros keep the formula as written
 *
 * Only effects that are on count. Pure, so it can be checked under plain Node.
 */
import { eachBuildRow } from './build-mods.mjs';
import { skillCapRowCovers } from './skill-cap.mjs';
import { rowTypes, rowTypesProblem } from './damage-types.mjs';
import { reachOf, validFormula } from './upgrades.mjs';
import { whenMet } from './roll-mods.mjs';

const abilityKeys = () => Object.keys(CONFIG.CARL_RPG.abilities);

/** The conditions a damage dice row may use. */
export const diceWhens = () => CONFIG.CARL_RPG.rollMods.allowed.damageDice;

/**
 * Whether a build row covers a use: the item being used, or the skill it rolls with.
 * @param {object} row  A scoped build row
 * @param {Item|null} item   The item used
 * @param {Item|null} [skill]  The skill the use rolls with, when it is not the item itself
 */
export function rowCovers(row, item, skill = null) {
  return [item, skill].filter(Boolean).some((doc) => skillCapRowCovers(row, doc));
}

/**
 * Whether a Bonus damage dice row cannot be used (the sheet warns, the row is skipped). Its
 * `dice` is any rollable formula; an `@name` only has to be readable here (Roll.validate reads
 * each as 1), and is looked up in the roll data when the damage is rolled.
 */
export function diceRowProblem(row) {
  if (!validFormula(row?.dice)) return true;
  if (rowTypesProblem(row)) return true;
  const when = row.when ?? '';
  if (!diceWhens().includes(when)) return true;
  // ("within" needs a distance above 0)
  return when === 'within' && !(Number(String(row.feet ?? '').trim()) > 0);
}

/** Whether a Damage stat row cannot be used: two different stats are needed. */
export function swapRowProblem(row) {
  const stats = abilityKeys();
  return !stats.includes(row?.from) || !stats.includes(row?.to) || row.from === row.to;
}

/** The valid Bonus damage dice rows that cover a use, with the effect each is on. */
function diceRows(actor, item, skill) {
  if (!actor || actor.type === 'mob') return [];
  return [...eachBuildRow(actor)].filter(
    ({ row }) => row.kind === 'damageDice' && !diceRowProblem(row) && rowCovers(row, item, skill)
  );
}

/**
 * Which ticks of the roll pop-up the damage dice in reach care about.
 * @returns {{surprise: boolean, melee: boolean}}
 */
export function diceNeeds(actor, item, skill = null) {
  const rows = diceRows(actor, item, skill);
  return {
    surprise: rows.some(({ row }) => row.when === 'surprise'),
    melee: rows.some(({ row }) => row.when === 'melee'),
  };
}

/**
 * The extra damage dice for one roll, in the shape Roll Modifier dice have (attacks.mjs
 * resolveCheck reads both). Conditions on the roll itself are checked here; degree and distance
 * conditions are kept on the row and read for each target later.
 * @param {Actor|null} actor
 * @param {Item} item   The item used
 * @param {Item|null} skill  The skill it rolls with, when it is not the item itself
 * @param {{mode?: string, surprise?: boolean, melee?: boolean}} [roll]
 * @returns {{item: null, name: string, formula: string, when: string, types: string[], feet?: number}[]}
 */
export function damageDiceFor(actor, item, skill = null, { mode = 'normal', surprise = false, melee = false } = {}) {
  const out = [];
  for (const { row, effect } of diceRows(actor, item, skill)) {
    const when = row.when ?? '';
    if (!whenMet(when, { mode, surprise, melee })) continue;
    out.push({
      item: null,
      name: effect.name,
      formula: String(row.dice).trim(),
      when,
      types: rowTypes(row),
      ...reachOf({ when, feet: row.feet }),
    });
  }
  return out;
}

/**
 * The stat swaps a use can choose from: one per distinct `from` to `to` pair among the
 * Damage stat rows that cover it. With `formula`, only swaps whose `@<from>.mod` is in it.
 * @param {Actor|null} actor
 * @param {Item} item
 * @param {Item|null} [skill]
 * @param {string} [formula]  The damage formula the swap would change
 * @returns {{id: string, from: string, to: string}[]}
 */
export function statSwapsFor(actor, item, skill = null, formula = null) {
  if (!actor || actor.type === 'mob') return [];
  const seen = new Set();
  const out = [];
  for (const { row } of eachBuildRow(actor)) {
    if (row.kind !== 'damageStat' || swapRowProblem(row) || !rowCovers(row, item, skill)) continue;
    const id = `${row.from}>${row.to}`;
    if (seen.has(id)) continue;
    if (formula !== null && !String(formula).includes(`@${row.from}.mod`)) continue;
    seen.add(id);
    out.push({ id, from: row.from, to: row.to });
  }
  return out;
}

/**
 * A damage formula with a swap's stat modifier replaced (`@str.mod` to `@cha.mod`).
 * @param {string} formula
 * @param {{from: string, to: string}|null} swap
 */
export function swapStat(formula, swap) {
  const text = String(formula ?? '');
  if (!swap) return text;
  return text.replaceAll(`@${swap.from}.mod`, () => `@${swap.to}.mod`);
}
