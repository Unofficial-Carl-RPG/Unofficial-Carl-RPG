/**
 * The skill lists on Damage Effects and Roll Modifiers: which skills a passive skill works
 * with. One list is a line of comma separated entries, any of which may match:
 *
 *   - a name or Identifier:  `Ranged Attacks`
 *   - a tag, with #:          `#thrown` (every skill with that tag)
 *   - tags that must all be there, joined with +:  `#thrown+#fire` (the # on later tags is optional)
 *
 * A tag counts when the skill the roll uses has it, or the item being used does (a
 * javelin tagged thrown, rolled with Ranged Attacks). Matching ignores case and spaces.
 * Pure, so it can be checked under plain Node.
 */

const norm = (text) => String(text ?? '').trim().toLowerCase();

/** What marks an entry as a tag. */
export const TAG_MARK = '#';

/** The entries of a list (lower case, blanks dropped). */
export function listEntries(text) {
  return String(text ?? '')
    .split(',')
    .map(norm)
    .filter(Boolean);
}

/**
 * The tags a tag entry asks for, all of which must be present: `#thrown+#fire` is
 * thrown and fire. An entry that is not a tag entry (no #) gives none.
 * @param {string} entry  A lower case entry from listEntries
 * @returns {string[]}
 */
export function entryTags(entry) {
  if (!String(entry ?? '').startsWith(TAG_MARK)) return [];
  return entry
    .split('+')
    .map((part) => norm(part).replace(/^#+/, '').trim())
    .filter(Boolean);
}

/** The tags an item carries (lower case). */
const tagsOf = (doc) =>
  [...(doc?.system?.tags ?? []), ...(doc?.system?.categories ?? [])].map(norm).filter(Boolean);

/**
 * Whether a list covers a roll.
 * @param {string[]} entries  From listEntries
 * @param {Item|null} skill   The skill the roll uses
 * @param {Item|null} [item]  The item being used, when it is not the skill itself
 * @param {{skip?: string[]}} [options]  Entries to ignore (a Roll Modifier's `self`)
 * @returns {boolean}
 */
export function listAccepts(entries, skill, item = null, { skip = [] } = {}) {
  if (!skill) return false;
  const keys = [norm(skill.name), norm(skill.system?.identifier)].filter(Boolean);
  const have = new Set([...tagsOf(skill), ...tagsOf(item)]);
  return entries.some((entry) => {
    if (skip.includes(entry)) return false;
    if (entry.startsWith(TAG_MARK)) {
      const want = entryTags(entry);
      return want.length > 0 && want.every((tag) => have.has(tag));
    }
    return keys.includes(entry);
  });
}
