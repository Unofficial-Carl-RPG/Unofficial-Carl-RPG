
/**
 * Choices left to the player.
 *
 * A race, class or effect can let the player decide something instead of fixing it:
 *
 *  - a granted-skills row with a `count` ("the player picks N skills" at a rank) on a race,
 *    class or subclass: the skills are picked from those matching the row's tag, stat and
 *    kind (skill or spell). The picks are granted like any granted skill and remembered in
 *    the actor's copy of the item (flag `picks`: row number -> skill UUIDs).
 *  - a scoped build benefit (Skill cap 20, Skill rank bonus, ...) whose scope is Player picks:
 *    it covers only the N skills the player picked, remembered in the row's `picks` on the
 *    actor's copy of the effect.
 *  - a Stat split build benefit: points the player divides between stats, remembered in the
 *    row's `split`. It can be redone once per floor when the row says so.
 *
 * Everything here only reads and works out data; the dialog and the writing are in
 * helpers/pick-dialog.mjs. The picks are permanent for the player; the GM can reset them.
 */
import { isScopedKind, cleanSplit, splitPoints, splitStats, splitTotal } from './build-mods.mjs';
import { itemHasTag } from './tags.mjs';

const NS = 'carl-rpg';

/** The item types whose granted skills can be "the player picks". */
export const PICK_ORIGINS = ['race', 'class', 'subclass'];

/** Whether a granted-skills row is "the player picks N skills" (rather than one skill). */
export const isPickRow = (entry) => Number(entry?.count) > 0;

/** A granted-skills row's filter. */
export const grantFilter = (entry) => ({
  tag: String(entry?.tag ?? '').trim(),
  stat: String(entry?.stat ?? '').trim(),
  kind: String(entry?.kind ?? '').trim(),
});

/** A Player picks build row's filter. */
export const buildFilter = (row) => ({
  tag: String(row?.tag ?? '').trim(),
  stat: String(row?.stat ?? '').trim(),
  kind: String(row?.skillKind ?? '').trim(),
});

/**
 * Whether a skill or spell matches a filter: it has the tag (if one is set), uses the
 * stat (if one is set) and is a skill or spell as asked (blank: either).
 * @param {Item} item
 * @param {{tag?: string, stat?: string, kind?: string}} filter
 */
export function matchesFilter(item, filter) {
  if (!['skill', 'spell'].includes(item?.type)) return false;
  if (filter.kind && item.type !== filter.kind) return false;
  if (filter.stat && item.system?.stat !== filter.stat) return false;
  if (filter.tag && !itemHasTag(item, filter.tag)) return false;
  return true;
}

/**
 * The skills and spells a pick can choose between, sorted by name.
 * @param {Item[]} items
 * @param {{tag?: string, stat?: string, kind?: string}} filter
 * @param {{identified?: boolean}} [options]  `identified`: only those with an Identifier
 *   (a Skill cap pick covers a skill by its Identifier)
 */
