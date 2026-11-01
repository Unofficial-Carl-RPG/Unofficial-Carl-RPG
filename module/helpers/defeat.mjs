/**
 * A mob at 0 health is defeated: it gets Foundry's skull overlay and leaves the
 * combat. Crawler-type mobs are not handled here yet; they follow the Dying rules,
 * which are built separately.
 *
 * Runs only on the active GM's client, so it works whichever player's event or
 * attack brought the mob to 0 and the GM is the one who can change the combat.
 * @param {CarlRPGMob} mob
 */
export async function defeatMob(mob) {
  if (mob.system.mobType === 'crawler') return;
  if (mob.statuses?.has('dead')) return;
  await mob.toggleStatusEffect('dead', { active: true, overlay: true });
  for (const combat of game.combats) {
    const ids = combat.combatants.filter((c) => c.actorId === mob.id).map((c) => c.id);
    if (ids.length) await combat.deleteEmbeddedDocuments('Combatant', ids);
  }
}
