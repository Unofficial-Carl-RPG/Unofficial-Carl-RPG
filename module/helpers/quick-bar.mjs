import { isLimited, usesLeft } from './uses.mjs';
import { rankOf } from './skill-rank.mjs';
import { hideItemTip } from './item-tooltip.mjs';

/*
 * The quick bar: a row above the hotbar for the crawler you have selected. It shows
 * every hotlist slot (at least ten, empty ones too) in hotlist order. A click uses
 * an item (hold Shift to skip its pop-up). Keys 1 to 9 and 0 use slots 1 to 10;
 * slots past ten are click-only. Each key can be changed in Foundry's controls settings.
 */

const NS = 'carl-rpg';
const KEYED = 10;
const MIN_SLOTS = 10;
const SLOT_TYPES = ['skill', 'spell', 'gear', 'item'];

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

let bar = null;

/** The crawler selected on the canvas, if the user owns it. */
function selectedCrawler() {
  const controlled = canvas?.tokens?.controlled ?? [];
  return (
    controlled.map((token) => token.actor).find((a) => a?.type === 'crawler' && a.isOwner) ??
    null
  );
}

/** One entry per hotlist slot (at least ten): the item in it, or null if empty. */
export function quickBarItems(actor) {
  const { size, items } = actor.system.hotlist;
  return Array.from({ length: Math.max(MIN_SLOTS, size) }, (_, i) => {
    const item = i < size ? actor.items.get(items[i] ?? '') : null;
    return item && SLOT_TYPES.includes(item.type) ? item : null;
  });
}

/** The key label for a slot: 1 to 9, then 0 for the tenth; none after that. */
const keyLabel = (index) => (index < 9 ? String(index + 1) : index === 9 ? '0' : '');

/** Use an item from the bar; a click passes its event, so Shift skips the pop-up. */
function useItem(item, event = {}) {
  return item.roll(event);
}

function slotButton(item, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'carl-quick-slot';
  const key = document.createElement('kbd');
  key.textContent = keyLabel(index);
  if (!item) {
    button.classList.add('empty');
    button.disabled = true;
    button.append(key);
    return button;
  }
  // Its tooltip box (see item-tooltip.mjs).
  button.dataset.itemTip = item.uuid;
  button.addEventListener('click', (event) => useItem(item, event));

  const name = document.createElement('span');
  name.className = 'carl-quick-name';
  name.textContent = item.name;

  const detail = [];
  if (item.type === 'skill' || item.type === 'spell') {
    detail.push(`${t('CARL_RPG.QuickBar.Rank')} ${rankOf(item.system)}`);
  }
  if (item.type === 'spell') {
    detail.push(`${t('CARL_RPG.QuickBar.Mana')} ${item.costLabels?.().mana || 0}`);
  }
  if (isLimited(item)) detail.push(t('CARL_RPG.QuickBar.UsesLeft', { n: usesLeft(item) }));
  for (const ammo of item.ammoSummary ?? []) {
    if (ammo.owned) detail.push(t('CARL_RPG.QuickBar.AmmoLeft', { name: ammo.name, n: ammo.left }));
  }
  const info = document.createElement('small');
  info.textContent = detail.join(' · ');
  // A weapon shows the rank of the skill it rolls with, as soon as that skill is found.
  if (['gear', 'item'].includes(item.type) && item.usesSkillAction) {
    item.rollingSkill().then((skill) => {
      if (!skill) return;
      detail.unshift(`${t('CARL_RPG.QuickBar.Rank')} ${rankOf(skill.system)}`);
      info.textContent = detail.join(' · ');
    });
  }

  button.append(key, name, info);
  return button;
}

/** Redraw the bar for the selected crawler, or hide it when none is selected. */
function render() {
  if (!bar) return;
  const actor = selectedCrawler();
  bar.hidden = !actor;
  // While the quick bar shows, Foundry's hotbar (the macros bar) is hidden.
  document.body.classList.toggle('carl-quick-bar-active', !!actor);
  if (!actor) return;
  hideItemTip();
  const slots = quickBarItems(actor);
  bar.style.setProperty('--slots', String(slots.length));
  bar.replaceChildren(...slots.map((item, index) => slotButton(item, index)));
}

export function registerQuickBar() {
  // Keys 1 to 9 and 0 (slots 1 to 10), registered so each person can change them.
  for (let n = 1; n <= KEYED; n++) {
    game.keybindings.register(NS, `quickBar${n}`, {
      name: t('CARL_RPG.QuickBar.KeyName', { n }),
      editable: [{ key: `Digit${n % 10}` }],
      onDown: () => {
        const actor = selectedCrawler();
        const item = actor ? quickBarItems(actor)[n - 1] : null;
        if (!item) return false;
        useItem(item, {});
        return true;
      },
    });
  }

  bar = document.createElement('div');
  bar.id = 'carl-quick-bar';
  bar.hidden = true;
  document.body.append(bar);

  for (const hook of ['controlToken', 'updateActor', 'updateItem', 'createItem', 'deleteItem', 'canvasReady']) {
    Hooks.on(hook, () => render());
  }
  Hooks.once('ready', () => render());
}
