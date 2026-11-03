/**
 * Items from compendiums a player can't open.
 *
 * Foundry only lets a player read a compendium if they have permission for it. The
 * system's lists (the creation wizard's skills and backgrounds, the race and class
 * choosers, ...) draw items from compendiums the GM has chosen (see
 * helpers/sources.mjs), and the players shouldn't need to be given access to those
 * compendiums to see and use the items. So when a player's client can't read a
 * compendium item, it asks the GM's client for it over the system's socket, and the
 * GM's client sends the item's data back. The player's client builds an ordinary
 * (read-only, in-memory) item from it, with its usual compendium UUID, so the rest
 * of the system treats it like any other item.
 *
 * Two things use this:
 *  - `fromUuid` is wrapped so that, for a player, a compendium item it can't read
 *    comes from the GM instead (so items that refer to other items, like a
 *    background's skills, work too);
 *  - `listFromGM`, which sourceItems uses to get a list of the items in the
 *    compendiums chosen for a purpose.
 *
 * It only works while a GM is connected; with no GM, a player just sees the world's
 * items, as if the compendiums weren't chosen. The GM's client only ever sends
 * Items from item compendiums.
 */
import { readPacks } from './sources.mjs';

const CHANNEL = 'system.carl-rpg';
const TIMEOUT = 8000;
/** Items are sent in batches so no single message is too big. */
const BATCH = 20;

/** Requests waiting for an answer: id -> a function given each message. */
const pending = new Map();
/** Items already fetched this session, by UUID. */
const fetched = new Map();
let warnedNoGM = false;
let originalFromUuid = null;

/** A compendium Item's UUID, with an Active Effect on it if the UUID has one. */
const ITEM_UUID =
  /^(Compendium\.[^.]+\.[^.]+\.Item\.[A-Za-z0-9]{16})(?:\.ActiveEffect\.([A-Za-z0-9]{16}))?$/;

/** Build a read-only item in memory from what the GM sent, keeping its compendium UUID. */
function toItem({ pack, data }) {
  const existing = fetched.get(`Compendium.${pack}.Item.${data._id}`);
  if (existing) return existing;
  const item = new CONFIG.Item.documentClass(data, { pack });
  fetched.set(item.uuid, item);
  return item;
}

/**
 * Ask the active GM's client for something and collect the batches it sends back.
 * @param {object} payload  What to ask for (kind: 'doc' or 'list')
 * @returns {Promise<Array<{pack: string, data: object}>|null>}  null if nobody answered
 */
function ask(payload) {
  return new Promise((resolve) => {
    if (!game.users.activeGM) {
      if (!warnedNoGM) {
        warnedNoGM = true;
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Sources.NoGM'));
      }
      return resolve(null);
    }
    const id = foundry.utils.randomID();
    const entries = [];
    const done = (result) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(result);
    };
    const timer = setTimeout(() => done(null), TIMEOUT);
    pending.set(id, (message) => {
      entries.push(...(message.entries ?? []));
      if (message.part + 1 >= message.parts) done(entries);
    });
    game.socket.emit(CHANNEL, {
      type: 'request',
      id,
      userId: game.user.id,
      ...payload,
    });
  });
}

/** The items in the compendiums chosen for a purpose, as the GM's client sees them. */
export async function listFromGM(purpose) {
  const entries = await ask({ kind: 'list', purpose });
  return (entries ?? []).map(toItem);
}

/** One compendium document (an Item, or an effect on one) from the GM. */
async function docFromGM({ itemUuid, effectId }) {
  let item = fetched.get(itemUuid);
  if (!item) {
    const entries = await ask({ kind: 'doc', uuid: itemUuid });
    if (!entries?.length) return null;
    item = toItem(entries[0]);
  }
  return effectId ? (item.effects.get(effectId) ?? null) : item;
}

/**
 * Wrap fromUuid: if a player's client can't read a compendium item, the GM's
 * client supplies it. Everyone else (and everything that isn't a compendium
 * item) goes through the normal lookup untouched.
 */
export function installFromUuid() {
  originalFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async function (uuid, options) {
    const parsed = typeof uuid === 'string' ? ITEM_UUID.exec(uuid) : null;
    if (!parsed || game.user.isGM) return originalFromUuid(uuid, options);

    let doc = null;
    try {
      doc = await originalFromUuid(uuid, options);
    } catch (err) {
      // (No permission for the compendium: ask the GM instead.)
    }
    return doc ?? (await docFromGM({ itemUuid: parsed[1], effectId: parsed[2] }));
  };
}

/*  The GM's side                               */

const entryOf = (doc) => ({ pack: doc.pack, data: doc.toObject() });

async function answer(message) {
  const send = (extra) =>
    game.socket.emit(CHANNEL, {
      type: 'response',
      id: message.id,
      to: message.userId,
      ...extra,
    });

  let docs = [];
  if (message.kind === 'doc') {
    const parsed = ITEM_UUID.exec(message.uuid ?? '');
    const doc = parsed ? await originalFromUuid(parsed[1]) : null;
    if (doc?.documentName === 'Item') docs = [doc];
  } else if (message.kind === 'list') {
    if (message.purpose in CONFIG.CARL_RPG.compendiumPurposes) {
      docs = await readPacks(message.purpose);
    }
  }

  const batches = Math.max(1, Math.ceil(docs.length / BATCH));
  for (let part = 0; part < batches; part++) {
    send({
      part,
      parts: batches,
      entries: docs.slice(part * BATCH, (part + 1) * BATCH).map(entryOf),
    });
  }
}

/** Listen for requests (the active GM answers them) and for answers (the requester). */
export function registerGMDocs() {
  game.socket.on(CHANNEL, (message) => {
    if (message?.type === 'request') {
      if (game.user === game.users.activeGM) answer(message);
    } else if (message?.type === 'response' && message.to === game.user.id) {
      pending.get(message.id)?.(message);
    }
  });
}
