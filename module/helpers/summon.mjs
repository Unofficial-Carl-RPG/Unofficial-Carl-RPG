/**
 * Placing tokens from an event ("Add a token to the scene").
 *
 * The new tokens go next to an anchor token: the first token the user has
 * targeted, else the owner's own token. They fill the nearest free cells,
 * spiralling out from the anchor, and never land on another token. They can join
 * the combat on that scene (a combat is never started).
 *
 * Token creation needs the right permissions: see canPlaceDirectly. When the user
 * lacks them, the event hands the action to the GM's client (see events.mjs).
 */
const EPS = 1e-6;

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/*  Where tokens go                             */

/** A token's rectangle, in grid cells. */
const cellsOf = (token, grid) => ({
  x: token.x / grid,
  y: token.y / grid,
  w: token.width ?? 1,
  h: token.height ?? 1,
});

/** Whether two rectangles (in cells) overlap by more than a shared edge. */
const overlaps = (a, b) =>
  a.x < b.x + b.w - EPS &&
  b.x < a.x + a.w - EPS &&
  a.y < b.y + b.h - EPS &&
  b.y < a.y + a.h - EPS;

/**
 * The free spots nearest an anchor token, nearest first. A spot is the top-left
 * corner (in pixels) of a token of this size that touches no other token.
 * @param {object} options
 * @param {{x: number, y: number, width?: number, height?: number}} options.anchor
 * @param {{width?: number, height?: number}} [options.size]  The new token's size, in cells
 * @param {object[]} [options.occupied]  Tokens already on the scene (position and size)
 * @param {number} options.count         How many spots to find
 * @param {number} options.grid          The scene's grid size, in pixels
 * @param {number} [options.reach]       How far from the anchor to look, in cells
 * @returns {{x: number, y: number}[]}   Fewer than `count` if there is no room
 */
export function freeCells({ anchor, size = {}, occupied = [], count, grid, reach = 12 }) {
  const home = cellsOf(anchor, grid);
  const w = size.width ?? 1;
  const h = size.height ?? 1;
  const blocked = [home, ...occupied.map((token) => cellsOf(token, grid))];
  const middle = { x: home.x + home.w / 2, y: home.y + home.h / 2 };

  const candidates = [];
  for (let dy = Math.floor(-h - reach); dy <= home.h + reach; dy++) {
    for (let dx = Math.floor(-w - reach); dx <= home.w + reach; dx++) {
      const rect = { x: home.x + dx, y: home.y + dy, w, h };
      const distance = Math.hypot(rect.x + w / 2 - middle.x, rect.y + h / 2 - middle.y);
      candidates.push({ dx, dy, distance, rect });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.dy - b.dy || a.dx - b.dx);

  const spots = [];
  for (const candidate of candidates) {
    if (spots.length >= count) break;
    if (blocked.some((rect) => overlaps(candidate.rect, rect))) continue;
    blocked.push(candidate.rect);
    spots.push({ x: anchor.x + candidate.dx * grid, y: anchor.y + candidate.dy * grid });
  }
  return spots;
}

/**
 * The token new ones are placed next to: the first token this user has targeted,
 * else the owner's own token (the running combat's, else one on the viewed scene).
 * @param {Actor|null} owner
 * @param {object[]} [targeted]  Targeted tokens (placeables or documents)
 * @returns {TokenDocument|null}
 */
export function findAnchor(owner, targeted = [...(game.user.targets ?? [])]) {
  for (const token of targeted) {
    const doc = token?.document ?? token;
    if (doc?.parent) return doc;
  }
  if (!owner) return null;
  // (An unlinked token's actor knows its token.)
  if (owner.token?.parent) return owner.token;
  const combatant = game.combat?.started
    ? game.combat.combatants.find((c) => c.actor === owner)
    : null;
  if (combatant?.token?.parent) return combatant.token;
  return owner.getActiveTokens?.(false, true)?.find((token) => token.parent) ?? null;
}

/*  Permissions and sources                     */

/** The world copy of a compendium actor that was imported earlier, if there is one. */
function importedCopy(source) {
  return game.actors.find((a) => a._stats?.compendiumSource === source.uuid) ?? null;
}

/** The combat on a scene that new tokens can join. */
export function combatOn(scene) {
  const all = game.combats?.contents ?? [...(game.combats ?? [])];
  return all.find((c) => c.scene?.id === scene.id && (c.active || c === game.combat)) ?? null;
}

/**
 * Whether this user can place the tokens themselves: they may create tokens, own
 * the actor (a compendium actor needs its imported copy), and own the combat the
 * tokens would join. If not, the GM's client does it.
 * @param {Actor} source      The actor the token is made from
 * @param {TokenDocument} anchor
 * @param {boolean} joinCombat
 */
export function canPlaceDirectly(source, anchor, joinCombat) {
  const user = game.user;
  if (user.isGM) return true;
  if (!user.can?.('TOKEN_CREATE')) return false;
  const actor = source.inCompendium ? importedCopy(source) : source;
  if (!actor?.isOwner) return false;
  if (joinCombat) {
    const combat = combatOn(anchor.parent);
    if (combat && !combat.isOwner) return false;
  }
  return true;
}

/** A world actor for a token: a compendium actor is imported once, then reused. */
export async function worldActor(source) {
  if (!source.inCompendium) return source;
  return (
    importedCopy(source) ??
    Actor.implementation.create(game.actors.fromCompendium(source), { fromCompendium: true })
  );
}

/*  Placing                                     */

/**
 * Place tokens of an actor next to an anchor token. The tokens follow the actor's
 * prototype token (linked or not, its image and name options).
 * @param {object} options
 * @param {Actor} options.source        The actor (world or compendium)
 * @param {TokenDocument} options.anchor
 * @param {number} options.count
 * @param {boolean} [options.hidden]
 * @param {boolean} [options.joinCombat]  Join the combat on the scene, if there is one
 * @returns {Promise<TokenDocument[]>}
 */
export async function placeTokens({ source, anchor, count, hidden = false, joinCombat = false }) {
  const scene = anchor.parent;
  const actor = await worldActor(source);
  if (!actor || !scene) return [];
  const grid = scene.grid?.size ?? canvas.grid.size;

  const created = [];
  for (let i = 0; i < count; i++) {
    // One at a time, so each sees the ones before it (free spots and "(2)" names).
    const [spot] = freeCells({
      anchor,
      size: actor.prototypeToken,
      occupied: [...scene.tokens],
      count: 1,
      grid,
    });
    if (!spot) {
      ui.notifications.warn(t('CARL_RPG.Events.Warn.NoRoom', { name: actor.name }));
      break;
    }
    const token = await actor.getTokenDocument(
      { ...spot, hidden, elevation: anchor.elevation ?? 0 },
      { parent: scene }
    );
    const [doc] = await scene.createEmbeddedDocuments('Token', [token.toObject()]);
    created.push(doc);
  }

  const combat = joinCombat ? combatOn(scene) : null;
  if (combat && created.length) {
    await combat.createEmbeddedDocuments(
      'Combatant',
      created.map((token) => ({
        tokenId: token.id,
        sceneId: scene.id,
        actorId: token.actorId,
        hidden: token.hidden,
      }))
    );
  }
  return created;
}
