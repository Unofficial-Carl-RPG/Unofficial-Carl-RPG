export default class CarlRPGActorBase extends foundry.abstract
  .TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CARL_RPG.Actor.base"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = {};

    schema.health = new fields.SchemaField({
      value: new fields.NumberField({
        ...requiredInteger,
        initial: 10,
        min: 0,
      }),
      max: new fields.NumberField({ ...requiredInteger, initial: 10 }),
    });
    schema.power = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 5 }),
    });
    schema.biography = new fields.HTMLField();

    // Creature size (see CONFIG.CARL_RPG.sizes). Shared by crawlers and mobs.
    schema.size = new fields.StringField({
      required: true,
      blank: false,
      choices: Object.keys(CONFIG.CARL_RPG.sizes),
      initial: 'medium',
    });

    // Actions per combat round, as a single generic pool. `base` is the normal
    // number (2); active effects add to it (see `bonuses`), giving `actions.max`
    // in each model's derived data. `perCrawler` is for bosses: instead of a
    // fixed number they get one action per crawler in the encounter.
    schema.actions = new fields.SchemaField({
      base: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 2,
        min: 0,
      }),
      perCrawler: new fields.BooleanField({ initial: false }),
    });

    // Totals added by active effects (see CONFIG.CARL_RPG.effectModifiers).
    // Effects only ever write here; the data models add these to the base
    // values, so an effect never changes a number that is saved on the actor.
    const bonus = () =>
      new fields.NumberField({ required: true, nullable: false, initial: 0 });
    schema.bonuses = new fields.SchemaField(
      Object.fromEntries(
        Object.keys(CONFIG.CARL_RPG.effectModifiers).map((key) => [key, bonus()])
      )
    );

    return schema;
  }

  /**
   * Size used to be free text (e.g. "Medium"); it is now a fixed list of keys.
   * @inheritdoc
   */
  static migrateData(source) {
    if (typeof source.size === 'string') {
      const size = source.size.trim().toLowerCase();
      source.size = size in CONFIG.CARL_RPG.sizes ? size : 'medium';
    }
    return super.migrateData(source);
  }
}
