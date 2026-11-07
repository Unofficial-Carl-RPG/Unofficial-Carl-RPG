/**
 * Distance between two tokens, for the "within N ft" conditions (Shock Treatment's x5 at
 * melee range): an event condition, a Roll Modifier's "Only when" and a damage multiplier.
 *
 * It is measured edge to edge in grid squares, the way a ruler counts the steps between the
 * nearest squares of two tokens: touching tokens are 1 square apart (5 ft on a 5 ft grid,
 * which is melee), one empty square between them is 2 squares (10 ft), and a diagonal counts
 * like a straight line. Only whole empty squares count, so a token a little off the grid
 * still touches. Both tokens have to be on the same scene; with no token to measure from or
 * to there is no distance (null) and a condition on it is not met.
 */
import { findAnchor } from './summon.mjs';

/** The feet a "melee" distance stands for. */
export const MELEE_FEET = 5;

/** Slack for comparing feet and squares (positions are floating point). */
const EPS = 1e-6;

/**
 * The whole squares of empty space between two tokens: the larger of the horizontal and
 * vertical gaps between their edges (0 when they touch or overlap).
 * @param {{x: number, y: number, width?: number, height?: number}} a  A token (x, y in pixels; width, height in squares)
 * @param {{x: number, y: number, width?: number, height?: number}} b
 * @param {number} size  The grid size in pixels
 * @returns {number|null}
 */
export function gapSquares(a, b, size) {
  if (!a || !b || !(size > 0)) return null;
  const edges = (tk) => {
    const left = tk.x / size;
    const top = tk.y / size;
    return { left, top, right: left + (tk.width ?? 1), bottom: top + (tk.height ?? 1) };
  };
  const p = edges(a);
  const q = edges(b);
  const dx = Math.max(0, q.left - p.right, p.left - q.right);
  const dy = Math.max(0, q.top - p.bottom, p.top - q.bottom);
  return Math.floor(Math.max(dx, dy) + EPS);
}

/**
 * The feet between the nearest squares of two tokens (touching is one square), or null when
 * it can't be measured (a token is missing, or they are on different scenes).
 * @param {TokenDocument|null} a
 * @param {TokenDocument|null} b
 * @returns {number|null}
 */
export function tokenDistanceFeet(a, b) {
  const scene = a?.parent;
  if (!a || !b || !scene || b.parent !== scene) return null;
  const gap = gapSquares(a, b, scene.grid?.size);
  if (gap === null) return null;
  const perSquare = scene.grid?.distance > 0 ? scene.grid.distance : MELEE_FEET;
  return (gap + 1) * perSquare;
}

/** Whether a measured distance is within a number of feet (an unmeasured one never is). */
export function withinFeet(feet, limit) {
  const away = Number(feet);
  const most = Number(limit);
  if (feet === null || feet === undefined || !Number.isFinite(away) || !Number.isFinite(most)) {
    return false;
  }
  return away <= most + EPS;
}

/**
 * The token a creature attacks from: its own (an unlinked token's, the running combat's, else
 * one on the viewed scene).
 * @param {Actor|null} actor
 * @returns {TokenDocument|null}
 */
export const attackerToken = (actor) => (actor ? findAnchor(actor, []) : null);
