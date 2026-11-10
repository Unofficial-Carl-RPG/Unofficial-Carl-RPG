/**
 * Giving a crawler AI Favor or Popularity, or taking some away: the one place the
 * Dungeon Info buttons, the /aifavor and /popularity chat commands and the macro
 * functions all go through, so they work the same way.
 *
 * Both are whole numbers on the crawler that never go below 0. A grant says so in
 * chat ("Name gained 2 popularity! (now 5)").
 */

/** The fields that can be granted, and the language key prefix of each one's chat line. */
const FIELDS = {
  aiFavor: 'Favor',
  popularity: 'Popularity',
};

/**
 * Add `amount` to a crawler's AI Favor or Popularity (a negative amount takes some
 * away; the total stops at 0) and post a chat card. The caller checks who may do it.
 * @param {Actor} actor     The crawler
 * @param {string} field    aiFavor | popularity
 * @param {number} amount   A whole number other than 0
 * @returns {Promise<number|null>}  the new total, or null if nothing was done (not a
 *   crawler, an unknown field, or an amount that isn't a whole number other than 0)
 */
export async function grantNumber(actor, field, amount) {
  const key = FIELDS[field];
  const change = Math.trunc(Number(amount));
  if (!key || actor?.type !== 'crawler') return null;
  if (!Number.isFinite(change) || change === 0) return null;

  const total = Math.max(0, (Number(actor.system[field]) || 0) + change);
  await actor.update({ [`system.${field}`]: total });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="carl-level-card">${game.i18n.format(
      `CARL_RPG.GMTab.${key}${change > 0 ? 'Awarded' : 'Lost'}`,
      {
        name: Handlebars.escapeExpression(actor.name),
        amount: Math.abs(change),
        total,
      }
    )}</div>`,
  });
  return total;
}
