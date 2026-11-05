import CarlRPGItemBase from './base-item.mjs';
import { actionFormula, actionSchema, migrateAction } from './action.mjs';
import { isTwoHanded } from '../helpers/gear-slots.mjs';

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

    // The skill (one of the skills above) a weapon rolls with. Blank means the first.
    schema.rollSkill = new fields.StringField({ blank: true, initial: '' });

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

    // Whether this gear needs both hands (only counts in the Hands slot, see
    // helpers/gear-slots.mjs).
    schema.twoHanded = new fields.BooleanField({
      required: true,
      nullable: false,
      initial: false,
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

    // What using it does, roll-wise (see data/action.mjs).
    schema.action = actionSchema();

    schema.formula = new fields.StringField({ blank: true });

    return schema;
  }

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    return migrateAction(source, 'gear');
  }

  prepareDerivedData() {
    this.formula = actionFormula(this.action);
    // Derived: two-handed only counts in the Hands slot.
    this.isTwoHanded = isTwoHanded(this);
  }
}
