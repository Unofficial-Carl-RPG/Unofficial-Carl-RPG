/**
 * Summons and minions: the work behind the event action "Summon".
 *
 * Three things a Summon can do (the action's mode):
 *  - place: put tokens of an Actor next to the first targeted token (or the owner's),
 *    with a Size Class set by a formula, so one Actor can follow a spell's rank;
 *  - raise: bring a defeated Mob token back as the caster's ally, with part of its health;
 *  - copy:  split a pet or minion into copies (full copies of its state right now).
 *
 * Every summoned token remembers what made it in flags.carl-rpg.summon on its actor (see
 * minion-side.mjs): the spell, the caster, how many rounds it has left. Rounds count down
 * at each Cleanup; at 0, and when the combat ends, the summon ends: a copy or placed token
 * is deleted, a raised Mob goes down again. A caster can be limited to a number of live
 * summons per spell (the oldest ends first). They count as the caster's pets and minions
 * (the target group "minions").
 *
 * Who runs what: placing and copying follow the Add token rules (the user when they may
 * create tokens and own the actor and the combat, else the GM's client); raising, and
 * anything that has to end an older summon, is the GM's client's job. The numbers (rounds,
 * limit, size, level, health) are worked out in events.mjs and arrive here as a plan.
 */
import { combatOn, freeCells, worldActor } from './summon.mjs';
import { defeatMob } from './defeat.mjs';
import { SUMMON_FLAG, sideOfActor, summonFlag } from './minion-side.mjs';

const NS = 'carl-rpg';

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const warn = (key, data) => ui.notifications.warn(t(key, data));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

/** What a Summon action can do. Anything else counts as place. */
export const SUMMON_MODES = ['place', 'raise', 'copy'];
export const modeOf = (action) => (SUMMON_MODES.includes(action?.mode) ? action.mode : 'place');

/*  Rules that need no Foundry                  */

/**
 * The health a raised Mob comes back with: its max times a fraction (like 0.5), rounded
 * down, at least 1 and at most the max. No fraction (blank) is full health.
 * @param {number} max
 * @param {number|null} fraction
 */
export function raisedHealth(max, fraction) {
  const top = Math.max(1, Math.floor(Number(max) || 1));
  if (fraction === null || fraction === undefined || !Number.isFinite(Number(fraction))) return top;
  return Math.min(top, Math.max(1, Math.floor(top * Number(fraction))));
}

/** Whether a level is within a limit (no limit: any level). */
export function levelAllowed(level, limit) {
  return limit === null || limit === undefined || level <= limit;
}

/** A Size Class held to 1 (Tiny) .. 8 (Gargantuan). */
const clampSize = (sizeClass) => {
  const top = Object.keys(CONFIG.CARL_RPG.sizes).length;
  return Math.min(top, Math.max(1, Math.round(Number(sizeClass) || 1)));
};

/** The size key (`medium`...) of a Size Class. */
export function sizeKeyOf(sizeClass) {
  return Object.keys(CONFIG.CARL_RPG.sizes)[clampSize(sizeClass) - 1];
}

/** How many grid squares wide a token of a Size Class is (CONFIG.CARL_RPG.sizeFootprint). */
export function footprintOf(sizeClass) {
  return CONFIG.CARL_RPG.sizeFootprint?.[clampSize(sizeClass)] ?? 1;
}

/**
 * Making room under a caster's limit: how many to place and how many of the oldest live ones
 * have to end first. A limit of 0 is no limit; asking for more than the limit places only the limit.
 * @param {number} live   Live summons of the caster from this spell
 * @param {number} count  How many the spell wants to place
 * @param {number} limit
 * @returns {{place: number, expire: number}}
 */
export function planLimit(live, count, limit) {
  if (!(limit > 0)) return { place: count, expire: 0 };
  const place = Math.min(count, limit);
  return { place, expire: Math.max(0, live + place - limit) };
}

/** Tokens oldest first (by when the summon was made). */
export function oldestFirst(tokens) {
  return [...tokens].sort((a, b) => (summonFlag(a.actor)?.at ?? 0) - (summonFlag(b.actor)?.at ?? 0));
}

/** The rounds a timed summon has left after a round ends (0 or less: it ends). */
export const roundsAfterTick = (flag) => (Number(flag.roundsLeft) || Number(flag.lasts) || 0) - 1;

