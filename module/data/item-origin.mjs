import CarlRPGItemBase from './base-item.mjs';

/**
 * Races and classes share this model. Choosing one adds it to the crawler
 * (race first, then class, from the third floor): its granted skills are added
 * at their set ranks, and the effects on it are copied to the crawler like any
 * item's. Prerequisites decide who can take it (see helpers/origins.mjs).
 */
export class CarlRPGOrigin extends CarlRPGItemBase {
  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

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

    // What a crawler must meet to take this (all of them). `uuid` is a skill,
    // race or achievement depending on `type`.
    schema.prerequisites = new fields.ArrayField(
      new fields.SchemaField({
        type: new fields.StringField({ required: true, blank: true, initial: 'stat' }),
        stat: new fields.StringField({ required: true, blank: true, initial: 'str' }),
        value: new fields.NumberField({ required: true, nullable: false, initial: 1 }),
        category: new fields.StringField({ required: true, blank: true, initial: 'earthBased' }),
        uuid: new fields.StringField({ required: true, blank: true, initial: '' }),
        tag: new fields.StringField({ required: true, blank: true, initial: '' }),
      })
    );

    // Whether this is from Earth. Anything that isn't is Alien (assumed), so
    // there is no separate Alien setting. A class can require an Earth-Based or
    // an Alien race.
    schema.earthBased = new fields.BooleanField({ initial: false });

    // Hidden from crawlers until they meet its requirements or the GM reveals it.
    schema.hidden = new fields.BooleanField({ initial: false });

    return schema;
  }

  /** @override */
  static migrateData(source) {
    // Earlier versions had a list of race categories: keep Earth-Based if set.
    if (Array.isArray(source.categories) && source.earthBased === undefined) {
      source.earthBased = source.categories.includes('earthBased');
      // (Those old values aren't class categories, which a race can have now.)
      source.categories = source.categories.filter((c) => !['earthBased', 'alien'].includes(c));
    }
    return super.migrateData(source);
  }
}

export class CarlRPGRace extends CarlRPGOrigin {
  static LOCALIZATION_PREFIXES = ['CARL_RPG.Item.base', 'CARL_RPG.Item.Race'];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // Class categories, used while the race also acts as a class (see
    // helpers/class-combo.mjs). Like a class's, they count as tags.
    schema.categories = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    return schema;
  }
}

export class CarlRPGClass extends CarlRPGOrigin {
  static LOCALIZATION_PREFIXES = ['CARL_RPG.Item.base', 'CARL_RPG.Item.Class'];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The class's categories (see CONFIG.CARL_RPG.classCategories, plus custom
    // ones). Kept apart from the regular `tags`, but they count as tags too
    // when a rule asks for one (see helpers/tags.mjs).
    schema.categories = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    return schema;
  }
}

/**
 * A subclass belongs to one class (`classUuid`, the UUID of a Class item). It is
 * built like a class: granted skills, effects and prerequisites. A crawler can hold
 * several; the newest one is what the sheet's Class box shows (see helpers/origins.mjs).
 */
export class CarlRPGSubclass extends CarlRPGClass {
  static LOCALIZATION_PREFIXES = ['CARL_RPG.Item.base', 'CARL_RPG.Item.Class'];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    schema.classUuid = new fields.StringField({ required: true, blank: true, initial: '' });
    return schema;
  }
}
