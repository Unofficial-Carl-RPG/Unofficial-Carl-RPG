/**
 * Splash: extra distance beyond an area that still affects what is inside it.
 *
 * An area item can have a splash distance (feet). Tokens outside the placed area but
 * within that distance of its edge are "in the splash". They share the attack's d20
 * (their own Evade or stat is checked as usual) but take the item's splash damage
 * formula instead of its damage. Pure rules here (no Foundry globals); the area
 * placement is in helpers/targeting.mjs and the damage in helpers/attacks.mjs.
 */

/** Shortest distance from a point to the segment a-b. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a point is inside a polygon (flat [x0, y0, x1, y1, ...]), by ray casting. */
function insidePolygon(points, px, py) {
  let inside = false;
  const n = points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[2 * i];
    const yi = points[2 * i + 1];
    const xj = points[2 * j];
    const yj = points[2 * j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * How far a point is from the edge of a shape (0 if it is inside). The shape is a
 * circle ({x, y, radius}), a rectangle ({x, y, width, height}) or a polygon ({points},
 * a flat list), all in the same coordinates as the point (Foundry's PIXI shapes fit).
 * @param {object} shape
 * @param {{x: number, y: number}} point
 * @returns {number}  Infinity for a shape it can't read
 */
export function distanceToShape(shape, point) {
  if (!shape) return Infinity;
  const { x: px, y: py } = point;
  if (Array.isArray(shape.points) && shape.points.length >= 6) {
    const pts = shape.points;
    if (insidePolygon(pts, px, py)) return 0;
    let best = Infinity;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      best = Math.min(best, segmentDistance(px, py, pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1]));
    }
    return best;
  }
  if (typeof shape.radius === 'number') {
    return Math.max(0, Math.hypot(px - (shape.x ?? 0), py - (shape.y ?? 0)) - shape.radius);
  }
  if (typeof shape.width === 'number' && typeof shape.height === 'number') {
    const x = shape.x ?? 0;
    const y = shape.y ?? 0;
    const dx = Math.max(x - px, 0, px - (x + shape.width));
    const dy = Math.max(y - py, 0, py - (y + shape.height));
    return Math.hypot(dx, dy);
  }
  return Infinity;
}

/**
 * Which of some points are in the splash band: outside the shape, but no farther from
 * its edge than the splash distance.
 * @param {object} shape  See distanceToShape
 * @param {number} reach  The splash distance, in the same units as the shape
 * @param {{id: string, x: number, y: number}[]} points
 * @param {Set<string>|string[]} [skip]  Ids already inside the area
 * @returns {string[]}  The ids in the band
 */
export function splashBand(shape, reach, points, skip = []) {
  if (!(reach > 0)) return [];
  const skipped = new Set(skip);
  return points
    .filter((p) => !skipped.has(p.id) && distanceToShape(shape, p) <= reach)
    .map((p) => p.id);
}

/*  Who is in the splash of the item being used  */

// What the last area placement found, until the roll takes it: { item, core, splash }.
// Token document UUIDs. An item that places several areas adds to it; a token inside
// any of its areas is never splash.
let pending = null;

/** Forget it (a new target prompt starts). */
export function clearSplash() {
  pending = null;
}

/** Put the splash of an item's use back (a declared mob ability being resolved). */
export function setSplash(itemUuid, uuids = []) {
  pending = uuids.length ? { item: itemUuid, core: new Set(), splash: new Set(uuids) } : null;
}

/**
 * Note one placed area: the tokens inside it, and the ones in its splash band.
 * @param {string} itemUuid
 * @param {string[]} core
 * @param {string[]} splash
 */
export function noteArea(itemUuid, core, splash) {
  if (!pending || pending.item !== itemUuid) pending = { item: itemUuid, core: new Set(), splash: new Set() };
  for (const uuid of core) {
    pending.core.add(uuid);
    pending.splash.delete(uuid);
  }
  for (const uuid of splash) if (!pending.core.has(uuid)) pending.splash.add(uuid);
}

/** The token UUIDs in the splash of this item's use (once: they are forgotten after). */
export function takeSplash(itemUuid) {
  const found = pending?.item === itemUuid ? [...pending.splash] : [];
  pending = null;
  return found;
}

/** Whether a splash formula can be rolled for the targets at hand. */
export const hasSplashDamage = (formula) => !!String(formula ?? '').trim();
