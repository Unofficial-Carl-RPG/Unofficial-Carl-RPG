/**
 * Delayed damage.
 *
 * The "Delayed damage" event action (Shock Treatment rank 10: one Rank damage die of
 * Electric damage at the end of the round) puts typed damage on the running combat. When a
 * later round ends (the Cleanup phase starts) the GM's client rolls it and deals it to the
 * creature the way any other damage is dealt: through `applyDamage`, so the type's
 * resistance, immunity or vulnerability and the creature's Damage Resistance all count.
 *
 * The queue is a flag on the combat document, so it stops by itself when the combat ends
 * (nothing is dealt after it). With no running combat the action does nothing but warn.
 * A creature that is dead when its turn comes up is skipped.
 *
 * Each entry: {id, targetUuid, targetName, sourceName, formula, type, ignoreDR, left}.
 * `formula` is plain dice (names and @rankDamage already filled in when it was queued) that
 * is rolled when the damage lands; `left` is how many round ends are still to pass.
 *
 * Players never see mob numbers: a mob's damage line is whispered to the GM by applyDamage
 * and the note posted here carries no numbers.
 */
import { evalAmount, fillData } from './amounts.mjs';
import { expandRankDamage, usesRankDamage } from './rank-damage.mjs';

const NS = 'carl-rpg';

/** The combat flag that holds the queue. */
export const FLAG = 'delayedDamage';

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

/** The queued entries of a combat. */
export const queueOf = (combat) => combat?.flags?.[NS]?.[FLAG] ?? [];

/*  Planning an action                          */

/**
 * Work out a "Delayed damage" action from its stored fields and the roll data.
 * @param {object} action  {amount, damageType, delay, ignoreDR}
 * @param {object} data  Roll data its @names read (see events.mjs eventData)
 * @param {Item|null} [rankSource]  Whose rank dice @rankDamage means
 * @returns {{formula: string, delay: number, type: string, ignoreDR: boolean}|{error: string, data?: object}}
 *   `error` is a warning key (and its values) when the action can't be queued
 */
export function planDelayed(action, data, rankSource = null) {
  let text = String(action?.amount ?? '').trim();
  if (!text) return { error: 'CARL_RPG.Events.Warn.DelayedNoAmount' };
  if (usesRankDamage(text)) text = expandRankDamage(text, rankSource);
  const filled = fillData(text, data);
  if (filled.missing.length) {
    return { error: 'CARL_RPG.Events.Warn.BadFormula', data: { formula: text } };
  }
  if (!Roll.validate(filled.text)) return { error: 'CARL_RPG.Events.Warn.DelayedNoAmount' };

  // How many round ends to wait: blank is the next one (the end of this round).
  const waiting = String(action?.delay ?? '').trim() || '1';
  const delay = evalAmount(waiting, data);
  if (delay === null) {
    return { error: 'CARL_RPG.Events.Warn.BadFormula', data: { formula: waiting } };
  }
  return {
    formula: filled.text,
    delay: Math.max(1, Math.floor(delay)),
    type: String(action?.damageType ?? '').trim(),
    ignoreDR: !!action?.ignoreDR,
  };
}

/**
 * A queue entry for a plan.
 * @param {{formula: string, delay: number, type: string, ignoreDR: boolean}} plan  See planDelayed
 * @param {{id: string, targetUuid: string, targetName: string, sourceName: string}} who
 */
export function makeEntry(plan, { id, targetUuid, targetName, sourceName }) {
  return {
    id,
    targetUuid,
    targetName,
    sourceName,
    formula: plan.formula,
    type: plan.type,
    ignoreDR: plan.ignoreDR,
    left: plan.delay,
  };
}

/**
 * A round end passes: every entry has one less to wait, and those that are down to none are due.
 * @param {object[]} entries
 * @returns {{due: object[], rest: object[]}}
 */
export function advance(entries) {
  const due = [];
  const rest = [];
  for (const entry of entries ?? []) {
    const left = (Number(entry.left) || 0) - 1;
    if (left <= 0) due.push(entry);
    else rest.push({ ...entry, left });
  }
  return { due, rest };
}

/*  The queue on the combat (GM's client)       */

/** Add an entry to a combat's queue. */
export async function queueDelayed(combat, entry) {
  await combat.setFlag(NS, FLAG, [...queueOf(combat), entry]);
}

/** Roll an entry's damage and deal it. Nothing happens for a creature that is gone or dead. */
export async function dealEntry(entry) {
  const doc = await fromUuid(entry.targetUuid);
  const actor = doc?.documentName === 'Actor' ? doc : (doc?.actor ?? null);
  if (!actor || actor.statuses?.has('dead')) return false;
  let amount;
  try {
    const roll = await new Roll(entry.formula).evaluate();
    amount = Math.max(0, Math.floor(roll.total));
  } catch (err) {
    console.error(`${NS} | delayed damage could not be rolled`, err);
    return false;
  }
  if (!(amount > 0)) return false;
  await ChatMessage.create({
    content: `<em>${t('CARL_RPG.Events.Delayed.Lands', {
      item: esc(entry.sourceName),
      name: esc(actor.name),
    })}</em>`,
  });
  await actor.applyDamage(amount, { damageType: entry.type, ignoreDR: !!entry.ignoreDR });
  return true;
}

/**
 * A round ends: count the queue down and deal what is due. The queue is saved first, so
 * nothing can be dealt twice.
 * @param {Combat} combat
 */
export async function tickDelayed(combat) {
  const queued = queueOf(combat);
  if (!queued.length) return;
  const { due, rest } = advance(queued);
  await combat.setFlag(NS, FLAG, rest);
  for (const entry of due) {
    try {
      await dealEntry(entry);
    } catch (err) {
      console.error(`${NS} | delayed damage failed`, err);
    }
  }
}

/** Hook: the Cleanup phase (fired once, on the GM's client) deals what is due. */
export function registerDelayedDamage() {
  Hooks.on('carlrpg.cleanupPhase', (combat) => {
    if (game.user === game.users.activeGM) tickDelayed(combat);
  });
}
