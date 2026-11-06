/**
 * The target prompt: before an item that targets a number of tokens is used, the
 * player picks them. The picks are set as the user's Foundry targets, which is how
 * attacks already find them, so the rest of the roll is unchanged.
 *
 * The prompt stays open while the player clicks tokens on the map, and shows how
 * many are picked against the limit. Range is checked against the controlled token.
 *
 * The number of targets, the number of areas, an area's size, the number it can hold and
 * the range are each a number or a formula over the user's roll data and what was paid
 * (@cost); see helpers/amounts.mjs.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { applyQueuedEffect } from './events.mjs';
import { rangeInfo, wholeAmount } from './amounts.mjs';
import { clearSplash, noteArea, splashBand } from './splash.mjs';

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

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

function listHtml(cfg, src, limit, range) {
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
 * @param {object} [data]  The roll data the formulas read (item.costData(paid))
 * @returns {Promise<boolean>} false if the player cancelled
 */
export async function chooseTargets(item, data = item.costData?.() ?? {}) {
  // (What the last use found in an area's splash is forgotten.)
  clearSplash();
  const cfg = item.system.targeting;
  if (cfg?.mode === 'area') return chooseArea(item, data);
  if (cfg?.mode !== 'count') return true;
  const limit = wholeAmount(cfg.count, data, { min: 1, fallback: 1 });
  const range = rangeInfo(cfg.range, data).feet;
  const src = sourceToken();
  const root = { el: null, dialog: null };

  const refresh = () => {
    if (!root.el) return;
    root.el.innerHTML = listHtml(cfg, src, limit, range);
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

/**
 * Place the item's areas one after another (its "areas per use") with Foundry's own
 * template tool. The tokens picked in each are added to the targets, and the area is
 * cleared again. Escape cancels the rest. An area placed farther from the user's token
 * than the item's range gets a warning (it still goes ahead, as with targets). Players
 * who can't create templates get a warning; the GM places it.
 * @param {CarlRPGItem} item
 * @param {object} [data]  The roll data the formulas read
 * @returns {Promise<boolean>} false if cancelled or not allowed
 */
export async function chooseArea(item, data = item.costData?.() ?? {}) {
  const cfg = item.system.targeting;
  const total = wholeAmount(cfg.areas, data, { min: 1, fallback: 1 });
  const size = wholeAmount(cfg.size, data, { min: 0, fallback: 0 });
  const limit = wholeAmount(cfg.limit, data, { min: 0, fallback: 0 });
  const range = rangeInfo(cfg.range, data).feet;
  const splash = wholeAmount(cfg.splash, data, { min: 0, fallback: 0 });
  for (let n = 1; n <= total; n++) {
    if (!(await placeOneArea(item, n, total, { size, limit, range, splash }))) return false;
  }
  return true;
}

/** Place one area with the template tool (see chooseArea). */
function placeOneArea(item, n, total, { size, limit, range, splash }) {
  const cfg = item.system.targeting;
  if (!game.user.can('TEMPLATE_CREATE')) {
    ui.notifications.warn(t('CARL_RPG.Targeting.NoTemplatePermission'));
    // The GM can place it: a whisper tells them who asked.
    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
      content: t('CARL_RPG.Targeting.GMPlaceAreaNotice', { player: game.user.name, name: item.name }),
    });
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const finish = (ok) => {
      Hooks.off('createMeasuredTemplate', onCreate);
      document.removeEventListener('keydown', onKey, true);
      canvas.tokens.activate();
      resolve(ok);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') finish(false);
    };
    const onCreate = async (doc, options, userId) => {
      if (userId !== game.user.id) return;
      // The item's size sets how far the area reaches; the player places its origin.
      if (size > 0) await doc.update({ distance: size });
      const src = Number.isFinite(range) ? sourceToken() : null;
      if (src && canvas.grid.measurePath([src.center, { x: doc.x, y: doc.y }]).distance > range) {
        ui.notifications.warn(t('CARL_RPG.Targeting.AreaOutOfRange', { name: item.name, m: range }));
      }
      const area = doc.object ?? canvas.templates.get(doc.id);
      const inside = canvas.tokens.placeables.filter(
        (tok) => tok.visible && matchesFilter(tok, cfg.filter) && area?.testPoint(tok.center)
      );
      const picked = limit > 0 ? inside.slice(0, limit) : inside;
      // Splash: tokens outside the area but within the splash distance of its edge. They
      // are targeted too; the attack reads them as splash (see helpers/splash.mjs).
      const candidates = canvas.tokens.placeables.filter((tok) => tok.visible && matchesFilter(tok, cfg.filter));
      const bandIds =
        area && splash > 0
          ? splashBand(
              area.shape,
              splash * (canvas.dimensions?.distancePixels ?? 1),
              candidates.map((tok) => ({ id: tok.id, x: tok.center.x - doc.x, y: tok.center.y - doc.y })),
              inside.map((tok) => tok.id)
            )
          : [];
      const band = candidates.filter((tok) => bandIds.includes(tok.id));
      noteArea(
        item.uuid,
        picked.map((tok) => tok.document.uuid),
        band.map((tok) => tok.document.uuid)
      );
      const ids = new Set([
        ...game.user.targets.map((tk) => tk.id),
        ...picked.map((tok) => tok.id),
        ...band.map((tok) => tok.id),
      ]);
      await game.user.updateTokenTargets([...ids]);
      await areaCard(item, picked, t('CARL_RPG.Targeting.AreaCard', { name: item.name }), band);
      if (cfg.lasting) {
        const rounds = Math.max(0, Number(cfg.lasts) || 0);
        await doc.update({
          fillColor: AREA_COLORS[cfg.kind] ?? doc.fillColor,
          'flags.carl-rpg.area': {
            lasts: rounds,
            roundsLeft: rounds,
            kind: cfg.kind || '',
            itemUuid: item.uuid,
            filter: cfg.filter,
            limit,
          },
        });
      } else {
        await doc.delete();
      }
      finish(true);
    };
    Hooks.on('createMeasuredTemplate', onCreate);
    document.addEventListener('keydown', onKey, true);
    ui.notifications.info(t('CARL_RPG.Targeting.PlaceAreaN', { n, m: total }));
    canvas.templates.activate({ tool: cfg.shape });
  });
}