/** What a summon is counted under: the spell's Identifier, else its UUID. */
export function summonKey(item) {
  return item?.system?.identifier?.trim() || item?.uuid || '';
}

/** The name of a copy: the original is number 1. */
export const copyName = (name, n) => `${name} (${n})`;

/**
 * What a copy starts from: the original's state right now, as an actor delta, with the
 * summon flag and the caster's players as owners added.
 * @param {object} options
 * @param {object} options.snapshot  name, img, system, items, effects, ownership, flags of the original
 * @param {object} options.flag
 * @param {string[]} options.ownerIds
 */
export function copyDelta({ snapshot, flag, ownerIds }) {
  const delta = foundry.utils.deepClone(snapshot);
  delta.flags = { ...(delta.flags ?? {}), [NS]: { ...(delta.flags?.[NS] ?? {}), [SUMMON_FLAG]: flag } };
  delta.ownership = {
    ...(delta.ownership ?? {}),
    ...Object.fromEntries(ownerIds.map((id) => [id, ownerLevel()])),
  };
  return delta;
}

/** What a placed token's own actor changes: the flag, its owners and (if set) its size. */
export function placeDelta({ flag, ownerIds, sizeKey }) {
  return {
    flags: { [NS]: { [SUMMON_FLAG]: flag } },
    ownership: Object.fromEntries(ownerIds.map((id) => [id, ownerLevel()])),
    ...(sizeKey ? { system: { size: sizeKey } } : {}),
  };
}

const ownerLevel = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
const dispositionOf = (side) =>
  side === 'mob' ? (CONST.TOKEN_DISPOSITIONS.HOSTILE ?? -1) : CONST.TOKEN_DISPOSITIONS.FRIENDLY;

/*  Who is a minion                             */

/** The key a caster is known by in the summon flags (the world actor, not a token's copy). */
export const casterKeyOf = (actor) => (actor?.baseActor ?? actor)?.uuid ?? '';

/** The players who own an actor (the GM owns everything anyway). */
function playerOwners(actor) {
  return game.users.filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER')).map((u) => u.id);
}

/** Every summoned token on a scene (or on every scene). */
export function summonTokens(scene = null) {
  const scenes = scene ? [scene] : [...(game.scenes ?? [])];
  return scenes.flatMap((s) => [...(s.tokens ?? [])]).filter((token) => summonFlag(token.actor));
}

/** The live summons a caster has, optionally only those from one spell. */
export function liveSummons(casterKey, key = '') {
  return summonTokens().filter((token) => {
    const flag = summonFlag(token.actor);
    return flag.casterUuid === casterKey && (!key || flag.key === key);
  });
}

/** Whether an actor is the caster's pet, or a minion (a summon) of the caster. */
export function isPetOrMinion(actor, caster) {
  if (!actor || !caster) return false;
  if (actor.type === 'pet' && actor.system?.owner === caster.id) return true;
  return summonFlag(actor)?.casterUuid === casterKeyOf(caster);
}

/**
 * The caster's pets and minions: pets they own plus the live summons they made. This is
 * what "heal pets and minions" spells reach (the target group "minions").
 * @param {Actor} caster
 * @returns {Actor[]}
 */
export function minionActors(caster) {
  if (!caster) return [];
  const pets = caster.type === 'crawler' ? game.actors.filter((a) => a.type === 'pet' && a.system.owner === caster.id) : [];
  const summons = liveSummons(casterKeyOf(caster)).map((token) => token.actor);
  return [...new Set([...pets, ...summons])];
}

/*  Making them                                 */

/**
 * Carry out a summon. Everything it needs has been worked out already (see events.mjs
 * planSummon): the numbers, the anchor or target token, the source Actor.
 * @param {object} plan
 * @param {'place'|'raise'|'copy'} plan.mode
 * @param {Actor} plan.caster
 * @param {Item} plan.item          The spell (or item) the event belongs to
 * @param {TokenDocument} plan.anchor   What to place next to, or the target of a raise or copy
 * @param {Actor} [plan.source]     The Actor to place (place)
 * @param {number} plan.count
 * @param {number} plan.duration    Rounds (0: until the combat ends)
 * @param {number} plan.limit       Most live from this spell (0: no limit)
 * @param {number} [plan.sizeClass] Size Class of what is placed (0: the Actor's own)
 * @param {number|null} [plan.fraction]  Raise: fraction of max health it comes back with
 * @param {boolean} plan.hidden
 * @param {boolean} plan.join
 * @returns {Promise<TokenDocument[]>}
 */
