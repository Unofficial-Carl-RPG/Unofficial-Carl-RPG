import CarlRPGFeature from './item-feature.mjs';

/**
 * A spell is a skill (description, rank, advanceable, stat, rolled formula)
 * that also has a mana cost.
 */
export default class CarlRPGSpell extends CarlRPGFeature {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Spell',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Mana spent to cast the spell (whole number, never negative).
    schema.manaCost = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });

    return schema;
  }
}