export function poolFor(items, filter, { identified = false } = {}) {
  return items
    .filter((item) => matchesFilter(item, filter))
    .filter((item) => !identified || String(item.system?.identifier ?? '').trim() !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The picks recorded on an actor's copy of a race, class or subclass: {row number: [uuid]}. */
export const grantPicksOf = (item) => item?.getFlag?.(NS, 'picks') ?? {};

/** The name of whatever gave an actor an effect: its item if it can be found, else the effect. */
function sourceNameOf(actor, effect) {
  const ids = effect.getFlag?.(NS, 'sourceItems') ?? [];
  const source = [...(actor.items ?? [])].find((item) => ids.includes(item.id));
  return source?.name ?? effect.name;
}

/**
 * Every choice the actor's race, class, subclass and effects hold, made or not.
 *  - grant: `{type, key, item, index, rank, filter, count, picked: uuid[], need}`
 *  - cap (a scoped build benefit): `{type, key, effect, index, row, filter, count,
 *    picked: {value, name}[], need}`
 *  - split: `{type, key, effect, index, row, points, stats, split, total, done, usedFloor, repick}`
 * `need` is how many picks are still to make. Effects that are off are left out.
 * @param {Actor} actor
 * @returns {object[]}
 */
export function pickSlots(actor) {
  const slots = [];
  for (const item of actor?.items ?? []) {
    if (!PICK_ORIGINS.includes(item.type)) continue;
    const recorded = grantPicksOf(item);
    (item.system.grantedSkills ?? []).forEach((entry, index) => {
      if (!isPickRow(entry)) return;
      const picked = [...(recorded[index] ?? [])];
      slots.push({
        type: 'grant',
        key: `grant:${item.id}:${index}`,
        item,
        sourceName: item.name,
        index,
        rank: entry.rank,
        filter: grantFilter(entry),
        count: entry.count,
        picked,
        need: Math.max(0, entry.count - picked.length),
      });
    });
  }
  for (const effect of actor?.effects ?? []) {
    if (effect.disabled) continue;
    (effect.getFlag?.(NS, 'buildMods') ?? []).forEach((row, index) => {
      if (!row) return;
      const base = {
        key: `${row.kind === 'statSplit' ? 'split' : 'cap'}:${effect.id}:${index}`,
        effect,
        sourceName: sourceNameOf(actor, effect),
        index,
        row,
      };
      if (isScopedKind(row.kind) && row.target === 'pick') {
        const picked = [...(row.picks ?? [])];
        slots.push({
          ...base,
          type: 'cap',
          filter: buildFilter(row),
          count: Number(row.count) || 1,
          picked,
          need: Math.max(0, (Number(row.count) || 1) - picked.length),
        });
      } else if (row.kind === 'statSplit') {
        const total = splitTotal(row);
        slots.push({
          ...base,
          type: 'split',
          points: splitPoints(row),
          stats: splitStats(row),
          split: cleanSplit(row),
          total,
          done: total === splitPoints(row),
          usedFloor: row.usedFloor ?? null,
          repick: row.repick ?? 'never',
        });
      }
    });
  }
  return slots;
}

/**
 * Whether a race, class or subclass an actor holds leaves anything to the player (so the GM
 * can reset it): a pick row on the item itself, or a pick or split on an effect it gave.
 * @param {Actor} actor
 * @param {Item} item
 */
export function hasChoices(actor, item) {
  if ((item?.system?.grantedSkills ?? []).some(isPickRow)) return true;
  return [...(actor?.effects ?? [])].some(
    (effect) =>
      (effect.getFlag?.(NS, 'sourceItems') ?? []).includes(item?.id) &&
      (effect.getFlag?.(NS, 'buildMods') ?? []).some(
        (row) => row?.kind === 'statSplit' || (isScopedKind(row?.kind) && row.target === 'pick')
      )
  );
}

/** Whether a slot still has something to choose. */
export const isPending = (slot) => (slot.type === 'split' ? !slot.done : slot.need > 0);

/** Whether a made Stat split can be redone on this floor (once per floor, if the row allows). */
export const canReassign = (slot, floor) =>
  slot.type === 'split' && slot.done && slot.repick === 'floor' && slot.usedFloor !== floor;

/** The slots with something still to choose. */
export const pendingSlots = (actor) => pickSlots(actor).filter(isPending);

/** The Stat splits that can be redone on this floor. */
export const reassignSlots = (actor, floor) =>
  pickSlots(actor).filter((slot) => canReassign(slot, floor));

/**
 * What the sheet needs to know: how many choices are waiting, and whether a Stat split can
 * be redone now.
 * @param {Actor} actor
 * @param {number} floor
 */
export function pickSummary(actor, floor) {
  const slots = pickSlots(actor);
  return {
    pending: slots.filter(isPending).length,
    reassign: slots.some((slot) => canReassign(slot, floor)),
  };
}

/**
 * A copy of a build benefit list with one row's picks replaced.
 * @param {object[]} rows
 * @param {number} index
 * @param {{value: string, name: string}[]} picks
 */
export function withBuildPicks(rows, index, picks) {
  return rows.map((row, i) => (i === index ? { ...row, picks } : row));
}

/**
 * A copy of a build benefit list with a Stat split row answered. The answer is tidied (see
 * cleanSplit); `usedFloor` is stamped when it is a redo.
 * @param {object[]} rows
 * @param {number} index
 * @param {Object<string, number>} split
 * @param {number|null} [usedFloor]  The floor a redo was made on
 */
export function withSplit(rows, index, split, usedFloor = null) {
  return rows.map((row, i) => {
    if (i !== index) return row;
    const next = { ...row, split: cleanSplit(row, split) };
    if (usedFloor !== null) next.usedFloor = usedFloor;
    return next;
  });
}

/**
 * A copy of a build benefit list with every answer forgotten (picks, splits, the floor a
 * split was redone on). Rows that hold no answer are left as they were.
 * @param {object[]} rows
 */
export function withoutAnswers(rows) {
  return rows.map((row) => {
    if (row?.kind === 'statSplit') {
      const { usedFloor, ...rest } = row;
      return { ...rest, split: {} };
    }
    if (isScopedKind(row?.kind) && row.target === 'pick') return { ...row, picks: [] };
    return row;
  });
}

/**
 * Check one answer to a Stat split: only offered stats, whole numbers, adding up to exactly
 * the points. Returns the tidied answer when it is valid.
 * @param {object} row
 * @param {Object<string, number>} raw
 * @returns {{ok: boolean, split: Object<string, number>, total: number}}
 */
export function checkSplit(row, raw) {
  const split = cleanSplit(row, raw);
  const total = Object.values(split).reduce((a, b) => a + b, 0);
  const asked = Object.values(raw ?? {}).reduce(
    (a, b) => a + Math.max(0, Math.trunc(Number(b)) || 0),
    0
  );
  return { ok: total === splitPoints(row) && asked === total, split, total };
}

/**
 * Tidy the skills chosen for a slot: nothing blank, no repeats, none already picked, and
 * no more than the slot still needs.
 * @param {string[]} chosen
 * @param {string[]} already  What was picked before
 * @param {number} need
 * @param {(value: string) => string} [key]  How two choices are compared
 */
export function tidyChoices(chosen, already, need, key = (v) => String(v).trim().toLowerCase()) {
  const seen = new Set(already.map(key));
  const out = [];
  for (const value of chosen) {
    if (!value || seen.has(key(value))) continue;
    seen.add(key(value));
    out.push(value);
    if (out.length >= need) break;
  }
  return out;
}

/**
 * Words for a filter: the tag, the stat and the kind, ready to join into a phrase such as
 * "crafting Charisma-based skills".
 * @param {{tag?: string, stat?: string, kind?: string}} filter
 * @returns {{tag: string, stat: string, kind: string}}  The kind is 'skill', 'spell' or 'both'
 */
export function filterParts(filter) {
  return { tag: filter.tag || '', stat: filter.stat || '', kind: filter.kind || 'both' };
}
