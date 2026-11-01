import CarlRPGItemBase from './base-item.mjs';

/**
 * A club, society or guild. The world item is the template: description, effects
 * and events for members. A crawler's copy holds its own rank or role. A crawler
 * can belong to any number of clubs.
 */
export default class CarlRPGClub extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Club',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The member's rank or role in this club (set on the crawler's copy).
    schema.role = new fields.StringField({ required: true, blank: true, initial: '' });

    return schema;
  }
}
