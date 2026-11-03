/**
 * Dying: a crawler (or Crawler-type mob) at 0 health is Dying for a number of rounds
 * equal to its CON modifier (at least 1). The count drops at each round end (see
 * helpers/effect-duration.mjs) and by 1 for every hit that gets through while
 * Dying. Any healing cancels it. When the count runs out the actor dies: a permanent
 * Dead effect, the skull overlay, and out of the combat. Only the GM is told (a whisper);
 * a GM can bring the crawler back with revive().
 *
 * Other mobs, pets and mounts don't Dying; they just go down (see helpers/defeat.mjs).
 */
import { removeFromCombat } from './defeat.mjs';

const NS = 'carl-rpg';

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** A note only the GM sees. */
async function whisperGM(content) {
  const whisper = ChatMessage.getWhisperRecipients('GM').map((u) => u.id);
  if (whisper.length) await ChatMessage.create({ content, whisper });
}

/** Crawlers and Crawler-type mobs can be Dying. */
export function canDie(actor) {
  return (
    actor?.type === 'crawler' || (actor?.type === 'mob' && actor.system.mobType === 'crawler')
  );
}

/** The Dying effect on an actor, or null. */
export function dyingEffectOf(actor) {
  return actor?.effects.find((e) => e.getFlag(NS, 'dying')) ?? null;
}

/**
 * Start Dying at 0 health. Does nothing if the actor is already Dying or dead.
 * @param {Actor} actor
 */
export async function startDying(actor) {
  if (dyingEffectOf(actor) || actor.statuses?.has('dead')) return;
  const rounds = Math.max(1, Number(actor.system.abilities?.con?.mod) || 1);
  await actor.createEmbeddedDocuments('ActiveEffect', [
    {
      name: t('CARL_RPG.Combat.DyingEffect'),
      img: 'icons/svg/skull.svg',
      origin: actor.uuid,
      disabled: false,
      changes: [],
      flags: {
        [NS]: {
          kind: 'debuff',
          dying: true,
          rounds,
          roundsLeft: rounds,
          sourceItems: [],
          stacks: 1,
        },
      },
    },
  ]);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { 'carl-rpg': { cue: 'dying' } },
    content: t('CARL_RPG.Combat.DyingStarted', { name: actor.name, rounds }),
  });
  await whisperGM(t('CARL_RPG.Combat.DyingGmNote', { name: actor.name, rounds }));
}

/**
 * Healing cancels Dying.
 * @param {Actor} actor
 */
export async function cancelDying(actor) {
  const dying = dyingEffectOf(actor);
  if (dying) await dying.delete();
}

/**
 * A hit got through while the actor is Dying: take 1 off the count, and die at 0.
 * Called where damage is applied.
 * @param {Actor} actor
 */
export async function hurtWhileDying(actor) {
  const dying = dyingEffectOf(actor);
  if (!dying || dying.disabled) return;
  const left = (Number(dying.getFlag(NS, 'roundsLeft')) || 1) - 1;
  if (left < 1) await die(actor);
  else await dying.setFlag(NS, 'roundsLeft', left);
}

/**
 * The actor dies: a permanent Dead effect, the skull overlay, and out of the combat.
 * @param {Actor} actor
 */
export async function die(actor) {
  await cancelDying(actor);
  if (actor.statuses?.has('dead')) return;
  await actor.createEmbeddedDocuments('ActiveEffect', [
    {
      name: t('CARL_RPG.Combat.DeadEffect'),
      img: 'icons/svg/skull.svg',
      origin: actor.uuid,
      disabled: false,
      changes: [],
      flags: { [NS]: { kind: 'debuff', dead: true, sourceItems: [], stacks: 1 } },
    },
  ]);
  await actor.toggleStatusEffect('dead', { active: true, overlay: true });
  await removeFromCombat(actor);
  await whisperGM(t('CARL_RPG.Combat.DiedGmNote', { name: actor.name }));
}

/** True when the actor has died (has the Dead effect). */
export function isDead(actor) {
  return canDie(actor) && !!actor.statuses?.has('dead');
}

/**
 * Bring a dead crawler back: the Dead effect and skull go, any Dying count is cleared,
 * and they come back with 1 health box. They are not put back in the combat.
 * @param {Actor} actor
 */
export async function revive(actor) {
  if (!canDie(actor)) return;
  await cancelDying(actor);
  const dead = actor.effects.filter((e) => e.getFlag(NS, 'dead'));
  if (dead.length) await actor.deleteEmbeddedDocuments('ActiveEffect', dead.map((e) => e.id));
  if (actor.statuses?.has('dead')) await actor.toggleStatusEffect('dead', { active: false });
  await actor.update({ 'system.health.value': 1 });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: t('CARL_RPG.Combat.Revived', { name: actor.name }),
  });
}
