/**
 * The party: its name, its leader and the title each member goes by.
 *
 * The GM designates one crawler as the party leader (Dungeon Info tab). The leader's
 * player can then, from a Party Management section of their own Dungeon Info tab,
 * rename the party and give every crawler a title. A title is shown before the
 * crawler's name in chat (see helpers/crawler-number.mjs).
 *
 * World settings can only be changed by the GM's client, so when the leader makes
 * a change their client asks the GM's over the system socket, and the GM's client
 * checks that the request really is from the leader before making it.
 */
export const PARTY_SETTING = 'partyName';
export const LEADER_SETTING = 'partyLeader';
export const TITLES_SETTING = 'partyTitles';

const NS = 'carl-rpg';
const CHANNEL = 'system.carl-rpg';
const MAX_TITLE = 40;

/** Register the world settings for the party. */
export function registerPartySetting() {
  const redraw = () => ui.carlGM?.render();
  game.settings.register(NS, PARTY_SETTING, {
    name: 'CARL_RPG.GMTab.Party',
    scope: 'world',
    config: false,
    type: new foundry.data.fields.StringField({
      required: true,
      blank: true,
      initial: '',
    }),
    onChange: redraw,
  });
  // The party leader: the id of a crawler (blank for none).
  game.settings.register(NS, LEADER_SETTING, {
    name: 'CARL_RPG.Party.Leader',
    scope: 'world',
    config: false,
    type: new foundry.data.fields.StringField({
      required: true,
      blank: true,
      initial: '',
    }),
    onChange: redraw,
  });
  // The title of each member, by crawler id.
  game.settings.register(NS, TITLES_SETTING, {
    name: 'CARL_RPG.Party.Titles',
    scope: 'world',
    config: false,
    type: new foundry.data.fields.ObjectField({ initial: {} }),
    default: {},
    onChange: redraw,
  });
}

/** The party's name, or a default when none has been set. */
export function getPartyName() {
  let name = '';
  try {
    name = (game.settings.get(NS, PARTY_SETTING) ?? '').trim();
  } catch (err) {
    // Not registered yet (very early in startup).
  }
  return name || game.i18n.localize('CARL_RPG.GMTab.DefaultParty');
}

/* -------------------------------------------- */
/*  Leader and titles                           */
/* -------------------------------------------- */

/** The crawler designated as the party leader, if there is one. */
export function getLeader() {
  let id = '';
  try {
    id = game.settings.get(NS, LEADER_SETTING) ?? '';
  } catch (err) {
    return null;
  }
  const actor = id ? game.actors.get(id) : null;
  return actor?.type === 'crawler' ? actor : null;
}

/** Whether a user plays the party leader (owns the leader crawler). */
export function isLeader(user = game.user) {
  const leader = getLeader();
  return !!leader && !user.isGM && leader.testUserPermission(user, 'OWNER');
}

/** Whether a user may rename the party and set titles: the GM and the leader. */
export const canManageParty = (user = game.user) => user.isGM || isLeader(user);

/** A crawler's title (blank if it has none). */
export function getTitle(actor) {
  if (actor?.type !== 'crawler') return '';
  try {
    return String(game.settings.get(NS, TITLES_SETTING)?.[actor.id] ?? '').trim();
  } catch (err) {
    return '';
  }
}

const cleanTitle = (title) => String(title ?? '').trim().slice(0, MAX_TITLE);

/** Make a change as the GM (or check and make it for a leader who asked). */
async function apply(change) {
  if (change.kind === 'name') {
    await game.settings.set(NS, PARTY_SETTING, String(change.name ?? '').trim());
  } else if (change.kind === 'title') {
    const actor = game.actors.get(change.actorId);
    if (actor?.type !== 'crawler') return;
    const titles = foundry.utils.deepClone(game.settings.get(NS, TITLES_SETTING) ?? {});
    const title = cleanTitle(change.title);
    if (title) titles[actor.id] = title;
    else delete titles[actor.id];
    await game.settings.set(NS, TITLES_SETTING, titles);
  }
}

/** Ask the GM's client to make a change on the leader's behalf. */
function request(change) {
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Party.NoGM'));
    return;
  }
  game.socket.emit(CHANNEL, { type: 'party', userId: game.user.id, change });
}

/** Rename the party (the GM, or the party leader). */
export async function setPartyName(name) {
  if (!canManageParty()) return;
  if (game.user.isGM) return apply({ kind: 'name', name });
  request({ kind: 'name', name });
}

/** Give a crawler a title (the GM, or the party leader). */
export async function setTitle(actorId, title) {
  if (!canManageParty()) return;
  const change = { kind: 'title', actorId, title };
  if (game.user.isGM) return apply(change);
  request(change);
}

/** Designate the party leader (GM only). */
export async function setLeader(actorId) {
  if (!game.user.isGM) return;
  await game.settings.set(NS, LEADER_SETTING, actorId || '');
}

/** The party's members as the Dungeon Info tab lists them: every crawler and its title. */
export function partyMembers() {
  return game.actors
    .filter((actor) => actor.type === 'crawler')
    .map((actor) => ({ id: actor.id, name: actor.name, title: getTitle(actor) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The active GM's client carries out changes asked for by the party leader. */
export function registerPartySocket() {
  game.socket.on(CHANNEL, (message) => {
    if (message?.type !== 'party' || game.user !== game.users.activeGM) return;
    const user = game.users.get(message.userId);
    if (!user || !isLeader(user)) return;
    apply(message.change ?? {});
  });
}
