/**
 * The global floor: one number, set by the GM, that every crawler and mob uses
 * as their Floor. See CarlRPGGMTab for the control.
 */
export const FLOOR_SETTING = 'floor';

/** Register the world setting that stores the current floor. */
export function registerFloorSetting() {
  game.settings.register('carl-rpg', FLOOR_SETTING, {
    name: 'CARL_RPG.GMTab.Floor',
    scope: 'world',
    config: false,
    type: new foundry.data.fields.NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      initial: 1,
    }),
    onChange: refreshForFloor,
  });
}

/** The current floor. */
export function getFloor() {
  try {
    return game.settings.get('carl-rpg', FLOOR_SETTING) ?? 1;
  } catch (err) {
    // The setting isn't registered yet (very early in startup).
    return 1;
  }
}

/**
 * Everything that shows the floor reads it while preparing data, so when it
 * changes, prepare actors again and redraw their open sheets and the GM tab.
 */
function refreshForFloor() {
  const actors = new Set(game.actors);
  // Unlinked tokens have their own synthetic actors.
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.add(token.actor);
    }
  }
  for (const actor of actors) {
    actor.reset();
    actor.render(false);
  }
  ui.carlGM?.render();
}