export async function executeSummon(plan) {
  const casterKey = casterKeyOf(plan.caster);
  const key = summonKey(plan.item);
  let count = plan.mode === 'raise' ? 1 : plan.count;
  if (plan.limit > 0) {
    const live = liveSummons(casterKey, key);
    const room = planLimit(live.length, count, plan.limit);
    for (const token of oldestFirst(live).slice(0, room.expire)) await expireSummon(token);
    count = room.place;
  }
  if (count < 1) return [];

  const flag = {
    mode: plan.mode,
    key,
    itemUuid: plan.item.uuid,
    itemName: plan.item.name,
    casterUuid: casterKey,
    casterName: plan.caster.name,
    at: Date.now(),
    lasts: plan.duration,
    roundsLeft: plan.duration,
    side: sideOfActor(plan.caster),
    owners: [],
  };
  if (plan.mode === 'raise') return raiseMob(plan, flag);
  if (plan.mode === 'copy') return copyTokens(plan, flag, count);
  return placeSummons(plan, flag, count);
}

/** Put tokens into the combat on their scene (if there is one), once each. */
async function joinCombat(scene, tokens) {
  const combat = scene ? combatOn(scene) : null;
  if (!combat) return;
  const fresh = tokens.filter((token) => !combat.combatants?.some?.((c) => c.tokenId === token.id));
  if (!fresh.length) return;
  await combat.createEmbeddedDocuments(
    'Combatant',
    fresh.map((token) => ({
      tokenId: token.id,
      sceneId: scene.id,
      actorId: token.actorId,
      hidden: token.hidden,
    }))
  );
}

/** Raise: a defeated Mob token comes back on the caster's side with part of its health. */
async function raiseMob(plan, flag) {
  const token = plan.anchor;
  const actor = token.actor;
  const owners = playerOwners(plan.caster);
  // (Only the players who did not already own it are added, so only they are taken away again.)
  const had = actor.ownership ?? {};
  const added = owners.filter((id) => (had[id] ?? had.default ?? 0) < ownerLevel());
  const raised = {
    ...flag,
    owners: added,
    before: { disposition: token.disposition },
  };
  await actor.toggleStatusEffect('dead', { active: false });
  await actor.update({
    'system.health.value': raisedHealth(actor.system.health.max, plan.fraction),
    [`flags.${NS}.${SUMMON_FLAG}`]: raised,
    ...Object.fromEntries(added.map((id) => [`ownership.${id}`, ownerLevel()])),
  });
  await token.update({ disposition: dispositionOf(raised.side) });
  if (plan.join) await joinCombat(token.parent, [token]);
  return [token];
}

/** Copy: full copies of a pet or minion, next to it, each with its own actor data. */
async function copyTokens(plan, flag, count) {
  const original = plan.anchor;
  const scene = original.parent;
  const grid = scene.grid?.size ?? canvas.grid.size;
  const actor = original.actor;
  const object = actor.toObject();
  const snapshot = foundry.utils.deepClone({
    name: object.name,
    img: object.img,
    system: object.system,
    items: object.items,
    effects: object.effects,
    ownership: object.ownership,
    flags: object.flags,
  });
  const ownerIds = playerOwners(plan.caster);

  const created = [];
  for (let i = 0; i < count; i++) {
    // One at a time, so each sees the ones before it.
    const [spot] = freeCells({
      anchor: original,
      size: { width: original.width, height: original.height },
      occupied: [...scene.tokens],
      count: 1,
      grid,
    });
    if (!spot) {
      warn('CARL_RPG.Events.Warn.NoRoom', { name: original.name });
      break;
    }
    const data = foundry.utils.deepClone(original.toObject());
    delete data._id;
    Object.assign(data, {
      x: spot.x,
      y: spot.y,
      hidden: plan.hidden,
      actorLink: false,
      name: copyName(original.name, i + 2),
      delta: copyDelta({ snapshot, flag: { ...flag, at: flag.at + i / 1000 }, ownerIds }),
    });
    const [doc] = await scene.createEmbeddedDocuments('Token', [data]);
    created.push(doc);
  }
  if (plan.join) await joinCombat(scene, created);
  return created;
}

