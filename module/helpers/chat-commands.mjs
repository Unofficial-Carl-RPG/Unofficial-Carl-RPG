/**
 * The system's chat commands:
 *
 *   /rest short|long|full [crawler]   a rest for a crawler (its owner, or the
 *                                     GM for any), or for the whole party (GM only,
 *                                     when no crawler is named)
 *   /floor N                          set the floor (GM only)
 *   /days N                           set the days left (GM only)
 *   /aifavor crawler amount           give (or take away, with a minus) AI Favor (GM only)
 *   /announce kind text               a System announcement (GM only); the kinds are
 *                                     those in helpers/system-announcements.mjs, except
 *                                     "died", which needs a crawler
 *
 * The commands are read from the chat box before a message is sent, so nothing is
 * posted as the command itself. A rest goes through restActor / takeRest, which keep
 * the safe-room rules.
 */
import { FLOOR_SETTING, DAYS_SETTING } from './floor.mjs';
import { restActor, takeRest } from './rests.mjs';
import {
  SYSTEM_KINDS,
  announceSystem,
  defaultBanner,
} from './system-announcements.mjs';

const NS = 'carl-rpg';
const REST_KINDS = ['short', 'long', 'full'];
const COMMAND = /^\/(rest|floor|days|aifavor|announce)(?:\s+(.*))?$/i;

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const warn = (key, data) => ui.notifications.warn(t(key, data));

/** The crawler a name refers to (not case-sensitive), if there is one. */
function crawlerNamed(name) {
  const wanted = name.toLowerCase();
  return (
    game.actors.find(
      (actor) => actor.type === 'crawler' && actor.name.toLowerCase() === wanted
    ) ?? null
  );
}

/** The crawler a player rests when they name none: their character, else one they own. */
function ownCrawler() {
  const character = game.user.character;
  if (character?.type === 'crawler' && character.isOwner) return character;
  return game.actors.find((actor) => actor.type === 'crawler' && actor.isOwner) ?? null;
}

/** /rest short|long|full [crawler] */
async function rest(args) {
  const [kind = '', ...nameWords] = args.split(/\s+/).filter(Boolean);
  const rest = kind.toLowerCase();
  if (!REST_KINDS.includes(rest)) return warn('CARL_RPG.Commands.RestUsage');
  const name = nameWords.join(' ');

  // No crawler named: the GM rests the whole party.
  if (!name && game.user.isGM) return takeRest(rest);

  const actor = name ? crawlerNamed(name) : ownCrawler();
  if (!actor) {
    return warn(name ? 'CARL_RPG.Commands.NoSuchCrawler' : 'CARL_RPG.Commands.NoCrawler', {
      name,
    });
  }
  if (!actor.isOwner) return warn('CARL_RPG.Commands.NotYours', { name: actor.name });
  await restActor(actor, rest);
}

/** /floor N (GM only) */
async function floor(args) {
  if (!game.user.isGM) return warn('CARL_RPG.Commands.NotGM', { command: '/floor' });
  if (!/^\d+$/.test(args)) return warn('CARL_RPG.Commands.FloorUsage');
  await game.settings.set(NS, FLOOR_SETTING, Number(args));
  ui.notifications.info(t('CARL_RPG.Commands.FloorSet', { floor: Number(args) }));
}

/** /days N (GM only) */
async function days(args) {
  if (!game.user.isGM) return warn('CARL_RPG.Commands.NotGM', { command: '/days' });
  if (!/^\d+$/.test(args)) return warn('CARL_RPG.Commands.DaysUsage');
  await game.settings.set(NS, DAYS_SETTING, Number(args));
  ui.notifications.info(t('CARL_RPG.Commands.DaysSet', { days: Number(args) }));
}

/**
 * /aifavor crawler amount (GM only). The amount is the favor given; a minus takes
 * favor away. The crawler never goes below 0, and chat says so, as the Dungeon Info
 * button does.
 */
async function aiFavor(args) {
  if (!game.user.isGM) return warn('CARL_RPG.Commands.NotGM', { command: '/aifavor' });
  const words = args.split(/\s+/).filter(Boolean);
  const amount = Math.trunc(Number(words.at(-1)));
  const name = words.slice(0, -1).join(' ');
  if (!name || !Number.isFinite(amount) || amount === 0) {
    return warn('CARL_RPG.Commands.AiFavorUsage');
  }
  const actor = crawlerNamed(name);
  if (!actor) return warn('CARL_RPG.Commands.NoSuchCrawler', { name });

  const total = Math.max(0, actor.system.aiFavor + amount);
  await actor.update({ 'system.aiFavor': total });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="carl-level-card">${t(
      amount > 0 ? 'CARL_RPG.GMTab.FavorAwarded' : 'CARL_RPG.GMTab.FavorLost',
      {
        name: Handlebars.escapeExpression(actor.name),
        amount: Math.abs(amount),
        total,
      }
    )}</div>`,
  });
}

/** /announce kind text (GM only) */
async function announce(args) {
  if (!game.user.isGM) return warn('CARL_RPG.Commands.NotGM', { command: '/announce' });
  const [kind = '', ...words] = args.split(/\s+/).filter(Boolean);
  const text = words.join(' ');
  const kinds = Object.keys(SYSTEM_KINDS).filter((k) => k !== 'died');
  if (!kinds.includes(kind.toLowerCase()) || !text) {
    return warn('CARL_RPG.Commands.AnnounceUsage', { kinds: kinds.join(', ') });
  }
  await announceSystem({
    kind: kind.toLowerCase(),
    text,
    actor: null,
    banner: defaultBanner(kind.toLowerCase()),
  });
}

// Read the chat box before a message is sent. Returning false stops the message
// being posted, so a command never appears in chat.
Hooks.on('chatMessage', (chatLog, text) => {
  const match = COMMAND.exec(text.trim());
  if (!match) return;
  const [, command, args = ''] = match;
  const run = { rest, floor, days, aifavor: aiFavor, announce }[command.toLowerCase()];
  run(args.trim()).catch((err) => {
    console.error(`${NS} | chat command failed: ${text}`, err);
  });
  return false;
});
