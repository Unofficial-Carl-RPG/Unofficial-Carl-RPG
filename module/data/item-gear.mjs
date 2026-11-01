import CarlRPGItemBase from './base-item.mjs';

export default class CarlRPGGear extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Gear',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Skills (UUIDs of Skill items) that are also added to an actor when this
    // gear is added to them, if they don't already have them.
    schema.skills = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    // Whether the gear is currently equipped (see CarlRPGItem#toggleEquipped).
    schema.equipped = new fields.BooleanField({
      required: true,
      nullable: false,
      initial: false,
    });

    // The equipment slot this gear occupies (see CONFIG.CARL_RPG.gearSlots).
    schema.slot = new fields.StringField({
      required: true,
      blank: false,
      choices: Object.keys(CONFIG.CARL_RPG.gearSlots),
      initial: 'hands',
    });

    // Damage Resistance this gear gives while it is equipped. The Damage
    // Resistance of everything a crawler has equipped adds up to their Armor
    // value (see CarlRPGCrawler#prepareDerivedData).
    schema.dr = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });

    schema.quantity = new fields.NumberField({
      ...requiredInteger,
      initial: 1,
      min: 1,
    });

    // Break down roll formula into three independent fields
    schema.roll = new fields.SchemaField({
      diceNum: new fields.NumberField({
        ...requiredInteger,
        initial: 1,
        min: 1,
      }),
      diceSize: new fields.StringField({ initial: 'd20' }),
      diceBonus: new fields.StringField({
        initial: '+@str.mod+ceil(@lvl / 2)',
      }),
    });

    schema.formula = new fields.StringField({ blank: true });

    return schema;
  }

  prepareDerivedData() {
    // Build the formula dynamically using string interpolation
    const roll = this.roll;

    this.formula = `${roll.diceNum}${roll.diceSize}${roll.diceBonus}`;
  }
}
