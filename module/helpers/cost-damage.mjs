
/**
 * Damage that reads what was paid.
 *
 * A damage formula (a skill's, a spell's, a Damage Effect's or Roll Modifier's extra dice, a
 * splash) can use `@cost`, the amount paid for this use: `@cost.mana`, `@cost.junk`,
 * `@cost.uses`, `@cost.ammo`, and `@cost.total` for all of them (a bare `@cost` means
 * `@cost.total`). The amounts are the ones picked in the roll pop-up, so a spell with a
 * ranged Mana cost can hit harder or softer for what is put in. Nothing paid reads as 0.
 *
 * Foundry's rolls have no comparisons, so a formula turns an amount into a step with
 * `min`, `max` and `floor`. Magic Missile (cast for 3 to 6 Mana, 5 being normal):
 *   `1d4 + @int.mod - 2 * max(0, 5 - @cost.mana) + min(1, max(0, @cost.mana - 5)) * @rankDamage`
 * is -4 damage at 3, -2 at 4, normal at 5 and one more rank die at 6.
 */
import { costPaidData } from '../data/costs.mjs';

/** A damage formula with a bare `@cost` read as `@cost.total` (a roll needs a number). */
export const withCost = (formula) =>
  String(formula ?? '').replace(/@cost(?![\w.])/g, '@cost.total');

/**
 * The roll data a damage formula reads: the user's own data plus `cost`, what was paid.
 * @param {object|null|undefined} actorData  The owner's roll data
 * @param {{mana?: number, junk?: number, uses?: number, ammo?: number}} [paid]
 */
export const damageRollData = (actorData, paid = {}) => ({
  ...(actorData ?? {}),
  cost: costPaidData(paid),
});
