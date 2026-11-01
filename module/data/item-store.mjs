import CarlRPGItemBase from './base-item.mjs';

/**
 * A store: the items it sells. Each listing points at a world item and has its
 * own price (blank: the item's value) and stock (blank: unlimited, a number
 * counts down as it sells). The sell percentage is what a crawler gets back
 * when they sell an item to the store. The GM opens a store for a crawler (see
 * the store window).
 */
export default class CarlRPGStore extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Store',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.sellPercent = new fields.NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      max: 100,
      initial: 50,
    });

    schema.listings = new fields.ArrayField(
      new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: true, initial: '' }),
        // null: use the item's value (price) or unlimited stock (quantity).
        price: new fields.NumberField({ nullable: true, integer: true, min: 0, initial: null }),
        quantity: new fields.NumberField({ nullable: true, integer: true, min: 0, initial: null }),
      })
    );

    return schema;
  }
}
