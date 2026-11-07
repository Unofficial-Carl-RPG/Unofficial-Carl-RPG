
/**
 * Roll Modifiers.
 *
 * A Roll Modifier is a passive skill (`system.rollMod.enabled`) that changes the rolls of
 * other skills. `system.rollMod.skills` lists the skills it works with (names or
 * identifiers separated by commas); the word `self` lists the modifier's own use. Before
 * rolling one of the listed skills a crawler may choose the modifier in the roll pop-up (at
 * most one per roll). A modifier that lists `self` applies whenever it is used itself, even
 * with Shift held.
 *
 * What a modifier does comes from its upgrades (rank 1 is the base text, so its base
 * changes sit in an upgrade at rank 1), through the `rm*` change types of
 * CONFIG.CARL_RPG.upgrades.changes. They are folded at the modifier's current rank by
 * `modRules`, never stored. Every row can carry an "Only when" condition:
 *  - rmRank   adds the modifier's Rank to the d20 roll
 *  - rmDice   dice or a number added to the damage of each target it applies to
 *             (@rankDamage reads the MODIFIER's rank; a natural 20 doubles the dice). A row can
 *             name a damage type, or two (the roll is split between them): it is then kept
 *             apart from the attack's damage and resisted, stopped or doubled on its own
 *  - rmDR     Damage Resistance for the next damage the crawler takes
 * A modifier's upgrades can also hold damage multipliers (the `damageMultiply` change, see
 * damage-multiply.mjs): they apply to the attacks the modifier is used with, like its dice, and
 * can only be conditioned on the roll (mode, Surprise, melee range) or on each target's degree.
 * Conditions (CONFIG.CARL_RPG.rollMods): the roll's mode (disadvantage, advantage), a
 * Surprise attack (a tick in the pop-up) and, for damage dice only, the degree of success
 * against each target (hit, amazing or better, critical hit, miss).
 *
 * The DR bonus is kept on the actor (flag tempDR, one entry per modifier) until the next
 * damage it takes uses it up; it also clears when a round or a combat ends.
 */
import { changeProblem, unlockedUpgrades } from './upgrades.mjs';
import { rankOf } from './skill-rank.mjs';
import { listAccepts, listEntries } from './skill-list.mjs';
import { rowTypes } from './damage-types.mjs';

const NS = 'carl-rpg';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => Handlebars.escapeExpression(text);

/** The degrees of success that count as a hit. */
const HITS = ['critHit', 'amazing', 'success'];

/** The conditions that look at the degree of success against a target. */
export const DEGREE_WHENS = ['hit', 'amazing', 'crit', 'miss'];

/** The change types a Roll Modifier adds. */
export const MOD_CHANGES = ['rmRank', 'rmDice', 'rmDR'];

/** Whether a condition looks at the degree of success against a target. */
export const isDegreeWhen = (when) => DEGREE_WHENS.includes(when);

/** Whether an item is a Roll Modifier. */
export const isRollMod = (item) => item?.type === 'skill' && !!item.system?.rollMod?.enabled;

/*  Rules                                       */

/**
 * What a modifier does at its current rank.
 * @param {object} system  The modifier skill's system data (rank, upgrades)
 * @returns {{rank: {when: string}[], dice: {formula: string, when: string}[],
 *   dr: {amount: number, when: string}[],
 *   multiply: {value: number, scope: string, when: string}[]}}
 */
export function modRules(system) {
  const rules = { rank: [], dice: [], dr: [], multiply: [] };
  for (const upgrade of unlockedUpgrades(system)) {
    for (const change of upgrade.changes ?? []) {
      if (change.type === 'damageMultiply') {
        if (!changeProblem(change)) {
          rules.multiply.push({
            value: Number(change.value),
            scope: change.scope === 'base' ? 'base' : 'total',
            when: change.when ?? '',
          });
        }
        continue;
      }
      if (!MOD_CHANGES.includes(change.type) || changeProblem(change)) continue;
      const when = change.when ?? '';
      const value = String(change.value ?? '').trim();
      if (change.type === 'rmRank') rules.rank.push({ when });
      else if (change.type === 'rmDice') {
        const types = rowTypes(change);
        rules.dice.push(types.length ? { formula: value, when, types } : { formula: value, when });
      }
      else rules.dr.push({ amount: Math.trunc(Number(value)), when });
    }
  }
  return rules;
}

