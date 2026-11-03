import { describeBadges, skillBadges } from './item-badges.mjs';

/*
 * The item tooltip: a small box in the system's own styling that shows an item's name,
 * its badges (stat, damage, costs, Interrupt...) and its description. Any element with
 * `data-item-tip="<item uuid>"` shows it while hovered: the lists on the sheets, the
 * quick bar, stores and loot boxes.
 */

let tip = null;
let current = null;

/**
 * The tooltip's HTML: the name, the same badges the Description tab shows, then the
 * Short Description, or the full Description when there is no short one, with its
 * enrichers (links, inline rolls) applied.
 * @param {Item} item
 * @returns {Promise<string>}
 */
export async function itemTooltipHtml(item) {
  const esc = foundry.utils.escapeHTML;
  const pills = [...describeBadges(item), ...skillBadges(item)]
    .map((badge) => `<span class="item-badge">${esc(badge)}</span>`)
    .join('');
  const short = (item.system.shortDescription ?? '').trim();
  const raw = short || (item.system.description ?? '').trim();
  const body = raw
    ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, {
        secrets: item.isOwner,
        rollData: item.getRollData(),
        relativeTo: item,
      })
    : '';
  return (
    `<div class="quick-tip-name">${esc(item.name)}</div>` +
    (pills ? `<div class="item-badges">${pills}</div>` : '') +
    body
  );
}

/** Hide the tooltip. */
export function hideItemTip() {
  current = null;
  if (tip) tip.hidden = true;
}

/** Show the tooltip above an element (below it if there is no room), inside the window. */
function place(element) {
  tip.hidden = false;
  const rect = element.getBoundingClientRect();
  const left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
  tip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tip.offsetWidth - 8))}px`;
  const above = rect.top - tip.offsetHeight - 8;
  tip.style.top = `${above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - tip.offsetHeight - 8)}px`;
}

async function show(element) {
  const uuid = element.dataset.itemTip;
  if (!uuid) return;
  current = element;
  let item = null;
  try {
    item = await fromUuid(uuid);
  } catch {
    item = null;
  }
  if (current !== element || item?.documentName !== 'Item') return;
  const html = await itemTooltipHtml(item);
  // (The pointer may have moved on while this was prepared.)
  if (current !== element || !element.isConnected) return;
  tip.innerHTML = foundry.utils.cleanHTML(html);
  place(element);
}

export function registerItemTooltip() {
  tip = document.createElement('div');
  tip.id = 'carl-item-tip';
  tip.hidden = true;
  document.body.append(tip);

  document.addEventListener('mouseover', (event) => {
    const element = event.target.closest?.('[data-item-tip]');
    if (!element || element === current) return;
    show(element);
  });
  document.addEventListener('mouseout', (event) => {
    if (!current) return;
    const to = event.relatedTarget;
    if (!to || !current.contains(to)) hideItemTip();
  });
  // Anything that moves or changes what is under the pointer closes it.
  for (const type of ['pointerdown', 'wheel', 'keydown']) {
    document.addEventListener(type, hideItemTip, { capture: true, passive: true });
  }
}
