/*
 * The change log: each automatic change (mana spent, actions or uses spent, an event
 * firing) is one line in a collapsed "Changes" section of the roll or card that caused
 * it. A change with no card to go on is posted a moment later as its own whispered
 * note, to the GM and the crawler's owners. Each client posts only its own changes.
 */

const NS = 'carl-rpg';
/** How long a change waits for a card to attach to before it posts as its own note. */
const HOLD_MS = 3000;

/** Changes not yet attached: actor id -> { lines, timer }. */
const pending = new Map();

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

function add(actor, line) {
  if (!actor) return;
  const entry = pending.get(actor.id) ?? { lines: [], timer: null };
  entry.lines.push(line);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => postAlone(actor.id), HOLD_MS);
  pending.set(actor.id, entry);
}

/** The collapsed section that holds the lines. */
const listHtml = (lines) =>
  `<details class="carl-change-log"><summary>${esc(t('CARL_RPG.ChangeLog.Title'))}</summary><ul>${lines
    .map((line) => `<li>${esc(line)}</li>`)
    .join('')}</ul></details>`;

/** Post changes that no card picked up, whispered to the GM and the crawler's owners. */
async function postAlone(actorId) {
  const entry = pending.get(actorId);
  pending.delete(actorId);
  const actor = game.actors.get(actorId);
  if (!entry || !actor) return;
  const whisper = game.users
    .filter((u) => u.isGM || actor.testUserPermission(u, 'OWNER'))
    .map((u) => u.id);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper,
    content: listHtml(entry.lines),
  });
}

export const logMana = (actor, spent, left) =>
  add(actor, t('CARL_RPG.ChangeLog.Mana', { spent, left }));
export const logUse = (actor, left) => add(actor, t('CARL_RPG.ChangeLog.Use', { left }));
export const logAmmo = (actor, spent, name, left) =>
  add(actor, t('CARL_RPG.ChangeLog.Ammo', { spent, name, left }));
export const logActions = (actor, spent, left) =>
  add(actor, t('CARL_RPG.ChangeLog.Actions', { spent, left }));
export const logEvent = (actor, name) => add(actor, t('CARL_RPG.ChangeLog.Event', { name }));

export function registerChangeLog() {
  // The next message the actor's changes belong to takes them as its flag.
  Hooks.on('preCreateChatMessage', (message) => {
    const actorId = message.speaker?.actor;
    const entry = actorId ? pending.get(actorId) : null;
    if (!entry) return;
    pending.delete(actorId);
    clearTimeout(entry.timer);
    message.updateSource({ [`flags.${NS}.changes`]: entry.lines });
  });

  // A card that has changes shows them in a collapsed section under its content.
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const lines = message.getFlag(NS, 'changes');
    if (!lines?.length) return;
    const content = html.querySelector('.message-content');
    if (!content || content.querySelector('.carl-change-log')) return;
    content.insertAdjacentHTML('beforeend', listHtml(lines));
  });
}
