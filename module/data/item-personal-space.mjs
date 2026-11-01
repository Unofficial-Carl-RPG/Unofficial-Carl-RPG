import CarlRPGItemBase from './base-item.mjs';

/**
 * A crawler's Personal Space: a tier, a size and a list of amenities (name and
 * description). A crawler has one; dropping a second replaces the first.
 */
export default class CarlRPGPersonalSpace extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.PersonalSpace',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.tier = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.size = new fields.StringField({ required: true, blank: false, initial: 'medium' });
    schema.amenities = new fields.ArrayField(
      new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: '' }),
        description: new fields.StringField({ required: true, blank: true, initial: '' }),
      })
    );

    return schema;
  }
}
