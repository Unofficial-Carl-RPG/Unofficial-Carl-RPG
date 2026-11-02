/**
 * The skill rank cap: the most ranks a skill or spell can reach. A crawler's cap is
 * 15, or 20 while an effect grants the "Skill cap 20" modifier (any value above 0).
 * Pets have no cap. Advancement and the Grant a skill event both stop at it.
 */
export const SKILL_CAP = 15;
export const SKILL_CAP_BOOSTED = 20;

/** The rank cap for an actor's skills and spells (Infinity for a pet). */
export function skillCapOf(actor) {
  if (actor?.type === 'pet') return Infinity;
  return (actor?.system?.bonuses?.skillCap ?? 0) > 0 ? SKILL_CAP_BOOSTED : SKILL_CAP;
}
