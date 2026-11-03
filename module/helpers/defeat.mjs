import { recordRecap } from './recap.mjs';

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
  // Remember which combat the mob was defeated in, for the end-of-combat loot reminder.
  const combat = game.combats.find((c) => c.combatants.some((cb) => cb.actorId === mob.id));
  if (combat) await mob.setFlag('carl-rpg', 'defeatedIn', combat.id);
  await removeFromCombat(mob);
  if (mob.system.mobType === 'elite') {
    recordRecap({
      kind: 'elite',
      line: game.i18n.format('CARL_RPG.Recap.LineElite', { name: foundry.utils.escapeHTML(mob.name) }),
    });
  }
}