/** Tint of a lasting area by its kind. */
const AREA_COLORS = { fire: '#c2410c', difficult: '#8a6d3b', poison: '#4d7c0f' };

/**
 * At the end of each round (the GM's client): lasting areas count down, and the
 * ones that run out are removed with a chat note. A lasting area with 0 rounds
 * stays until the GM removes it.
 */
Hooks.on('carlrpg.cleanupPhase', async () => {
  if (game.user !== game.users.activeGM || !canvas.scene) return;
  for (const doc of canvas.scene.templates) {
    const area = doc.getFlag('carl-rpg', 'area');
    if (!area) continue;
    const rounds = Number(area.lasts) || 0;
    if (rounds > 0) {
      const left = (Number(area.roundsLeft) || rounds) - 1;
      if (left < 1) {
        await doc.delete();
        await ChatMessage.create({ content: t('CARL_RPG.Targeting.AreaEnds', { kind: area.kind || 'area' }) });
        continue;
      }
      await doc.update({ 'flags.carl-rpg.area.roundsLeft': left });
    }
    // Lasting areas (rounds or not) show who is inside again, for the GM to apply to.
    const item = area.itemUuid ? await fromUuid(area.itemUuid) : null;
    if (item) await areaCard(item, insideTokens(doc.object, area.filter).slice(0, Number(area.limit) || undefined), t('CARL_RPG.Targeting.AreaCard', { name: item.name }));
  }
});

/** The tokens inside an area (placeable) that the filter allows. */
function insideTokens(area, filter) {
  return canvas.tokens.placeables.filter(
    (tok) => tok.visible && matchesFilter(tok, filter) && area?.testPoint(tok.center)
  );
}

/** The item's effects that can be applied to a target: its applyEffect actions. */
async function applyOptions(item) {
  const out = [];
  for (const event of item.system.events ?? []) {
    for (const [actionIndex, action] of (event.actions ?? []).entries()) {
      if (action.type !== 'applyEffect') continue;
      const name = (await fromUuid(action.uuid))?.name ?? t('CARL_RPG.Events.Missing');
      out.push({ eventId: event.id, actionIndex, name });
    }
  }
  return out;
}

/**
 * A chat card for the GM (whispered): the tokens inside an area, each with an Apply
 * button per effect the item can apply. Nothing is applied automatically.
 */
async function areaCard(item, tokens, label, splashTokens = []) {
  if (!tokens.length && !splashTokens.length) return;
  const options = await applyOptions(item);
  // Tokens in the splash get the Apply buttons only when the item's splash applies effects.
  const splashButtons = !!item.system.targeting?.splashEffects;
  const rowOf = (tok, splash) => {
    const buttons =
      splash && !splashButtons
        ? ''
        : options
            .map(
              (o) =>
                `<button type="button" class="carl-area-apply" data-item="${item.uuid}" data-event="${o.eventId}" data-index="${o.actionIndex}" data-token="${tok.id}">${foundry.utils.escapeHTML(o.name)}</button>`
            )
            .join('');
    const tag = splash ? ` <em>${foundry.utils.escapeHTML(t('CARL_RPG.Targeting.SplashTag'))}</em>` : '';
    return `<li><span>${foundry.utils.escapeHTML(tok.name)}</span>${tag} ${buttons}</li>`;
  };
  const rows = [...tokens.map((tok) => rowOf(tok, false)), ...splashTokens.map((tok) => rowOf(tok, true))].join('');
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
    content: `<div class="carl-area-card"><strong>${foundry.utils.escapeHTML(label)}</strong><ul>${rows}</ul></div>`,
  });
}

Hooks.on('renderChatMessageHTML', (message, html) => {
  if (!game.user.isGM) return;
  for (const el of html.querySelectorAll('.carl-area-apply')) {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      el.disabled = true;
      const ok = await applyQueuedEffect(
        { itemUuid: el.dataset.item, eventId: el.dataset.event, actionIndex: Number(el.dataset.index) },
        canvas.tokens.get(el.dataset.token)?.actor
      );
      if (!ok) el.disabled = false;
    });
  }
});
