/**
 * Leveling up.
 *
 * A crawler earns CONFIG.CARL_RPG.levelUp.pointsPerLevel stat points for every
 * level above 1. They are banked until the floor reaches
 * CONFIG.CARL_RPG.levelUp.spendFloor, then can be spent on stats (+1 each, no
 * cap) with the Spend Points dialog. The GM raises a crawler's level with the
 * Level Up button; a world setting (in the GM tab) lets players do it for their
 * own crawlers too.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { runActorEvents } from './events.mjs';

const NS = 'carl-rpg';

/** Crawlers and pets level up (a pet's points can be spent at any floor). */
const levels = (actor) => ['crawler', 'pet'].includes(actor?.type);
export const PLAYERS_LEVEL_SETTING = 'playersCanLevel';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/* -------------------------------------------- */
/*  Setting                                     */
/* -------------------------------------------- */

export function registerLevelUp() {
  game.settings.register(NS, PLAYERS_LEVEL_SETTING, {
    // A regular system setting (Game Settings -> Configure Settings).
    name: 'CARL_RPG.Level.PlayersSetting',
    hint: 'CARL_RPG.Level.PlayersSettingHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    onChange: () => {
      ui.carlGM?.render();
      // The Level Up button shows or hides on open sheets.
      for (const actor of game.actors) {
        if (levels(actor)) actor.render(false);
      }
    },
  });
}

/** Whether players may level up their own crawlers. */
export function playersCanLevel() {
  try {
    return !!game.settings.get(NS, PLAYERS_LEVEL_SETTING);
  } catch (err) {
    return false;
  }
}

/**
 * Whether a user can press Level Up on a crawler: a GM always can; a player can
 * if the setting allows it and they own the crawler.
 */
export function canLevelUp(user, actor) {
  if (!levels(actor)) return false;
  if (user.isGM) return true;
  return playersCanLevel() && actor.testUserPermission(user, 'OWNER');
}

/* -------------------------------------------- */
/*  Level Up                                    */
/* -------------------------------------------- */

/**
 * Raise a crawler's level by 1 (after confirming), banking more stat points.
 * @param {Actor} actor
 * @returns {Promise<boolean>}  Whether the crawler leveled up
 */
export async function levelUp(actor) {
  if (!canLevelUp(game.user, actor)) return false;

  const level = actor.system.attributes.level.value;
  const points = CONFIG.CARL_RPG.levelUp.pointsPerLevel;
  const esc = Handlebars.escapeExpression;
  const confirmed = await CarlRPGDialog.confirm({
    window: { title: t('CARL_RPG.Level.Confirm.Title') },
    content: `<p>${t('CARL_RPG.Level.Confirm.Content', {
      name: esc(actor.name),
      from: level,
      to: level + 1,
      points,
    })}</p>`,
    yes: { label: t('CARL_RPG.Level.Up') },
    no: { label: t('Cancel') },
    rejectClose: false,
  });
  if (!confirmed) return false;

  await actor.update({ 'system.attributes.level.value': level + 1 });
  Hooks.callAll('carlrpg.levelUp', actor, level + 1);
  runActorEvents(actor, 'levelUp', { level: level + 1 });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="carl-level-card">${t('CARL_RPG.Level.Reached', {
      name: esc(actor.name),
      level: level + 1,
      points,
    })}</div>`,
  });
  return true;
}

/* -------------------------------------------- */
/*  Spending points                             */
/* -------------------------------------------- */

/**
 * Open the Spend Points dialog: +1 to a stat per point, any amounts, as long as
 * the total is within the points available. Points not spent stay banked.
 * @param {Actor} actor
 * @returns {Promise<boolean>}  Whether any points were spent
 */
export async function spendPoints(actor) {
  if (!levels(actor) || !actor.isOwner) return false;
  const { available, canSpend } = actor.system.points;

  if (available < 1) {
    ui.notifications.info(t('CARL_RPG.Level.NoPoints'));
    return false;
  }
  if (!canSpend) {
    ui.notifications.warn(
      t('CARL_RPG.Level.Locked', {
        floor: CONFIG.CARL_RPG.levelUp.spendFloor,
        points: available,
      })
    );
    return false;
  }

  const rows = Object.entries(CONFIG.CARL_RPG.abilities)
    .map(
      ([key, label]) => `<tr>
        <td>${t(label)}</td>
        <td class="current">${actor.system.abilities[key].value}</td>
        <td><input type="number" name="${key}" value="0" min="0" max="${available}" step="1" /></td>
      </tr>`
    )
    .join('');

  const result = await CarlRPGDialog.wait({
    window: { title: t('CARL_RPG.Level.Spend.Title') },
    content: `<p>${t('CARL_RPG.Level.Spend.Content', { points: available })}</p>
      <table class="carl-spend-points"><thead><tr>
        <th>${t('CARL_RPG.Level.Spend.Stat')}</th>
        <th>${t('CARL_RPG.Level.Spend.Now')}</th>
        <th>${t('CARL_RPG.Level.Spend.Add')}</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p class="points-left"></p>`,
    buttons: [
      {
        action: 'apply',
        label: t('CARL_RPG.Level.Spend.Apply'),
        default: true,
        callback: (event, button) => {
          const spend = {};
          for (const key of Object.keys(CONFIG.CARL_RPG.abilities)) {
            spend[key] = Math.max(
              0,
              Math.floor(Number(button.form.elements[key].value)) || 0
            );
          }
          return spend;
        },
      },
      { action: 'cancel', label: t('Cancel') },
    ],
    // Show the points left, and only allow Apply for a valid total.
    render: (event, dialog) => {
      const el = dialog.element;
      const inputs = [...el.querySelectorAll('input[type="number"]')];
      const left = el.querySelector('.points-left');
      const apply = el.querySelector('button[data-action="apply"]');
      const refresh = () => {
        const total = inputs.reduce(
          (sum, i) => sum + Math.max(0, Math.floor(Number(i.value)) || 0),
          0
        );
        left.textContent = t('CARL_RPG.Level.Spend.Left', {
          left: available - total,
        });
        apply.disabled = total < 1 || total > available;
      };
      inputs.forEach((i) => i.addEventListener('input', refresh));
      refresh();
    },
    rejectClose: false,
  });
  if (!result || result === 'cancel') return false;

  const total = Object.values(result).reduce((sum, n) => sum + n, 0);
  // Re-check against the current state in case it changed while the dialog was open.
  if (total < 1 || total > actor.system.points.available) return false;
  if (!actor.system.points.canSpend) return false;

  const updates = { 'system.statPointsSpent': actor.system.statPointsSpent + total };
  const parts = [];
  for (const [key, amount] of Object.entries(result)) {
    if (!amount) continue;
    updates[`system.abilities.${key}.value`] =
      actor.system.abilities[key].value + amount;
    parts.push(`${t(CONFIG.CARL_RPG.abilities[key])} +${amount}`);
  }
  await actor.update(updates);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="carl-level-card">${t('CARL_RPG.Level.Spent', {
      name: Handlebars.escapeExpression(actor.name),
      total,
      stats: parts.join(', '),
    })}</div>`,
  });
  return true;
}
