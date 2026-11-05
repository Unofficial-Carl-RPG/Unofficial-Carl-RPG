/**
 * The skill rank cap: the most ranks a skill or spell can reach. A crawler's cap is
 * 15, or 20 for the skills and spells a "Skill cap 20" build benefit covers (an
 * effect's build benefits, see build-mods.mjs). A row covers all skills and spells,
 * one by its Identifier, or every one with a tag. Pets have no cap. Advancement and
 * the Grant a skill event both stop at it.
 */
import { buildModsOf } from './build-mods.mjs';
import { itemHasTag } from './tags.mjs';

export const SKILL_CAP = 15;
export const SKILL_CAP_BOOSTED = 20;

/**
 * Whether a Skill cap row covers a skill or spell.
 * @param {{target?: string, value?: string}} row
 * @param {Item|null} item
 */
export function skillCapRowCovers(row, item) {
  const value = String(row.value ?? '').trim();
  switch (row.target) {
    case 'skill':
      return (
        !!item &&
        value !== '' &&
        String(item.system?.identifier ?? '').trim().toLowerCase() === value.toLowerCase()
      );
    case 'tag':
      return !!item && itemHasTag(item, value);
    default:
      return true;
  }
}

/**
 * The rank cap for one of an actor's skills or spells (Infinity for a pet). Without
 * an item, only a row covering everything counts.
 * @param {Actor} actor
 * @param {Item|null} [item]  The skill or spell
 */
export function skillCapOf(actor, item = null) {
  if (actor?.type === 'pet') return Infinity;
  const boosted = buildModsOf(actor).some(
    (row) => row.kind === 'skillCap' && skillCapRowCovers(row, item)
  );
  return boosted ? SKILL_CAP_BOOSTED : SKILL_CAP;
}
