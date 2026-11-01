/**
 * Spending AI Favor on a roll.
 *
 * AI Favor works a little like inspiration: after a crawler rolls, and before the
 * result is announced, they are asked whether to spend 1 AI Favor to reroll the
 * d20. They see what they rolled, but not whether it succeeds. If they spend it
 * the new roll replaces the first (and only it is shown in chat); if they decline,
 * the roll stands.
 *
 * It isn't offered on a natural 20 or a natural 1 (those already decide the
 * result), on a roll with no d20, when the crawler has no AI Favor left, or for
 * anyone who isn't a crawler. Rolls that offer it: item rolls (skills, spells and
 * gear), plain stat checks from the sheet, and a crawler's defending roll against
 * a mob.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { updateWithRelay } from './relay.mjs';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** What the d20 in a roll showed (the one that counts), or null if it has none. */
function naturalOf(roll) {
  const die = roll?.dice?.find((d) => d.faces === 20);
  return die?.results?.find((r) => r.active)?.result ?? null;
}

/**
 * Offer to spend AI Favor to reroll a roll that has just been made but not yet
 * shown.
 * @param {Actor} actor  Whose roll it is
 * @param {Roll} roll    The evaluated roll
 * @returns {Promise<{roll: Roll, spent: boolean, note: string}>}
 *   the roll to use (a new one if AI Favor was spent) and a line to show with it
 */
export async function offerAiFavor(actor, roll) {
  const unchanged = { roll, spent: false, note: '' };
  if (actor?.type !== 'crawler') return unchanged;
  if (!actor.testUserPermission(game.user, 'OBSERVER')) return unchanged;

  const favor = Math.trunc(actor.system.aiFavor ?? 0);
  if (favor < 1) return unchanged;

  const natural = naturalOf(roll);
  if (natural === null || natural === 20 || natural === 1) return unchanged;

  const spend = await CarlRPGDialog.confirm({
    window: { title: t('CARL_RPG.AIFavor.Title') },
    content: `<p>${t('CARL_RPG.AIFavor.Prompt', {
      name: Handlebars.escapeExpression(actor.name),
      total: roll.total,
      favor,
    })}</p>`,
    yes: { label: t('CARL_RPG.AIFavor.Yes') },
    no: { label: t('CARL_RPG.AIFavor.No') },
    rejectClose: false,
  });
  if (!spend) return unchanged;

  // Pay for it first (an Observer's payment goes through the GM's client).
  const paid = await updateWithRelay(actor, { 'system.aiFavor': favor - 1 });
  if (paid === null) return unchanged;

  const again = await roll.reroll();
  return {
    roll: again,
    spent: true,
    note: t('CARL_RPG.AIFavor.Note', { previous: roll.total }),
  };
}
