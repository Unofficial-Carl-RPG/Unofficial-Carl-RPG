import CarlRPGActorBase from './base-actor.mjs';

export default class CarlRPGMob extends CarlRPGActorBase {
  static LOCALIZATION_PREFIXES = [
    ...super.LOCALIZATION_PREFIXES,
    'CARL_RPG.Actor.Mob',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Mobs have no power track (health, size and notes come from the base).
    delete schema.power;

    schema.race = new fields.StringField();

    // The loot box the GM gives the crawlers picked when this mob is defeated (a UUID).
    schema.rewardBox = new fields.StringField({ required: true, blank: true, initial: '' });
    // What kind of mob this is (see CONFIG.CARL_RPG.mobTypes).
    schema.mobType = new fields.StringField({
      required: true,
      blank: false,
      choices: Object.keys(CONFIG.CARL_RPG.mobTypes),
      initial: 'basic',
    });

    // The GM can pin a mob's own Floor (for its Evade, DR, check and attack numbers)
    // instead of the current floor. The box starts at the current floor.
    schema.floorPinned = new fields.BooleanField({ initial: false });
    schema.floorPin = new fields.NumberField({
      required: false,
      nullable: true,
      integer: true,
      min: 0,
      initial: null,
    });

    // Loot the GM gives the crawler who loots this mob (see helpers/mob-loot.mjs):
    // a junk and a gold amount (numbers or dice; blank for none), items with a
    // chance each, and whether the mob has been looted.
    schema.loot = new fields.SchemaField({
      junk: new fields.StringField({ required: true, blank: true, initial: '' }),
      gold: new fields.StringField({ required: true, blank: true, initial: '' }),
      items: new fields.ArrayField(
        new fields.SchemaField({
          uuid: new fields.StringField({ required: true, blank: true, initial: '' }),
          chance: new fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            max: 100,
            initial: 100,
          }),
        })
      ),
      looted: new fields.BooleanField({ initial: false }),
    });

    // Crawler Killer skulls, for crawler mobs: how many other crawlers this mob
    // has killed (shown as skulls beside its name).
    schema.crawlerKills = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });
    schema.attributes = new fields.SchemaField({
      level: new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 1 }),
      }),
    });

    // Flat numbers. Surprise and Damage Resistance are set values that have the
    // Floor added in their totals. Evade is a formula: the Dexterity modifier +
    // the Floor + this number (the "other bonuses") + effects.
    schema.surprise = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.evade = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.move = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.dr = new fields.NumberField({ ...requiredInteger, initial: 0 });

    // The five attributes: a single flat value each (the modifier is derived).
    schema.abilities = new fields.SchemaField(
      Object.keys(CONFIG.CARL_RPG.abilities).reduce((obj, ability) => {
        obj[ability] = new fields.SchemaField({
          value: new fields.NumberField({
            ...requiredInteger,
            initial: 1,
            min: 1,
          }),
        });
        return obj;
      }, {})
    );

    return schema;
  }

  prepareDerivedData() {

    // The floor is global (set by the GM in the sidebar) unless the GM pinned this mob's own.
    this.floor =
      this.floorPinned && this.floorPin !== null
        ? this.floorPin
        : CONFIG.CARL_RPG.getFloor();

    for (const key in this.abilities) {
      // Active effects add to the flat value through `bonuses`.
      this.abilities[key].mod = CONFIG.CARL_RPG.getStatModifier(
        this.abilities[key].value + (this.bonuses[key] ?? 0)
      );
      this.abilities[key].label =
        game.i18n.localize(CONFIG.CARL_RPG.abilities[key]) ?? key;
    }

    // Totals: the set value plus the Floor (for Surprise, Evade and Damage
    // Resistance) plus what active effects add. The set values are numbers the
    // GM types in, not formulas.
    this.surpriseTotal = this.surprise + this.floor + this.bonuses.surprise;
    // Evade is the Dexterity modifier + the Floor + the number typed in (the
    // "other bonuses") + what effects add.
    this.evadeTotal =
      (this.abilities.dex?.mod ?? 0) +
      this.floor +
      this.evade +
      this.bonuses.evade;
    this.drTotal = this.dr + this.floor + this.bonuses.dr;
    this.moveTotal = this.move + this.bonuses.move;

    // Actions per round: the base plus what effects add. Elites and bosses have
    // one per crawler in the encounter instead (worked out by the combatant).
    this.actions.perCrawler = CONFIG.CARL_RPG.mobTypesPerCrawler.includes(
      this.mobType
    );
    this.actions.max = Math.max(0, this.actions.base + this.bonuses.actions);

    // The health bar has one box per point of max health (1-100); the
    // remaining health can never go above the number of boxes.
    this.health.max = Math.min(Math.max(Math.floor(this.health.max), 1), 100);
    this.health.value = Math.min(Math.max(this.health.value, 0), this.health.max);

    // Each health box is worth the mob's CON modifier in damage.
    this.health.perBox = this.abilities.con?.mod ?? 1;
  }

  getRollData() {
    const data = {};

    // Copy the attributes to the top level so rolls can use `@str.mod`.
    if (this.abilities) {
      for (const [k, v] of Object.entries(this.abilities)) {
        data[k] = foundry.utils.deepClone(v);
      }
    }

    data.lvl = this.attributes.level.value;

    return data;
  }
}
