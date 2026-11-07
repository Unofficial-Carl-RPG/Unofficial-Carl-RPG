/**
 * What marks an actor as a summon or minion, and which side of the combat it is on.
 *
 * A token made by the event action "Summon" (see helpers/minions.mjs) carries
 * flags.carl-rpg.summon on its actor (a token's own copy of the actor, so each
 * token has its own). Kept apart from minions.mjs so the combat document and the
 * loot rules can read it without pulling in token placement.
 */
const NS = 'carl-rpg';
export const SUMMON_FLAG = 'summon';

/**
 * The summon flag of an actor: {mode, key, itemUuid, itemName, casterUuid, casterName, at,
 * lasts, roundsLeft, side, before, owners}, or null for an actor that is not a summon.
 * @param {Actor|null|undefined} actor
 * @returns {object|null}
 */
export function summonFlag(actor) {
  return actor?.getFlag?.(NS, SUMMON_FLAG) ?? actor?.flags?.[NS]?.[SUMMON_FLAG] ?? null;
}

/**
 * Which side an actor fights on: 'mob' or 'crawler'. Mobs are on the mobs' side and
 * everything else (crawlers, pets, mounts) on the crawlers', unless it is a summon, which
 * is on the side of whoever made it (a raised Mob fights for the crawlers).
 * @param {Actor|null|undefined} actor
 * @returns {'mob'|'crawler'}
 */
export function sideOfActor(actor) {
  const flag = summonFlag(actor);
  if (flag?.side) return flag.side;
  return actor?.type === 'mob' ? 'mob' : 'crawler';
}

/**
 * Whether an actor is a summon that only exists for a while (a copy or a placed token):
 * no loot, no defeated reminder. A raised Mob is not one: it is the real Mob again.
 * @param {Actor|null|undefined} actor
 */
export function isTempSummon(actor) {
  const flag = summonFlag(actor);
  return !!flag && flag.mode !== 'raise';
}
