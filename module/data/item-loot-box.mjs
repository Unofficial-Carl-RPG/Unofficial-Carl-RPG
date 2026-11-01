import CarlRPGItemBase from './base-item.mjs';

/**
 * A loot box. Opening one draws items from its reward list (by weight) and
 * pays gold, then uses the box up. The reward list never holds other loot
 * boxes. See helpers/loot.mjs for opening.
 */
export default class CarlRPGLootBox extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.LootBox',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.tier = new fields.StringField({
      required: true,
      blank: false,
      choices: Object.keys(CONFIG.CARL_RPG.lootTiers),
      initial: 'bronze',
    });

    schema.quantity = new fields.NumberField({
      ...requiredInteger,
      initial: 1,
      min: 0,
    });

    // How many items are drawn from the reward list when a box is opened.
    schema.draws = new fields.NumberField({
      ...requiredInteger,
      initial: 1,
      min: 0,
    });

    // Gold paid per box: a number or dice formula. Blank = the tier's default.
    schema.goldOverride = new fields.StringField({
      required: true,
      blank: true,
      initial: '',
    });

    // The reward list: items (by UUID) with a quantity and a weight (higher =
    // more likely).
    schema.rewards = new fields.ArrayField(
      new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: false }),
        quantity: new fields.NumberField({
          ...requiredInteger,
          initial: 1,
          min: 1,
        }),
        weight: new fields.NumberField({
          required: true,
          nullable: false,
          initial: 1,
          min: 0,
        }),
      })
    );

    // Guaranteed items: always granted when the box is opened. They are not
    // part of the random draws (and don't count toward `draws`). `quantity` is
    // a number or a dice formula for how many are granted (e.g. "2" or "1d3").
    schema.guaranteed = new fields.ArrayField(
      new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: false }),
        quantity: new fields.StringField({
          required: true,
          blank: false,
          initial: '1',
        }),
      })
    );

    return schema;
  }

  /** The gold formula used when this box is opened. */
  get goldFormula() {
    return (
      this.goldOverride?.trim() ||
      CONFIG.CARL_RPG.lootTiers[this.tier]?.gold ||
      '0'
    );
  }
}
