import { isLimited, usesLeft } from './uses.mjs';

/*
 * The quick bar: a row above the hotbar for the crawler you have selected. It lists
 * that crawler's hotlisted skills, spells and gear, in hotlist order, up to the
 * hotlist's count. A click uses an item (hold Shift to skip its pop-up). Keys 1 to 9
 * use the first nine; each key can be changed in Foundry's controls settings.
 */

const NS = 'carl-rpg';
const SLOTS = 9;
const SLOT_TYPES = ['skill', 'spell', 'gear'];

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

/** The hotlisted skills, spells and gear of a crawler, in order (up to nine). */
export function quickBarItems(actor) {
  const { size, items } = actor.system.hotlist;
  return items
    .slice(0, size)
    .map((id) => actor.items.get(id))
    .filter((item) => item && SLOT_TYPES.includes(item.type))
    .slice(0, SLOTS);
}

/** The tooltip: the Short Description as plain text, or the name if there is none. */
function tooltipOf(item) {
  const html = item.system.shortDescription ?? '';
  const text = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || item.name;
}

/** Use an item from the bar; a click passes its event, so Shift skips the pop-up. */
function useItem(item, event = {}) {
  return item.roll(event);
}

function slotButton(item, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'carl-quick-slot';
  button.title = tooltipOf(item);
  button.addEventListener('click', (event) => useItem(item, event));

  const key = document.createElement('kbd');
  key.textContent = String(index + 1);

  const name = document.createElement('span');
  name.className = 'carl-quick-name';
  name.textContent = item.name;

  const detail = [];
  if (item.type === 'skill' || item.type === 'spell') {
    detail.push(`${t('CARL_RPG.QuickBar.Rank')} ${item.system.rank ?? 0}`);
  }
  if (item.type === 'spell') {
    detail.push(`${t('CARL_RPG.QuickBar.Mana')} ${item.system.manaCost ?? 0}`);
  }
  if (isLimited(item)) detail.push(t('CARL_RPG.QuickBar.UsesLeft', { n: usesLeft(item) }));
  const info = document.createElement('small');
  info.textContent = detail.join(' · ');

  button.append(key, name, info);
  return button;
}

/** Redraw the bar for the selected crawler, or hide it when none is selected. */
function render() {
  if (!bar) return;
  const actor = selectedCrawler();
  bar.hidden = !actor;
  if (!actor) return;
  bar.replaceChildren(...quickBarItems(actor).map((item, index) => slotButton(item, index)));
}

export function registerQuickBar() {
  // Keys 1 to 9, registered so each person can change them.
  for (let n = 1; n <= SLOTS; n++) {
    game.keybindings.register(NS, `quickBar${n}`, {
      name: t('CARL_RPG.QuickBar.KeyName', { n }),
      editable: [{ key: `Digit${n}` }],
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