/** The "Only when" choices of a change type (id to label key), or null for other changes. */
export function whenOptionsFor(type) {
  const { allowed, when } = CONFIG.CARL_RPG.rollMods;
  if (!(type in allowed)) return null;
  return Object.fromEntries(allowed[type].map((id) => [id, when[id]]));
}

/** Whether a condition on the roll itself holds ('' and degree conditions always do here). */
export function whenMet(when, { mode = 'normal', surprise = false, melee = false } = {}) {
  switch (when) {
    case 'disadvantage':
      return mode === 'disadvantage';
    case 'advantage':
      return mode === 'advantage';
    case 'surprise':
      return !!surprise;
    case 'melee':
      return !!melee;
    default:
      return true;
  }
}

/** Whether a degree condition holds for one target's degree of success (others always do). */
export function degreeMet(when, degree) {
  switch (when) {
    case 'hit':
      return HITS.includes(degree);
    case 'amazing':
      return degree === 'amazing' || degree === 'critHit';
    case 'crit':
      return degree === 'critHit';
    case 'miss':
      return !HITS.includes(degree);
    default:
      return true;
  }
}

/** Whether a modifier has a row that only works on a Surprise attack. */
export function needsSurprise(mod) {
  const rules = mod?.system?.rollModRules ?? modRules(mod.system);
  return [...rules.rank, ...rules.dice, ...rules.dr].some((row) => row.when === 'surprise');
}

/** Whether a modifier has a damage multiplier that only works at melee range. */
export function needsMeleeMod(mod) {
  const rules = mod?.system?.rollModRules ?? modRules(mod.system);
  return (rules.multiply ?? []).some((row) => row.when === 'melee');
}

/*  Which modifiers apply                       */

/** The entries of a modifier's list (lower case): skill names, #tags and `self` (see skill-list.mjs). */
export function listedSkills(mod) {
  return listEntries(mod?.system?.rollMod?.skills);
}

/** Whether a modifier lists itself: it applies whenever it is used. */
export const appliesToSelf = (mod) => listedSkills(mod).includes(CONFIG.CARL_RPG.rollMods.self);

/**
 * Whether a modifier lists this skill: by name or identifier, or by a #tag the skill or the
 * item being used carries. `self` never matches another skill.
 */
export function modAccepts(mod, skill, item = null) {
  if (!skill) return false;
  return listAccepts(listedSkills(mod), skill, item, { skip: [CONFIG.CARL_RPG.rollMods.self] });
}

/**
 * The modifiers an actor can choose for a skill: theirs, listing the skill (never the skill
 * itself, which a `self` modifier covers).
 * @param {Actor|null} actor
 * @param {Item|null} skill  The skill the roll uses
 * @param {Item|null} [used]  The item being used, when it is not the skill (its tags count)
 * @returns {Item[]}
 */
export function availableMods(actor, skill, used = null) {
  if (!actor || !skill) return [];
  return actor.items.filter(
    (item) => isRollMod(item) && item.id !== skill.id && modAccepts(item, skill, used)
  );
}

/** The skill itself when it is a modifier that lists `self`, else null. */
export const selfModOf = (skill) => (isRollMod(skill) && appliesToSelf(skill) ? skill : null);

/*  What a use gets                             */

/**
 * Fold the active modifiers for one roll.
 * @param {Item[]} mods  The modifiers in play (the chosen one, the skill itself)
 * @param {{mode?: string, surprise?: boolean, melee?: boolean}} roll  The roll's final mode and the
 *   Surprise and melee range ticks
 * @returns {{rank: {id: string, name: string, amount: number}[],
 *   dr: {id: string, name: string, amount: number}[],
 *   dice: {item: Item, name: string, formula: string, when: string, types: string[]}[],
 *   multipliers: {value: number, scope: string, when: string}[]}}
 *   Dice rows keep a degree condition: it is checked against each target later.
 */
