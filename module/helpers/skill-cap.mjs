/**
 * The skill rank cap: the most ranks a skill or spell can reach. A crawler's cap is
 * 15, or 20 for the skills and spells a "Skill cap 20" build benefit covers (an
 * effect's build benefits, see build-mods.mjs). A row covers all skills and spells,
 * one by its Identifier, every one with a tag, or the ones the player picked. Pets have no cap. Advancement and
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
    case 'pick': {
      // The skills the player picked, by Identifier (see helpers/picks.mjs).
      const identifier = String(item?.system?.identifier ?? '').trim().toLowerCase();
      return (
        identifier !== '' &&
        (row.picks ?? []).some((p) => String(p?.value ?? '').trim().toLowerCase() === identifier)
      );
    }
    default:
      return true;
  }
}

/**
 * The rank cap for one of an actor's skills or spells (Infinity for a pet). Without
 * an item, only a row covering everything counts.
 * @param {Actor} actor
 * @param {Item|null} [item]  The skill or spell
 * @param {{stored?: boolean}} [options]  See buildModsOf
 */
export function skillCapOf(actor, item = null, { stored = false } = {}) {
  if (actor?.type === 'pet') return Infinity;
  const boosted = buildModsOf(actor, { stored }).some(
    (row) => row.kind === 'skillCap' && skillCapRowCovers(row, item)
  );
  return boosted ? SKILL_CAP_BOOSTED : SKILL_CAP;
}
