import { getPartyName } from './party.mjs';

const FLAG = 'announcement';

/**
 * The bosses to announce, found automatically: the boss mobs in the active
 * combat, or if there are none, the boss mobs with a token on the scene being
 * viewed. (A boss is a mob whose kind is set to Boss.)
 * @returns {Array<{id: string, name: string}>}  In order. `id` identifies the
 *   combatant or token, so the GM tab can remember a choice for each boss.
 */
export function findBosses() {
  const isBoss = (actor) =>
    actor?.type === 'mob' && actor.system.mobType === 'boss';

  const inCombat = (game.combat?.combatants ?? [])
    .filter((c) => isBoss(c.actor))
    .map((c) => ({ id: c.id, name: c.name }));
  if (inCombat.length) return inCombat;

  return (canvas.scene?.tokens ?? [])
    .filter((token) => isBoss(token.actor))
    .map((token) => ({ id: token.id, name: token.name }));
}

/**
 * Group bosses into the lines of an announcement. Each "vs" starts a new group
 * (shown as a "vs" line followed by its bosses); a boss joined with "and" goes
 * on the same line as the boss before it. The first boss always follows "vs".
 * So [Tiny vs, Big and, Third vs] is
 *   vs / Tiny and Big
 *   vs / Third
 * @param {Array<{name: string, join?: 'vs'|'and'}>} bosses
 * @returns {string[][]}  The boss names on each line
 */
export function groupBosses(bosses) {
  const lines = [];
  for (const [i, boss] of bosses.entries()) {
    if (i > 0 && boss.join === 'and') lines.at(-1).push(boss.name);
    else lines.push([boss.name]);
  }
  return lines;
}

/**
 * Announce a boss battle to everyone: a chat card, plus a full-screen banner
 * on every connected client that sees the message arrive. It reads like
 *   The Crawlers
 *   vs
 *   Tiny Bossman and Big Bossboy
 *   vs
 *   Third Boss
 * @param {Array<{name: string, join?: 'vs'|'and'}>} [bosses]  The bosses (the
 *   ones found automatically by default, all joined with "vs")
 */
export async function announceBossBattle(bosses = findBosses()) {
  if (!bosses.length) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.GMTab.NoBosses'));
    return;
  }
  const party = getPartyName();
  const lines = groupBosses(bosses);
  const esc = Handlebars.escapeExpression;
  const vs = game.i18n.localize('CARL_RPG.GMTab.Vs');
  const and = game.i18n.localize('CARL_RPG.GMTab.And');
  // The party, then for each group a "vs" line and a line with its boss(es), under a
  // banner (styled in the stylesheet, see helpers/chat-cards.mjs).
  const rows = [
    `<div class="boss-party">${esc(party)}</div>`,
    ...lines.flatMap((names) => [
      `<div class="boss-vs"><span>${esc(vs)}</span></div>`,
      `<div class="boss-names">${names
        .map((n) => `<strong>${esc(n)}</strong>`)
        .join(` <em>${esc(and)}</em> `)}</div>`,
    ]),
  ];
  await ChatMessage.create({
    content: `<div class="carl-announcement-card">
      <div class="boss-banner"><i class="fas fa-skull-crossbones"></i> ${esc(
        game.i18n.localize('CARL_RPG.GMTab.BossBanner')
      )} <i class="fas fa-skull-crossbones"></i></div>
      ${rows.join('')}
    </div>`,
    flags: { 'carl-rpg': { [FLAG]: { party, lines }, card: { kind: 'boss' } } },
  });
}

/** Show the banner on this client whenever an announcement message arrives. */
export function registerAnnouncements() {
  Hooks.on('createChatMessage', (message) => {
    const data = message.getFlag('carl-rpg', FLAG);
    if (data) showAnnouncement(data);
  });
}

/**
 * The full-screen banner. Click it to dismiss, or it closes by itself.
 * @param {{party: string, lines?: string[][], bosses?: string[], boss?: string}} data
 */
function showAnnouncement({ party, lines, bosses, boss }) {
  document.getElementById('carl-announcement')?.remove();

  // Older announcements stored a single boss or a plain list of bosses.
  const groups = lines ?? (bosses ?? (boss ? [boss] : [])).map((n) => [n]);
  const vs = game.i18n.localize('CARL_RPG.GMTab.Vs');
  const and = game.i18n.localize('CARL_RPG.GMTab.And');

  const banner = document.createElement('div');
  banner.id = 'carl-announcement';

  const add = (parent, cls, text) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text; // text only, so names can't inject markup
    parent.append(el);
  };

  add(banner, 'announce-party', party);
  for (const names of groups) {
    // A "vs" on its own line, then the boss(es) it covers on the next line:
    // "Tiny Bossman and Big Bossboy".
    add(banner, 'announce-vs', vs);
    const line = document.createElement('div');
    line.className = 'announce-line';
    names.forEach((name, i) => {
      if (i > 0) add(line, 'announce-and', and);
      add(line, 'announce-boss', name);
    });
    banner.append(line);
  }

  const dismiss = () => {
    banner.classList.add('closing');
    setTimeout(() => banner.remove(), 500);
  };
  banner.addEventListener('click', dismiss);
  setTimeout(dismiss, 7000);
  document.body.append(banner);
}
