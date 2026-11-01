/**
 * System announcements: the Show's AI speaking to everyone.
 *
 * The GM sends them from the Dungeon Info tab: pick what kind it is, write what the
 * System says (a crawler's death also names the crawler, with their kills and the
 * floor), and send. Each kind has its own look and icon; the ones that matter most
 * (a floor boss defeated, the stairwell opening, a new floor) can also flash a
 * full-screen banner on every client, like the boss battle announcement. The card is
 * styled in the stylesheet (see helpers/chat-cards.mjs).
 */
import { getFloor } from './floor.mjs';
import { getTitle } from './party.mjs';

const NS = 'carl-rpg';
const FLAG = 'systemAnnouncement';

/**
 * The kinds of announcement: the icon, and whether the full-screen banner is on by
 * default (the GM can change that when sending).
 */
export const SYSTEM_KINDS = {
  died: { icon: 'fa-skull', banner: false },
  boss: { icon: 'fa-crown', banner: true },
  stairs: { icon: 'fa-stairs', banner: true },
  floor: { icon: 'fa-dungeon', banner: true },
  general: { icon: 'fa-bullhorn', banner: false },
};

const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));
const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Whether the banner should be on by default for a kind. */
export const defaultBanner = (kind) => !!SYSTEM_KINDS[kind]?.banner;

/**
 * Announce something as the System (GM only).
 * @param {object} options
 * @param {string} options.kind      A key of SYSTEM_KINDS
 * @param {string} [options.text]    What the System says
 * @param {Actor} [options.actor]    The crawler who died (for the "died" kind)
 * @param {boolean} [options.banner] Also flash the full-screen banner
 */
export async function announceSystem({ kind, text = '', actor = null, banner } = {}) {
  if (!game.user.isGM || !SYSTEM_KINDS[kind]) return;
  const { icon } = SYSTEM_KINDS[kind];
  const floor = getFloor();
  const headline = t(`CARL_RPG.System.Headlines.${kind}`);

  // A fallen crawler: their name (with the title they go by) and what they did.
  const dead = kind === 'died' && actor ? actor : null;
  const name = dead ? [getTitle(dead), dead.name].filter(Boolean).join(' ') : '';
  const kills = dead ? Math.max(0, Math.floor(Number(dead.system.crawlerKills) || 0)) : 0;

  const body = esc(text).replaceAll('\n', '<br>');
  const content = `<div class="carl-system-card">
    <div class="sys-ribbon"><i class="fas ${icon}"></i> ${esc(t('CARL_RPG.System.Ribbon'))} <i class="fas ${icon}"></i></div>
    <div class="sys-headline">${esc(headline)}</div>
    ${name ? `<div class="sys-name">${esc(name)}</div>` : ''}
    ${dead ? `<div class="sys-stats">${esc(t('CARL_RPG.System.Kills', { count: kills }))} &middot; ${esc(t('CARL_RPG.System.FloorLine', { floor }))}</div>` : ''}
    ${body ? `<div class="sys-text">${body}</div>` : ''}
    ${dead ? '' : `<div class="sys-floor">${esc(t('CARL_RPG.System.FloorLine', { floor }))}</div>`}
  </div>`;

  const data = {
    kind,
    icon,
    headline,
    name,
    text: String(text ?? ''),
    floor,
    kills,
    banner: banner ?? defaultBanner(kind),
  };
  await ChatMessage.create({
    content,
    flags: { [NS]: { card: { kind: 'system', system: kind }, [FLAG]: data } },
  });
}

/** Show the banner on this client whenever an announcement that asks for it arrives. */
export function registerSystemAnnouncements() {
  Hooks.on('createChatMessage', (message) => {
    const data = message.getFlag(NS, FLAG);
    if (data?.banner) showSystemBanner(data);
  });
}

/** The full-screen banner. Click it to dismiss, or it closes by itself. */
function showSystemBanner(data) {
  document.getElementById('carl-system-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'carl-system-banner';
  banner.className = `kind-${data.kind}`;

  const add = (cls, text, tag = 'div') => {
    const el = document.createElement(tag);
    el.className = cls;
    el.textContent = text; // text only, so nothing typed can inject markup
    banner.append(el);
    return el;
  };

  const icon = document.createElement('i');
  icon.className = `fas ${data.icon} sys-banner-icon`;
  banner.append(icon);
  add('sys-banner-ribbon', t('CARL_RPG.System.Ribbon'));
  add('sys-banner-headline', data.headline);
  if (data.name) add('sys-banner-name', data.name);
  if (data.text) add('sys-banner-text', data.text);
  add('sys-banner-floor', t('CARL_RPG.System.FloorLine', { floor: data.floor }));

  const dismiss = () => {
    banner.classList.add('closing');
    setTimeout(() => banner.remove(), 500);
  };
  banner.addEventListener('click', dismiss);
  setTimeout(dismiss, 8000);
  document.body.append(banner);
}
