/**
 * The global floor, the floor state and the days-left counter. The floor is one
 * number, set by the GM, that every crawler and mob uses as their Floor. The
 * floor state says whether the floor is being explored or is a safe room. The
 * days-left counter is a number the GM sets by hand. See CarlRPGGMTab for the
 * controls.
 */
export const FLOOR_SETTING = 'floor';
export const FLOOR_STATE_SETTING = 'floorState';
export const DAYS_SETTING = 'daysLeft';
export const REST_OUTSIDE_SETTING = 'restsOutsideSafeRoom';
export const LOOT_OUTSIDE_SETTING = 'lootOutsideSafeRoom';

/** The two floor states. */
export const FLOOR_STATES = ['exploring', 'safe'];

/** Register the world settings for the floor, its state, the day count and the safe-room options. */
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
  game.settings.register('carl-rpg', FLOOR_STATE_SETTING, {
    scope: 'world',
    config: false,
    type: new foundry.data.fields.StringField({
      required: true,
      choices: FLOOR_STATES,
      initial: 'exploring',
    }),
    onChange: () => ui.carlGM?.render(),
  });
  game.settings.register('carl-rpg', DAYS_SETTING, {
    scope: 'world',
    config: false,
    type: new foundry.data.fields.NumberField({
      integer: true,
      nullable: true,
      initial: null,
    }),
    onChange: () => ui.carlGM?.render(),
  });
  // Off by default: outside a safe room, players can't rest or open loot boxes
  // unless the GM turns these on.
  game.settings.register('carl-rpg', REST_OUTSIDE_SETTING, {
    name: 'CARL_RPG.Floor.RestsName',
    hint: 'CARL_RPG.Floor.RestsHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });
  game.settings.register('carl-rpg', LOOT_OUTSIDE_SETTING, {
    name: 'CARL_RPG.Floor.LootName',
    hint: 'CARL_RPG.Floor.LootHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
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

/** The floor state: 'exploring' or 'safe'. */
export function getFloorState() {
  try {
    return game.settings.get('carl-rpg', FLOOR_STATE_SETTING) ?? 'exploring';
  } catch (err) {
    return 'exploring';
  }
}

/** Whether the floor is a safe room right now. */
export function isSafeRoom() {
  return getFloorState() === 'safe';
}

/** The days left on the floor, or null while the GM hasn't set a number. */
export function getDaysLeft() {
  try {
    return game.settings.get('carl-rpg', DAYS_SETTING) ?? null;
  } catch (err) {
    return null;
  }
}

/**
 * Whether the user may rest ('rest') or open a loot box ('loot') right now:
 * the GM always may, in a safe room anyone may, and elsewhere only when the GM
 * has turned the matching system setting on.
 * @param {'rest'|'loot'} kind
 */
export function canActOutsideSafeRoom(kind) {
  if (game.user.isGM || isSafeRoom()) return true;
  const key = kind === 'rest' ? REST_OUTSIDE_SETTING : LOOT_OUTSIDE_SETTING;
  try {
    return !!game.settings.get('carl-rpg', key);
  } catch (err) {
    return false;
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
