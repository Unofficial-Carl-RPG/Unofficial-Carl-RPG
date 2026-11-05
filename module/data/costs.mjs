
/*
 * Costs: what an item spends when it is used. Each cost is a resource and an amount:
 * the user's Mana, the user's Misc Junk, uses of the item itself (the item's Uses
 * settings say how many it has and when they come back), or Ammunition: inventory items
 * used up on the user (see helpers/ammo.mjs).
 *
 * An amount is a number or a formula over roll data (see helpers/amounts.mjs), so a
 * cost can follow a stat: `@int.mod + 1`. A cost can also be a range: `amount` is the
 * least and `max` the most (each a formula), and whoever uses the item picks an amount
 * in between. A blank `max` makes the cost fixed at `amount`.
 */
import { evalAmount } from '../helpers/amounts.mjs';

export const COST_RESOURCES = ['mana', 'junk', 'uses'];

/** What a cost row can be. Ammunition rows are each paid on their own, so they aren't a resource above. */
export const COST_ROW_KINDS = [...COST_RESOURCES, 'ammo'];

/** The `costs` field for an item's data model. */
export function costsSchema() {
  const fields = foundry.data.fields;
  return new fields.ArrayField(
    new fields.SchemaField({
      resource: new fields.StringField({
        required: true,
        blank: false,
        choices: COST_ROW_KINDS,
        initial: 'mana',
      }),
      // The amount, or the least of a range: a number or a formula.
      amount: new fields.StringField({ required: true, blank: false, initial: '1' }),
      // The most of a range (blank: the cost is just `amount`).
      max: new fields.StringField({ required: true, blank: true, initial: '' }),
      // Ammunition rows: the item dropped on it (its name and Identifier), and/or a tag
      // any inventory item may carry.
      name: new fields.StringField({ required: true, blank: true, initial: '' }),
      identifier: new fields.StringField({ required: true, blank: true, initial: '' }),
      tag: new fields.StringField({ required: true, blank: true, initial: '' }),
    })
  );
}

/** One cost row worked out: its least and most, and whether both could be worked out. */
function rowSpan(row, data) {
  const low = evalAmount(row?.amount, data);
  const min = Math.max(0, Math.floor(low ?? 0));
  const blank = !String(row?.max ?? '').trim();
  const high = blank ? min : evalAmount(row.max, data);
  const max = Math.max(min, Math.floor(high ?? min));
  return { min, max, known: low !== null && (blank || high !== null) };
}

/**
 * What a list of costs asks of one resource: the least and most it can come to (the
 * rows added up), and whether every formula could be worked out with the data given.
 * @param {object[]} costs
 * @param {string} resource
 * @param {object} [data]  Roll data for the formulas
 * @returns {{min: number, max: number, known: boolean, ranged: boolean}}
 */
export function costSpan(costs, resource, data = {}) {
  const span = { min: 0, max: 0, known: true };
  for (const row of costs ?? []) {
    if (row?.resource !== resource) continue;
    const r = rowSpan(row, data);
    span.min += r.min;
    span.max += r.max;
    span.known &&= r.known;
  }
  return { ...span, ranged: span.max > span.min };
}

/** A span moved up or down by a whole number (an upgrade), never below 0. */
export function shiftSpan(span, delta) {
  const min = Math.max(0, span.min + delta);
  const max = Math.max(min, span.max + delta);
  return { ...span, min, max, ranged: max > min };
}

/**
 * A span held to what the user has: the most they can pick is what they have, but
 * never less than the least (having less than that is handled by the "use anyway"
 * question).
 */
export function capSpan(span, have) {
  const max = Math.max(span.min, Math.min(span.max, Math.floor(have)));
  return { ...span, max, ranged: max > span.min };
}

/**
 * A resource's cost as text: "2", or "1-3" for a range. If a formula can't be worked
 * out (an item that isn't on a character has no stats), the formulas themselves are
 * shown, like "1 + @int.mod".
 * @param {object[]} costs
 * @param {string} resource
 * @param {object} [data]
 * @param {number} [delta]  An upgrade's change, added to the numbers
 * @returns {string} '' when there is nothing to pay
 */
export function costLabel(costs, resource, data = {}, delta = 0) {
  const rows = (costs ?? []).filter((c) => c?.resource === resource);
  if (!rows.length && !delta) return '';
  const span = shiftSpan(costSpan(costs, resource, data), delta);
  if (span.known) {
    if (!span.max) return '';
    return span.min === span.max ? String(span.min) : `${span.min}-${span.max}`;
  }
  const text = rows
    .map((r) => (String(r.max ?? '').trim() ? `${r.amount}-${r.max}` : String(r.amount)))
    .join(' + ');
  return delta ? `${text} ${delta > 0 ? '+' : '-'} ${Math.abs(delta)}` : text;
}

/**
 * The roll data `@cost` reads: what is being paid, for each resource, and in all.
 * @param {{mana?: number, junk?: number, uses?: number, ammo?: number}} [paid]  (`ammo` is all the
 *   ammunition together)
 */
export function costPaidData(paid = {}) {
  const mana = paid.mana ?? 0;
  const junk = paid.junk ?? 0;
  const uses = paid.uses ?? 0;
  const ammo = paid.ammo ?? 0;
  return { mana, junk, uses, ammo, total: mana + junk + uses + ammo };
}

/** The total amount of one resource in a list of costs (the least it can come to). */
export function costOf(costs, resource, data = {}) {
  return costSpan(costs, resource, data).min;
}

/**
 * The Mana a list of costs spends (at least). An item saved before costs existed may
 * still have its own `manaCost` number, which counts when there are no costs yet.
 */
export function manaCostOf(costs, legacy = 0, data = {}) {
  return Array.isArray(costs) ? costOf(costs, 'mana', data) : Number(legacy ?? 0);
}

/** How many of its own uses an item spends each time it is used (at least). */
export const usesCost = (item, data = {}) => costOf(item?.system?.costs, 'uses', data);

/**
 * Give an item saved before costs existed the costs that match how it behaved: a
 * spell's Mana Cost becomes a Mana cost, and an item with a limit on its uses spends
 * one use.
 *
 * Foundry also runs this on the partial data of every update, so it only acts on an
 * item that still has the old `manaCost` (a partial update never does): anything else
 * keeps the costs it has.
 */
export function migrateCosts(source) {
  if (source.costs !== undefined || source.manaCost === undefined) {
    // Amounts used to be whole numbers; they are text now (a number or a formula).
    if (Array.isArray(source.costs)) {
      for (const row of source.costs) {
        if (row && typeof row.amount === 'number') row.amount = String(row.amount);
      }
    }
    return source;
  }
  const costs = [];
  const mana = Number(source.manaCost ?? 0);
  if (mana > 0) costs.push({ resource: 'mana', amount: String(Math.trunc(mana)) });
  if (Number(source.uses?.max ?? 0) > 0) costs.push({ resource: 'uses', amount: '1' });
  source.costs = costs;
  return source;
}
