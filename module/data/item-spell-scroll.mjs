import CarlRPGSpell from './item-spell.mjs';

/**
 * A Spell Scroll: a spell at a set rank that is used up when it is cast. It is built like
 * a spell (the copy of the spell it holds lives in its own fields) with a Quantity and a
 * record of the spell it was copied from. See helpers/spell-scroll.mjs.
 */
export default class CarlRPGSpellScroll extends CarlRPGSpell {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.SpellScroll',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const requiredString = (initial = '') =>
      new fields.StringField({ required: true, blank: true, initial });
    const schema = super.defineSchema();

    schema.quantity = new fields.NumberField({
      ...requiredInteger,
      initial: 1,
      min: 0,
    });

    // The rank the spell is cast at.
    schema.rank = new fields.NumberField({
      ...requiredInteger,
      initial: 1,
      min: 0,
    });

    // The spell the copy was made from (blank until one is dropped on the scroll).
    schema.spellSource = new fields.SchemaField({
      uuid: requiredString(),
      name: requiredString(),
      identifier: requiredString(),
      img: requiredString(),
    });

    return schema;
  }

  /** The scroll's rank is exact: the owner's rank bonuses and the skill cap never touch it. */
  get fixedRank() {
    return true;
  }
}
