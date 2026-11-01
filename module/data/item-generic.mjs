import CarlRPGItemBase from './base-item.mjs';

/**
 * A plain inventory item (the "Item" type): a description and a quantity.
 */
export default class CarlRPGGenericItem extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Item',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.quantity = new fields.NumberField({
      ...requiredInteger,
      initial: 1,
      min: 0,
    });

    // Skills (UUIDs of Skill items) that are also added to an actor when this
    // item is added to them, if they don't already have them.
    schema.skills = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    return schema;
  }
}
