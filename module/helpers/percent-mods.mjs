/**
 * Percent modifiers. An effect can give a percent of a number (a stat, DR, Evade, Move,
 * Step or max Mana) instead of a flat amount, like a charm's +5% Constitution.
 *
 * The percent is worked out ONCE, when the effect lands on an actor (an item's effect when
 * the item is added, an effect made on the actor when it is saved), as the percent of the
 * actor's current total, rounded down. The result is kept as a flat number (`flat`) and
 * applied like any flat modifier, so it never moves with later changes to the actor, and it
 * follows the effect's own rules (equipLinked, switched on or off, stacks).
 *
 * Stored on the effect as flags.carl-rpg.percentMods: [{ stat, percent, flat }]. `flat` is
 * null until the effect is on an actor. These helpers are pure.
 */

/** The numbers a percent can apply to (ids of CONFIG.CARL_RPG.effectModifiers). */
export const PERCENT_STATS = ['str', 'int', 'con', 'dex', 'cha', 'dr', 'evade', 'move', 'step', 'mana'];

const STAT_IDS = ['str', 'int', 'con', 'dex', 'cha'];

/**
 * A percent of a number, rounded down (toward zero, so a penalty is not made worse).
 * @param {number} base
 * @param {number} percent  Whole percent; negative for a penalty
 * @returns {number}
 */
export function percentOf(base, percent) {
  const b = Number(base);
  const p = Number(percent);
  if (!Number.isFinite(b) || !Number.isFinite(p)) return 0;
  const raw = Math.floor(Math.abs(b * p) / 100);
  return b * p < 0 ? -raw : raw;
}

/**
 * The actor's current total for something a percent can apply to: the Enhanced value of a
 * stat, or the total of DR, Evade, Move, Step or max Mana. 0 when it has none.
 * @param {{system?: object}} actor
 * @param {string} stat
 * @returns {number}
 */
export function totalOf(actor, stat) {
  const system = actor?.system ?? {};
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  if (STAT_IDS.includes(stat)) {
    const ability = system.abilities?.[stat] ?? {};
    return num(ability.enhanced ?? num(ability.value) + num(system.bonuses?.[stat]));
  }
  switch (stat) {
    case 'dr':
      return num(system.drTotal ?? system.dr?.total ?? (typeof system.dr === 'number' ? system.dr : 0));
    case 'evade':
      return num(system.evadeTotal ?? system.evade?.total);
    case 'move':
      return num(system.moveTotal ?? system.move?.total ?? (typeof system.move === 'number' ? system.move : 0));
    case 'step':
      return num(system.move?.stepTotal);
    case 'mana':
      return num(system.mana?.max);
    default:
      return 0;
  }
}

/**
 * One stored row tidied: a known stat, a whole percent, and the kept flat number (or null).
 * @param {object} row
 * @returns {{stat: string, percent: number, flat: number|null}}
 */
export function cleanPercentRow(row) {
  const stat = PERCENT_STATS.includes(row?.stat) ? row.stat : 'str';
  const percent = Math.trunc(Number(row?.percent)) || 0;
  const flat = row?.flat === null || row?.flat === undefined || row?.flat === '' ? null : Number(row.flat);
  return { stat, percent, flat: Number.isFinite(flat) ? flat : null };
}

/** The rows stored on an effect's flags (tidied). */
export function percentRowsOf(flags) {
  const rows = flags?.percentMods;
  return Array.isArray(rows) ? rows.map(cleanPercentRow) : [];
}

/**
 * Work out the flat numbers for a list of rows. A row whose stat and percent are the same
 * as the row at the same place in `prev` keeps its flat number; any other row (new, or
 * changed) is worked out from the actor's total. With no `prev` (an effect just landing on
 * an actor) every row is worked out.
 * @param {object[]} rows
 * @param {object} options
 * @param {(stat: string) => number} options.totalOf  The actor's total for a stat
 * @param {object[]} [options.prev]  The rows as they were
 * @param {(row: object) => number} [options.own]  What the effect's own previous row adds
 *   to that total right now (taken off so the percent is of the actor without it)
 * @returns {{stat: string, percent: number, flat: number}[]}
 */
export function settlePercentRows(rows, { totalOf: total, prev = null, own = () => 0 }) {
  return (rows ?? []).map((raw, index) => {
    const row = cleanPercentRow(raw);
    const before = prev?.[index] ? cleanPercentRow(prev[index]) : null;
    if (before && before.stat === row.stat && before.percent === row.percent && before.flat !== null) {
      return { ...row, flat: before.flat };
    }
    const base = total(row.stat) - (before && before.flat !== null ? own(before) : 0);
    return { ...row, flat: percentOf(base, row.percent) };
  });
}

/**
 * Rows with their flat numbers forgotten (an effect on an item is only a template).
 * @param {object[]} rows
 */
export function clearPercentRows(rows) {
  return (rows ?? []).map((row) => ({ ...cleanPercentRow(row), flat: null }));
}

/**
 * The flat modifiers a settled row list adds, in the shape of an effect's `changes`.
 * @param {object[]} rows
 * @param {Record<string, {key: string}>} modifiers  CONFIG.CARL_RPG.effectModifiers
 * @param {number} mode  CONST.ACTIVE_EFFECT_MODES.ADD
 */
export function percentChanges(rows, modifiers, mode) {
  const changes = [];
  for (const raw of rows ?? []) {
    const row = cleanPercentRow(raw);
    const key = modifiers?.[row.stat]?.key;
    if (!key || row.flat === null || row.flat === 0) continue;
    changes.push({ key, mode, value: String(row.flat), priority: null });
  }
  return changes;
}
