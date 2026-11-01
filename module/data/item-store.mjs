import CarlRPGItemBase from './base-item.mjs';

/**
 * A store: the items it sells. A listing points at a world item, or holds a
 * copy (a snapshot) of an item a crawler sold to the store. Each listing has a
 * price (blank: the item's value), a stock now (blank: unlimited) and a starting
 * stock that Restock sets the stock back to (blank: unlimited). The sell
 * percentage is what a crawler gets back when they sell an item to the store.
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
        // null: the item's value (price) or unlimited (stock and starting stock).
        price: new fields.NumberField({ nullable: true, integer: true, min: 0, initial: null }),
        quantity: new fields.NumberField({ nullable: true, integer: true, min: 0, initial: null }),
        startStock: new fields.NumberField({ nullable: true, integer: true, min: 0, initial: null }),
        // For an item sold to the store: a copy of it (name, picture, type, system,
        // effects, flags). Null for listings that point at a world item.
        snapshot: new fields.ObjectField({ nullable: true, initial: null }),
      })
    );

    return schema;
  }
}
