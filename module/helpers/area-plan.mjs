/**
 * What a use of an item with targeting places and reaches, worked out from its
 * targeting data and the upgrades reached (pure: no Foundry globals, so it is tested
 * under plain Node; the template tool and the target prompt are in helpers/targeting.mjs).
 */
import { evalAmount, wholeAmount } from './amounts.mjs';

/**
 * The splash distance in feet: the item's Splash amount plus the feet upgrades add
 * (the "Splash +ft" change). An Area item measures it from the placed area's edge, a
 * Count item from each chosen target.
 * @param {object} cfg        The item's `system.targeting`
 * @param {object} [effective]  See computeEffective (`splashDelta`)
 * @param {object} [data]     Roll data the amount reads
 * @returns {number}
 */
export function splashReach(cfg, effective, data = {}) {
  const base = wholeAmount(cfg?.splash, data, { min: 0, fallback: 0 });
  return Math.max(0, base + (Math.trunc(Number(effective?.splashDelta)) || 0));
}

/**
 * How many rounds a lasting area lasts (an amount, like size and range; 0 = until the GM
 * removes it). A whole number, never below 0; one that can't be worked out is 0.
 * @param {object} cfg
 * @param {object} [data]
 * @returns {number}
 */
export function lastsRounds(cfg, data = {}) {
  return wholeAmount(cfg?.lasts, data, { min: 0, fallback: 0 });
}

/**
 * The areas one placement of an item asks the player to put down, in order.
 *  - Without a choice (or one that is the item's own shape) it is that shape at the item's
 *    size (the size amount plus the feet upgrades add).
 *  - A shape an upgrade added can carry its own size (an amount; blank uses the item's size
 *    and so its additions; a size of its own is used as it is). If it keeps the base, the
 *    item's own shape and size is placed after it as well.
 * @param {object} cfg        The item's `system.targeting`
 * @param {object} effective  See computeEffective (areaShape, areaShapes, areaSize,
 *   areaSizeDelta, areaExtras)
 * @param {string|null} [chosenShape]  The shape picked in the roll pop-up
 * @param {object} [data]
 * @returns {{shape: string, size: number, base: boolean}[]}  `base` marks the kept base
 *   area that follows an added shape
 */
export function areaSteps(cfg, effective = {}, chosenShape = null, data = {}) {
  const baseShape = effective.areaShape ?? cfg?.shape ?? 'circle';
  const baseSize = Math.max(
    0,
    wholeAmount(effective.areaSize ?? cfg?.size, data, { min: 0, fallback: 0 }) + (effective.areaSizeDelta ?? 0)
  );
  const offered = effective.areaShapes ?? [baseShape];
  const extra =
    chosenShape && chosenShape !== baseShape && offered.includes(chosenShape)
      ? (effective.areaExtras?.[chosenShape] ?? {})
      : null;
  if (!extra) return [{ shape: baseShape, size: baseSize, base: false }];

  const own = String(extra.size ?? '').trim();
  const worked = own ? evalAmount(own, data) : null;
  const size = worked === null ? baseSize : Math.max(0, Math.floor(worked));
  const steps = [{ shape: chosenShape, size, base: false }];
  if (extra.keep) steps.push({ shape: baseShape, size: baseSize, base: true });
  return steps;
}
