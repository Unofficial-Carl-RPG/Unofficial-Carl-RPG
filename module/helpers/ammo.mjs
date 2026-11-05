/**
 * Ammunition.
 *
 * A cost row with the resource "ammo" spends an inventory item (a plain item with a
 * Quantity) each time its item is used. The row names what to spend by the Identifier
 * (else the name) of an item dropped on it, and/or by a tag any inventory item may
 * carry. Pure logic, so it can be tested without Foundry; the asking and spending
 * live in CarlRPGItem.roll.
 */
import { costLabel, costSpan } from '../data/costs.mjs';

export const AMMO = 'ammo';

const key = (text) => String(text ?? '').trim().toLowerCase();

/** The ammunition rows of a list of costs, with their place in it. */
export function ammoRows(costs) {
  return (costs ?? [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row?.resource === AMMO);
}

/** What an ammunition row's amount is paid under (like a resource name in the roll pop-up). */
export const ammoKey = (index) => `ammo:${index}`;

/** What to call a row's ammunition: the item dropped on it, else its tag. */
export const ammoName = (row) => String(row?.name ?? '').trim() || String(row?.tag ?? '').trim();

/**
 * Whether an inventory item is what a row spends: an item (never gear) that is the
 * dropped one (matched by Identifier when both have one, else by name, like other
 * "same item" checks) or that has the row's tag.
 * @param {{name?: string, identifier?: string, tag?: string}} row
 * @param {{name: string, type: string, system?: {identifier?: string, tags?: string[]}}} item
 */
export function matchesAmmo(row, item) {
  if (item?.type !== 'item') return false;
  const sys = item.system ?? {};
  const wantedId = key(row?.identifier);
  const wantedName = key(row?.name);
  if (wantedId || wantedName) {
    const id = key(sys.identifier);
    if (wantedId && id ? wantedId === id : wantedName !== '' && wantedName === key(item.name)) return true;
  }
  const tag = key(row?.tag);
  return tag !== '' && (sys.tags ?? []).some((t) => key(t) === tag);
}

/**
 * The inventory items a row can spend, with how many of each are free to spend.
 * @param {object} row
 * @param {object[]} items  The crawler's items, in order
 * @param {Object<string, number>} [reserved]  Amounts already set aside, by item id
 * @returns {{id: string, name: string, qty: number}[]}  Only items with some left
 */
export function ammoStacks(row, items, reserved = {}) {
  return (items ?? [])
    .filter((item) => matchesAmmo(row, item))
    .map((item) => ({
      id: item.id,
      name: item.name,
      qty: Math.max(0, Math.floor(item.system?.quantity ?? 0)) - (reserved[item.id] ?? 0),
    }))
    .filter((stack) => stack.qty > 0);
}

/** The stack with the most left (the first of equals), or null. */
export function largestStack(stacks) {
  return stacks.reduce((best, s) => (!best || s.qty > best.qty ? s : best), null);
}

/** The most of a row's ammunition that one item can give. */
export const ammoHave = (row, items) => largestStack(ammoStacks(row, items))?.qty ?? 0;

/** What one row asks for: its least and most (see costSpan). */
export const ammoSpan = (row, data = {}) => costSpan([row], AMMO, data);

/** One row's amount as text: "2", "1-3", or its formula when it can't be worked out. */
export const ammoAmountLabel = (row, data = {}) => costLabel([row], AMMO, data);
