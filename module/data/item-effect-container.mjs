import CarlRPGItemBase from './base-item.mjs';

/**
 * An Effect Container: a world or compendium item that only stores effects (and
 * a description and tags). Dropped on a sheet that can hold effects it passes
 * copies of them on and keeps no link to itself, so it is never added to an actor.
 * See helpers/effect-container.mjs.
 */
export default class CarlRPGEffectContainer extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = ['CARL_RPG.Item.base'];
}
