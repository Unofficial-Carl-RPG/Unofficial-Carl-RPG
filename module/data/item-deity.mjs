import CarlRPGItemBase from './base-item.mjs';

/**
 * A deity a crawler worships. Dropped onto a crawler (no chooser); a crawler has
 * one, and a new one replaces the old. Its description, skills, effects and events
 * are the same editors every item has.
 */
export default class CarlRPGDeity extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Deity',
  ];
}
