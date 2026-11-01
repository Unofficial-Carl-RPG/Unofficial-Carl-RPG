/**
 * The target prompt: before an item that targets a number of tokens is used, the
 * player picks them. The picks are set as the user's Foundry targets, which is how
 * attacks already find them, so the rest of the roll is unchanged.
 *
 * The prompt stays open while the player clicks tokens on the map, and shows how
 * many are picked against the limit. Range is checked against the controlled token.
 */
import { CarlRPGDialog } from './dialog.mjs';

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Feet a range allows: a number, melee or touch (5 feet), or unlimited. */
function rangeFeet(range) {
  const r = String(range ?? '').trim().toLowerCase();
  if (r === 'melee' || r === 'touch') return 5;
  const n = Number(r);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

/** Whether a token is an allowed target for a filter (enemies, allies or anyone). */
function matchesFilter(token, filter) {
  const hostile = token.document.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
  if (filter === 'enemies') return hostile;
  if (filter === 'allies') return !hostile;
  return true;
}

/** The token the user is acting with, for range. */
function sourceToken() {
  return canvas.tokens.controlled[0] ?? game.user.character?.getActiveTokens()[0] ?? null;
}

function distance(a, b) {
  return canvas.grid.measurePath([a.center, b.center]).distance;
}

function listHtml(cfg, src, limit) {
  const range = rangeFeet(cfg.range);
  const picked = [...game.user.targets];
  const rows = picked
    .map((token) => {
      const far = src && distance(src, token) > range;
      const note = far ? ` <em>${t('CARL_RPG.Targeting.OutOfRange')}</em>` : '';
      return `<li class="target-row${far ? ' out-of-range' : ''}">
        <span class="target-name">${foundry.utils.escapeHTML(token.name)}</span>${note}
        <button type="button" class="target-remove" data-token="${token.id}">${t('CARL_RPG.Targeting.Remove')}</button>
      </li>`;
    })
    .join('');
  return `<p class="target-count">${t('CARL_RPG.Targeting.Selected', { n: picked.length, m: limit })}</p>
    <ul class="target-list">${rows}</ul>
    <button type="button" class="target-nearest">${t('CARL_RPG.Targeting.Nearest')}</button>`;
}

/**
 * Ask the player to pick the tokens an item affects. Only items that target a
 * number of tokens ask; the rest go straight on.
 * @param {CarlRPGItem} item
 * @returns {Promise<boolean>} false if the player cancelled
 */
export async function chooseTargets(item) {
  const cfg = item.system.targeting;
  if (cfg?.mode !== 'count') return true;
  const limit = Math.max(1, Number(cfg.count) || 1);
  const src = sourceToken();
  const root = { el: null, dialog: null };

  const refresh = () => {
    if (!root.el) return;
    root.el.innerHTML = listHtml(cfg, src, limit);
    const ok = root.dialog?.element.querySelector('button[data-action="ok"]');
    if (ok) ok.disabled = game.user.targets.size < 1;
  };

  // Tokens the filter or the limit rule out are untargeted again as they are picked.
  const onTarget = (user, token, targeted) => {
    if (user.id !== game.user.id) return;
    if (targeted) {
      if (!matchesFilter(token, cfg.filter)) {
        token.setTarget(false, { user: game.user, releaseOthers: false });
        ui.notifications.warn(t('CARL_RPG.Targeting.WrongSide'));
      } else if (game.user.targets.size > limit) {
        token.setTarget(false, { user: game.user, releaseOthers: false });
        ui.notifications.warn(t('CARL_RPG.Targeting.Full', { m: limit }));
      }
    }
    refresh();
  };

  const nearest = () => {
    if (!src) return;
    const pool = canvas.tokens.placeables
      .filter((tk) => tk !== src && !game.user.targets.has(tk) && matchesFilter(tk, cfg.filter))
      .sort((a, b) => distance(src, a) - distance(src, b));
    for (const tk of pool) {
      if (game.user.targets.size >= limit) break;
      tk.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
    }
  };

  Hooks.on('targetToken', onTarget);
  let choice;
  try {
    choice = await CarlRPGDialog.wait({
      window: { title: t('CARL_RPG.Targeting.Title', { name: item.name }) },
      content: '<div class="carl-target-prompt"></div>',
      buttons: [
        { action: 'ok', label: t('CARL_RPG.Targeting.Confirm'), default: true },
        { action: 'cancel', label: t('CARL_RPG.Targeting.Cancel') },
      ],
      render: (event, dialog) => {
        root.dialog = dialog;
        root.el = dialog.element.querySelector('.carl-target-prompt');
        root.el.addEventListener('click', (ev) => {
          const remove = ev.target.closest('.target-remove');
          if (remove) {
            canvas.tokens.get(remove.dataset.token)?.setTarget(false, { user: game.user, releaseOthers: false });
          } else if (ev.target.closest('.target-nearest')) {
            nearest();
          }
        });
        refresh();
      },
    });
  } finally {
    Hooks.off('targetToken', onTarget);
  }
  return choice === 'ok' && game.user.targets.size > 0;
}
