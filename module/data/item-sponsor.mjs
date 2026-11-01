import CarlRPGItemBase from './base-item.mjs';

/**
 * A sponsor: a name, picture, description and notes. A crawler can hold up to
 * the sponsor limit (a world setting, -1 for no limit). The GM sends gifts
 * through loot boxes from the sponsor's Send gift button.
 */
export default class CarlRPGSponsor extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Sponsor',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.notes = new fields.StringField({ required: true, blank: true, initial: '' });

    return schema;
  }
}
