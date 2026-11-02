import CarlRPGItemBase from './base-item.mjs';

/**
 * A deity a crawler worships. Dropped onto a crawler (no chooser); a crawler has
 * one, and a new one replaces the old. Its description, skills, effects and events
 * are the same editors every item has.
 *
 * Worship: the Offering text is posted to chat when the crawler makes an offering.
 * The tithe is the percent of loot-box and mob gold the crawler gives up (rounded
 * down). The tier is set by the GM on the crawler's copy (0 is none) and starts at 1;
 * each tier unlocks its own effects, and they stack.
 */
export default class CarlRPGDeity extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Deity',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The text posted to chat when the crawler makes an offering.
    schema.offering = new fields.StringField({ required: true, blank: true, initial: '' });
    // The percent of loot-box and mob gold the deity takes (see helpers/tithe.mjs).
    schema.tithe = new fields.NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      max: 100,
      initial: 5,
    });
    // The crawler's tier with this deity (0 is none, 1 to 3 unlock effects).
    schema.tier = new fields.NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      max: 3,
      initial: 0,
    });

    return schema;
  }
}
