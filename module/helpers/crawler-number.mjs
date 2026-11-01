/**
 * What is shown beside a crawler's name wherever the name is shown (its token in
 * a scene, see canvas/token.mjs, chat cards, below, and the sheet header):
 *
 *  - its party title, before the name in chat ("Princess Donut"; see helpers/party.mjs),
 *  - its crawler number, on a new line under the name ("Crawler # 5"), and
 *  - Crawler Killer skulls, one for every other crawler it has killed
 *    (`system.crawlerKills`): up to MAX_SKULL_ICONS skulls, then one skull with
 *    the count ("skull x8").
 *
 * A crawler with no number (0) or no kills shows nothing extra.
 */

import { getTitle } from './party.mjs';

/** Skull icons shown before switching to a single skull with a count. */
export const MAX_SKULL_ICONS = 5;

const SKULL = '\u{1F480}';

/**
 * Whether an actor can have Crawler Killer skulls: crawlers, and mobs of the
 * Crawler kind (which are otherwise just like basic mobs).
 */
export const showsSkulls = (actor) =>
  actor?.type === 'crawler' ||
  (actor?.type === 'mob' && actor.system.mobType === 'crawler');

/** The text to show under a crawler's name, or '' if it has no number. */
export function crawlerNumberLabel(actor) {
  if (actor?.type !== 'crawler') return '';
  const number = actor.system.crawlerNumber;
  if (!(number > 0)) return '';
  return `${game.i18n.localize('CARL_RPG.Actor.Crawler.Header.CrawlerNumber')} ${number}`;
}

/**
 * The Crawler Killer skulls to show for a crawler.
 * @returns {{count: number, icons: number[], overflow: boolean}}
 *   `icons` has one entry per skull to draw; `overflow` means a single skull
 *   with the count is shown instead of one icon per kill.
 */
export function killSkulls(actor) {
  if (!showsSkulls(actor)) return { count: 0, icons: [], overflow: false };
  const count = Math.max(0, Math.floor(Number(actor.system.crawlerKills) || 0));
  const overflow = count > MAX_SKULL_ICONS;
  return {
    count,
    overflow,
    icons: overflow ? [0] : Array.from({ length: count }, (_, i) => i),
  };
}

/** The skulls as text (emoji), for the token's nameplate. */
export function skullText(actor) {
  const { count, overflow } = killSkulls(actor);
  if (!count) return '';
  return overflow ? `${SKULL}\u00D7${count}` : SKULL.repeat(count);
}

/** The skulls as icons, for chat cards. */
function skullHtml(actor) {
  const { count, icons, overflow } = killSkulls(actor);
  if (!count) return '';
  const tip = game.i18n.format('CARL_RPG.Kills.Tooltip', { count });
  const skulls = icons.map(() => '<i class="fa-solid fa-skull"></i>').join('');
  const number = overflow ? `<span class="skull-count">\u00D7${count}</span>` : '';
  return `<span class="message-skulls" title="${Handlebars.escapeExpression(tip)}">${skulls}${number}</span>`;
}

export function registerCrawlerNumber() {
  // Tokens redraw their nameplate when the number, the kills or the name change.
  Hooks.on('updateActor', (actor, changes) => {
    if (!showsSkulls(actor) && changes.system?.mobType === undefined) return;
    const system = changes.system ?? {};
    if (
      !('name' in changes) &&
      system.crawlerNumber === undefined &&
      system.crawlerKills === undefined &&
      system.mobType === undefined
    ) {
      return;
    }
    for (const token of actor.getActiveTokens()) {
      token.renderFlags.set({ refreshNameplate: true });
    }
  });

  // Chat cards spoken by a crawler show its skulls beside the name and its
  // number on a new line under it.
  Hooks.on('renderChatMessageHTML', (message, html) => {
    // The speaker's own actor only (not a user's assigned character, which would
    // put a crawler's number under a player's name).
    const speaker = message.constructor.getSpeakerActor(message.speaker);
    if (!showsSkulls(speaker)) return;
    const sender = html.querySelector('.message-sender');
    if (
      !sender ||
      sender.querySelector('.message-skulls, .message-crawler-number, .message-party-title')
    ) {
      return;
    }

    // The party title goes before the name ("Princess Donut").
    const title = getTitle(speaker);
    if (title) {
      const span = document.createElement('span');
      span.className = 'message-party-title';
      span.textContent = title;
      sender.prepend(span, ' ');
    }

    const skulls = skullHtml(speaker);
    if (skulls) sender.insertAdjacentHTML('beforeend', skulls);

    const label = crawlerNumberLabel(speaker);
    if (label) {
      const line = document.createElement('span');
      line.className = 'message-crawler-number';
      line.textContent = label;
      sender.append(line);
    }
  });
}
