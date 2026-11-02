/**
 * The skills and spells a pet's upgrades give it.
 *
 * Most of what an upgrade does is worked out from the pet's level as it is
 * prepared (see data/actor-pet.mjs). Giving a skill or spell is different: it adds
 * a real item to the pet, so it happens when the pet reaches the level (or when
 * the upgrades are edited), by whoever made the change. A pet that already has
 * the skill (matched by identifier, else name) isn't given another, and a skill
 * it was given stays if its level is lowered again.
 */

/**
 * Give a pet every skill and spell its reached upgrades hand out that it doesn't
 * have yet.
 * @param {Actor} actor
 */
export async function syncPetGrants(actor) {
  if (actor?.type !== 'pet' || !actor.isOwner) return;

  const matches = (a, b) => {
    const identifier = a.system?.identifier?.trim();
    return identifier
      ? b.system?.identifier?.trim() === identifier
      : a.type === b.type && a.name === b.name;
  };

  const toCreate = [];
  for (const uuid of actor.system.upgradeGrants ?? []) {
    const template = await fromUuid(uuid);
    if (!template || !['skill', 'spell'].includes(template.type)) continue;
    if (actor.items.some((owned) => matches(template, owned))) continue;
    if (toCreate.some((data) => matches(template, data))) continue;
    const data = game.items.fromCompendium(template);
    // A pet's skills use the floor in place of a rank, so there is none to set.
    foundry.utils.setProperty(data, 'system.rank', 0);
    toCreate.push(data);
  }
  if (toCreate.length) await actor.createEmbeddedDocuments('Item', toCreate);
}

/** Hand out skills and spells when a pet levels up or its upgrades are changed. */
export function registerPetUpgrades() {
  Hooks.on('updateActor', (actor, changes, options, userId) => {
    if (actor.type !== 'pet' || userId !== game.user.id || options?.carlMigration) return;
    const system = changes.system;
    if (!system) return;
    if (
      foundry.utils.hasProperty(system, 'attributes.level') ||
      'upgrades' in system
    ) {
      syncPetGrants(actor);
    }
  });
}