export function resolveMods(mods, { mode = 'normal', surprise = false, melee = false } = {}) {
  const out = { rank: [], dr: [], dice: [], multipliers: [] };
  for (const mod of mods) {
    const rules = mod.system.rollModRules ?? modRules(mod.system);
    const rank = Math.max(0, Math.trunc(Number(rankOf(mod.system)) || 0));
    const ctx = { mode, surprise, melee };
    const base = { id: mod.id, name: mod.name };
    for (const row of rules.rank) {
      if (rank > 0 && whenMet(row.when, ctx)) out.rank.push({ ...base, amount: rank });
    }
    for (const row of rules.dr) {
      if (row.amount > 0 && whenMet(row.when, ctx)) out.dr.push({ ...base, amount: row.amount });
    }
    // (degree conditions of a multiplier are read per target, with the attack)
    for (const row of rules.multiply ?? []) {
      if (whenMet(row.when, ctx)) out.multipliers.push({ ...row });
    }
    for (const row of rules.dice) {
      if (row.formula && whenMet(row.when, ctx)) {
        out.dice.push({
          item: mod,
          name: mod.name,
          formula: row.formula,
          when: row.when,
          types: row.types ?? [],
        });
      }
    }
  }
  return out;
}

/**
 * Add the modifiers' Rank to the roll pop-up's answers (as extra bonus), with a note for
 * the chat card.
 * @param {{bonus?: string, auto?: string[]}} options
 * @param {{rank: {name: string, amount: number}[]}} resolved
 */
export function addRankBonus(options, resolved) {
  const amount = resolved.rank.reduce((sum, row) => sum + row.amount, 0);
  if (!amount) return options;
  const bonus = String(options.bonus ?? '').trim();
  const notes = resolved.rank.map((row) =>
    t('CARL_RPG.RollMod.RankNote', { name: esc(row.name), value: row.amount })
  );
  return {
    ...options,
    bonus: bonus ? `${bonus} + ${amount}` : String(amount),
    auto: [...(options.auto ?? []), ...notes],
  };
}

/** The DR bonuses of a use, one entry per modifier: {id: {amount, name}}. */
export function drGrantsOf(resolved) {
  const grants = {};
  for (const row of resolved.dr) {
    grants[row.id] ??= { amount: 0, name: row.name };
    grants[row.id].amount += row.amount;
  }
  return grants;
}

/** Short notes for the chat card about the DR bonuses just set. */
export const drNotes = (grants) =>
  Object.values(grants).map((grant) =>
    t('CARL_RPG.RollMod.DrNote', { name: esc(grant.name), value: grant.amount })
  );

/*  DR waiting for the next damage              */

const relayed = async (doc, data) => {
  const { updateWithRelay } = await import('./relay.mjs');
  return updateWithRelay(doc, data);
};

/** The DR bonuses an actor is holding: {modifier id: {amount, name}}. */
export const tempDROf = (actor) => actor?.flags?.[NS]?.tempDR ?? {};

/** The DR an actor's modifiers add to the next damage it takes. */
export function tempDRTotal(actor) {
  return Object.values(tempDROf(actor)).reduce(
    (sum, entry) => sum + (Math.trunc(Number(entry?.amount)) || 0),
    0
  );
}

/**
 * Hold DR for the next damage. A modifier used again replaces its own earlier bonus; other
 * modifiers' bonuses add up with it.
 * @param {Actor} actor
 * @param {Object<string, {amount: number, name: string}>} grants  See drGrantsOf
 */
export async function grantTempDR(actor, grants) {
  if (!actor || !Object.keys(grants ?? {}).length) return;
  await relayed(actor, { [`flags.${NS}.tempDR`]: { ...tempDROf(actor), ...grants } });
}

/** Use up the held DR (the next damage was taken, a round ended, or the combat did). */
export async function clearTempDR(actor) {
  if (!actor || !Object.keys(tempDROf(actor)).length) return;
  await actor.update({ [`flags.${NS}.-=tempDR`]: null });
}
