import CarlRPGItemBase from './base-item.mjs';

/**
 * An achievement. The GM awards one by dropping it on a crawler; the first time
 * a crawler receives it, they are also given the loot box it names (see
 * CarlRPGItem#_onCreate). A crawler can only hold each achievement once, and
 * removing and re-adding one doesn't pay the reward a second time.
 */
export default class CarlRPGAchievement extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Achievement',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The loot box granted on first receipt (the UUID of a Loot Box item).
    schema.lootBox = new fields.StringField({
      required: true,
      blank: true,
      initial: '',
    });

    return schema;
  }
}
