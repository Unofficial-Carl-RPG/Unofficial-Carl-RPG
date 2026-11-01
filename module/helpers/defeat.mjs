/**
 * Taking an actor out of the combat: its combatants are removed from every combat.
 * @param {Actor} actor
 */
export async function removeFromCombat(actor) {
  for (const combat of game.combats) {
    const ids = combat.combatants.filter((c) => c.actorId === actor.id).map((c) => c.id);
    if (ids.length) await combat.deleteEmbeddedDocuments('Combatant', ids);
  }
}

/**
 * A mob at 0 health is defeated: it gets Foundry's skull overlay and leaves the
 * combat. Crawler-type mobs don't come here; they follow the Dying rules (see
 * helpers/dying.mjs).
 *
 * Runs only on the active GM's client (see documents/actor.mjs).
 * @param {CarlRPGMob} mob
 */
export async function defeatMob(mob) {
  if (mob.system.mobType === 'crawler') return;
  if (mob.statuses?.has('dead')) return;
  await mob.toggleStatusEffect('dead', { active: true, overlay: true });
  await removeFromCombat(mob);
}
