import CarlRPGItemBase from './base-item.mjs';

/**
 * A Background: a group of skills offered in character creation (see
 * helpers/creation.mjs). Each creation category (Childhood, Adolescence, Hobby,
 * Career) offers the backgrounds ticked for it. The player picks a background,
 * then two of its skills. A background does nothing else.
 */
export default class CarlRPGBackground extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Background',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The creation categories this is offered in: ids from
    // CONFIG.CARL_RPG.creation.skillGroups. It can be in more than one.
    schema.categories = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    // The skills it offers (UUIDs of Skill items). Three is typical; the player
    // picks two of however many there are.
    schema.skills = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    return schema;
  }
}
