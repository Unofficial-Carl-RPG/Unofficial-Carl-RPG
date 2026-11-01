/**
 * How long effects last, beyond "until a rest" (see helpers/rests.mjs).
 *
 * An effect can last a number of rounds (`flags.carl-rpg.rounds`, counted down at the
 * end of each round: when the Cleanup phase starts), or until the end of the combat
 * (`lastsUntil` is "combat"). When it runs out it is switched off (a stackable one
 * loses all its stacks) and chat says so. The count starts when the effect is
 * switched on (see CarlRPGActiveEffect).
 */
const NS = 'carl-rpg';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Switch an effect off because its time is up, and say so in chat. */
async function expire(effect) {
  if (effect.stackable) await effect.removeAllStacks();
  else await effect.setActive(false);
  await effect.unsetFlag(NS, 'roundsLeft');
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: effect.actor }),
    content: t('CARL_RPG.Effect.Expired', {
      effect: foundry.utils.escapeHTML(effect.name),
      name: foundry.utils.escapeHTML(effect.actor.name),
    }),
  });
}

/**
 * At the end of a round: count down every active effect that lasts a number of
 * rounds, and end those that have run out.
 * @param {Actor} actor
 */
export async function tickDurations(actor) {
  for (const effect of actor.effects) {
    const rounds = Number(effect.getFlag(NS, 'rounds')) || 0;
    if (rounds < 1 || effect.disabled) continue;
    const left = (Number(effect.getFlag(NS, 'roundsLeft')) || rounds) - 1;
    if (left < 1) await expire(effect);
    else await effect.setFlag(NS, 'roundsLeft', left);
  }
}

/**
 * At the end of a combat: end the effects that last until it is over.
 * @param {Actor} actor
 */
export async function endCombatEffects(actor) {
  for (const effect of actor.effects) {
    if (effect.getFlag(NS, 'lastsUntil') !== 'combat' || effect.disabled) continue;
    await expire(effect);
  }
}
