/**
 * Advancing a skill or spell.
 *
 * A crawler tries to raise the rank of a skill or spell that is marked "Can
 * Advance" with a single d20: the roll has to beat the current rank, and a
 * success raises the rank by one. Ranks 4 and below can be tried at any time. From
 * rank 5 a skill is only meant to advance at the end of a floor, so the crawler is
 * reminded of that first, and each skill gets one try per floor (the floor of its
 * last try is kept on the skill, so the next floor starts fresh).
 */
import { CarlRPGDialog } from './dialog.mjs';
import { getFloor } from './floor.mjs';
import { runEvents } from './events.mjs';
import { skillCapOf } from './skill-cap.mjs';

const NS = 'carl-rpg';

/** From this rank on, a skill only advances at the end of a floor, once each. */
export const FLOOR_END_RANK = 5;

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = Handlebars.escapeExpression;

/** Whether a rank 5+ skill has already had its try this floor. */
export function triedThisFloor(item) {
  return (
    item.system.rank >= FLOOR_END_RANK &&
    item.getFlag(NS, 'advanceFloor') === getFloor()
  );
}

/**
 * Try to advance a skill or spell: roll a d20 against its rank and raise the rank
 * on a success.
 * @param {Item} item  A skill or spell on a crawler
 * @returns {Promise<boolean|null>}  Whether it advanced (null if no roll was made)
 */
export async function attemptAdvance(item) {
  const actor = item?.parent;
  if (!['skill', 'spell'].includes(item?.type) || actor?.type !== 'crawler') {
    return null;
  }
  if (!actor.isOwner) return null;
  if (!item.system.advanceable) {
    ui.notifications.warn(t('CARL_RPG.Advance.NotAllowed', { name: esc(item.name) }));
    return null;
  }

  const rank = item.system.rank;
  const floor = getFloor();
  // At the skill rank cap there is nothing to roll for; no try is used up.
  const cap = skillCapOf(actor);
  if (rank >= cap) {
    ui.notifications.warn(t('CARL_RPG.Advance.AtCap', { name: esc(item.name), cap }));
    return null;
  }
  const atFloorEnd = rank >= FLOOR_END_RANK;

  if (atFloorEnd) {
    if (triedThisFloor(item)) {
      ui.notifications.warn(t('CARL_RPG.Advance.AlreadyTried', { name: esc(item.name) }));
      return null;
    }
    // A reminder, not a block: this is meant for the end of a floor.
    const go = await CarlRPGDialog.confirm({
      window: { title: t('CARL_RPG.Advance.Reminder.Title') },
      content: `<p>${t('CARL_RPG.Advance.Reminder.Content', {
        name: esc(item.name),
        rank,
      })}</p>`,
      yes: { label: t('CARL_RPG.Advance.Reminder.Yes') },
      no: { label: t('Cancel') },
      rejectClose: false,
    });
    if (!go) return null;
  }

  const roll = await new Roll('1d20').evaluate();
  const success = roll.total > rank;
  const update = {};
  if (success) {
    update['system.rank'] = rank + 1;
    update[`flags.${NS}.raised`] = true;
  }
  // A rank 5+ skill has used up its try for this floor, win or lose.
  if (atFloorEnd) update[`flags.${NS}.advanceFloor`] = floor;
  if (Object.keys(update).length) await item.update(update);

  const intro = t('CARL_RPG.Advance.Card', {
    name: esc(actor.name),
    item: esc(item.name),
    rank,
  });
  const outcome = success
    ? t('CARL_RPG.Advance.Success', { item: esc(item.name), rank: rank + 1 })
    : t('CARL_RPG.Advance.Fail', { rank });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${intro}<br><strong>${outcome}</strong>`,
    rollMode: game.settings.get('core', 'rollMode'),
    flags: { [NS]: { advance: true } },
  });
  // A rank gained runs the skill's "its rank goes up" events.
  if (success) await runEvents(item, 'advanced', { rank: rank + 1 });
  return success;
}
