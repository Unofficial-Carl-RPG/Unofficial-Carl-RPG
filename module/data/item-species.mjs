import CarlRPGItemBase from './base-item.mjs';

/**
 * A species: what an animal crawler (a pet that ate an Enhanced Pet Biscuit, like
 * Donut) starts as. Species are built by the GM and chosen on an optional step of
 * the creation wizard, when the GM allows them (see helpers/creation.mjs).
 *
 * Choosing one adds it to the crawler: it sets the crawler's size and the Race box
 * to its name, adds the skills it grants at their set ranks, and copies the effects
 * on it to the crawler like any item's. Race and class are still chosen on the
 * third floor, and a race then replaces the name in the Race box.
 */
export class CarlRPGSpecies extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = ['CARL_RPG.Item.base', 'CARL_RPG.Item.Species'];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The crawler's size (a key of CONFIG.CARL_RPG.sizes).
    schema.size = new fields.StringField({
      required: true,
      blank: false,
      initial: 'medium',
    });

    // Skills the crawler gets (by UUID of a Skill item) and the rank they start at.
    schema.grantedSkills = new fields.ArrayField(
      new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: false }),
        rank: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          initial: 1,
          min: 0,
        }),
      })
    );

    return schema;
  }
}