/** Place: tokens of an Actor, each with its own actor data, at the Size Class the spell asks for. */
async function placeSummons(plan, flag, count) {
  const anchor = plan.anchor;
  const scene = anchor.parent;
  const actor = await worldActor(plan.source);
  if (!actor || !scene) return [];
  const grid = scene.grid?.size ?? canvas.grid.size;
  const ownerIds = playerOwners(plan.caster);
  const sizeKey = plan.sizeClass ? sizeKeyOf(plan.sizeClass) : '';
  const width = plan.sizeClass ? footprintOf(plan.sizeClass) : (actor.prototypeToken?.width ?? 1);
  const height = plan.sizeClass ? width : (actor.prototypeToken?.height ?? 1);

  const created = [];
  for (let i = 0; i < count; i++) {
    const [spot] = freeCells({
      anchor,
      size: { width, height },
      occupied: [...scene.tokens],
      count: 1,
      grid,
    });
    if (!spot) {
      warn('CARL_RPG.Events.Warn.NoRoom', { name: actor.name });
      break;
    }
    const token = await actor.getTokenDocument(
      {
        ...spot,
        hidden: plan.hidden,
        elevation: anchor.elevation ?? 0,
        actorLink: false,
        disposition: dispositionOf(flag.side),
        ...(plan.sizeClass ? { width, height } : {}),
      },
      { parent: scene }
    );
    const data = token.toObject();
    data.actorLink = false;
    data.delta = {
      ...(data.delta ?? {}),
      ...placeDelta({ flag: { ...flag, at: flag.at + i / 1000 }, ownerIds, sizeKey }),
    };
    const [doc] = await scene.createEmbeddedDocuments('Token', [data]);
    created.push(doc);
  }
  if (plan.join) await joinCombat(scene, created);
  return created;
}

/*  Ending them                                 */

function note(token, flag, key) {
  return ChatMessage.create({
    content: `<em>${t(key, { name: esc(token.name), spell: esc(flag.itemName) })}</em>`,
  });
}

/**
 * End a summon now (the GM's client). A copy or placed token is deleted. A raised Mob goes
 * down again (its skull comes back, its loot is as it was) and is the GM's again.
 * @param {TokenDocument} token
 */
export async function expireSummon(token) {
  const actor = token?.actor;
  const flag = summonFlag(actor);
  if (!flag) return;
  if (flag.mode !== 'raise') {
    await note(token, flag, 'CARL_RPG.Summon.Fades');
    await token.delete();
    return;
  }
  // Down again, unless it was already killed while it fought.
  if (!actor.statuses.has('dead')) {
    await actor.update({ 'system.health.value': 0 });
    await defeatMob(actor);
  }
  await actor.update({
    [`flags.${NS}.-=${SUMMON_FLAG}`]: null,
    ...Object.fromEntries((flag.owners ?? []).map((id) => [`ownership.-=${id}`, null])),
  });
  if (flag.before?.disposition !== undefined) await token.update({ disposition: flag.before.disposition });
  await note(token, flag, 'CARL_RPG.Summon.GoesDown');
}

/** At the end of each round: count down timed summons and end the ones that run out. */
export async function tickSummons(combat) {
  for (const token of summonTokens(combat?.scene ?? null)) {
    const flag = summonFlag(token.actor);
    if (!(Number(flag.lasts) > 0)) continue;
    const left = roundsAfterTick(flag);
    if (left < 1) await expireSummon(token);
    else await token.actor.update({ [`flags.${NS}.${SUMMON_FLAG}.roundsLeft`]: left });
  }
}

/** When a combat ends, every summon on its scene ends with it. */
export async function endSummons(scene) {
  if (!scene) return;
  for (const token of summonTokens(scene)) await expireSummon(token);
}

/** Hooks: rounds count down at Cleanup, and a combat's end clears its summons (GM's client). */
export function registerMinions() {
  Hooks.on('carlrpg.cleanupPhase', (combat) => {
    if (game.user === game.users.activeGM) tickSummons(combat);
  });
  // (The combat document ends them first while it still has its combatants, see
  // documents/combat.mjs; this catches a combat deleted by someone else.)
  Hooks.on('deleteCombat', (combat) => {
    if (game.user === game.users.activeGM) endSummons(combat.scene);
  });
}
