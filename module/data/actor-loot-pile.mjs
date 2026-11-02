import CarlRPGActorBase from './base-actor.mjs';

/**
 * A loot pile: the gold, junk and items a defeated mob gave up, or an item dropped on
 * the canvas. A mob's token links to its pile once it has been looted. Crawlers in
 * the combat open it and claim the contents (see helpers/loot-pile.mjs).
 */
export default class CarlRPGLootPile extends CarlRPGActorBase {
  static LOCALIZATION_PREFIXES = [
    ...super.LOCALIZATION_PREFIXES,
    'CARL_RPG.Actor.LootPile',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // A pile has no health of its own.
    delete schema.power;

    // The mob this pile came from (a UUID), or blank for a pile made by dropping an item.
    schema.source = new fields.StringField({ required: true, blank: true, initial: '' });

    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.junk = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // The items in the pile: each a UUID and a quantity.
    schema.items = new fields.ArrayField(
      new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: true, initial: '' }),
        quantity: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      })
    );

    return schema;
  }
}
