import CarlRPGActorBase from './base-actor.mjs';

export default class CarlRPGCrawler extends CarlRPGActorBase {
  static LOCALIZATION_PREFIXES = [
    ...super.LOCALIZATION_PREFIXES,
    'CARL_RPG.Actor.Crawler',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Crawlers use Mana instead of the base power track. Only the current value
    // is stored (always editable); the maximum is worked out from the crawler's
    // enhanced Intelligence (see prepareDerivedData).
    // Health is kept: it is a 10 box bar (see prepareDerivedData).
    delete schema.power;
    schema.mana = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    });

    schema.race = new fields.StringField();
    schema.gender = new fields.StringField()
    schema.attributes = new fields.SchemaField({
      level: new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 1 }),
      }),
    });

    // Header identity fields from the character sheet.
    schema.className = new fields.StringField();
    schema.deity = new fields.StringField();
    schema.crawlerNumber = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });
    // Crawler Killer skulls: how many other crawlers this crawler has killed. Shown
    // as skulls beside the name (sheet, token and chat cards).
    schema.crawlerKills = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });
    schema.aiFavor = new fields.NumberField({ ...requiredInteger, initial: 0 });

    // Gold: the only currency. A whole number, never negative, with no upper
    // limit (large amounts are fine).
    schema.gold = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });

    // Misc Junk: a second currency, a whole number like gold, owned by the crawler.
    schema.junk = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });

    // Stat points spent so far on leveling up. The points earned come from the
    // level (see `points` in prepareDerivedData).
    schema.statPointsSpent = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });

    // Defenses and movement. Damage Resistance and Evade have nothing stored:
    // Armor is the Damage Resistance of everything equipped and Evade comes
    // from Dexterity (see prepareDerivedData()). Move is a base and a step,
    // plus what active effects add (see `bonuses`).
    schema.move = new fields.SchemaField({
      // A new crawler starts with a Move of 20 and a Step of 10.
      base: new fields.NumberField({ ...requiredInteger, initial: 20 }),
      step: new fields.NumberField({ ...requiredInteger, initial: 10 }),
    });

    // The hotlist: `size` is how many items the crawler can have on it
    // (default 10); `items` holds the id of the item in each slot (blank when
    // empty). Items come from the crawler's skills, spells and inventory.
    schema.hotlist = new fields.SchemaField({
      size: new fields.NumberField({
        ...requiredInteger,
        initial: 10,
        min: 0,
        max: 50,
      }),
      items: new fields.ArrayField(
        new fields.StringField({ required: true, blank: true, initial: '' })
      ),
    });

    // Background sections shown on the Notes tab (plain text, edited in
    // textareas). Not to be confused with the Hotlist tab, which will later
    // list items, skills and spells.
    schema.background = new fields.SchemaField({
      pastTrauma: new fields.StringField(),
      popularity: new fields.StringField(),
      looseEnds: new fields.StringField(),
      regrets: new fields.StringField(),
    });
    // Important Things I've Killed: rows of { name, note }.
    schema.killLog = new fields.ArrayField(
      new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: '' }),
        note: new fields.StringField({ required: true, blank: true, initial: '' }),
      })
    );

    // Iterate over ability names and create a new SchemaField for each.
    schema.abilities = new fields.SchemaField(
      Object.keys(CONFIG.CARL_RPG.abilities).reduce((obj, ability) => {
        obj[ability] = new fields.SchemaField({
          value: new fields.NumberField({
            ...requiredInteger,
            initial: 1,
            min: 1,
          })
        });
        return obj;
      }, {})
    );

    return schema;
  }

  /**
   * Move data saved under the old `hotlist` group to `background`.
   * @inheritdoc
   */
  static migrateData(source) {
    // The old `hotlist` group held the background text fields. `hotlist` is now
    // the real hotlist (size + items), so only move it if it has those old keys.
    const legacyKeys = ['pastTrauma', 'popularity', 'looseEnds', 'regrets'];
    if (source.hotlist && legacyKeys.some((k) => k in source.hotlist)) {
      source.background ??= source.hotlist;
      source.hotlist = {};
    }
    // The old free-text `kills` note becomes a single row of the kills list.
    if (typeof source.kills === 'string') {
      const text = source.kills.trim();
      source.killLog ??= text ? [{ name: 'Notes', note: text }] : [];
      delete source.kills;
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {

    // The floor is global (set by the GM in the sidebar), not stored per actor.
    this.floor = CONFIG.CARL_RPG.getFloor();
    // Loop through ability scores, and add their modifiers to our sheet output.
    // Active effects add to the Enhanced value through `bonuses`.
    for (const key in this.abilities) {
      const bonus = this.bonuses[key] ?? 0;
      this.abilities[key].enhanced = this.abilities[key].value + bonus;

      this.abilities[key].mod = CONFIG.CARL_RPG.getStatModifier(this.abilities[key].enhanced);

      // Handle ability label localization.
      this.abilities[key].label =
        game.i18n.localize(CONFIG.CARL_RPG.abilities[key]) ?? key;
    }

    // Damage Resistance: Armor (the DR of all equipped gear added up) plus what
    // effects add.
    const armor = (this.parent?.items ?? [])
      .filter((item) => item.type === 'gear' && item.system.equipped)
      .reduce((sum, item) => sum + (item.system.dr ?? 0), 0);
    this.dr = { armor, total: armor + this.bonuses.dr };
    // Evade: the Dexterity modifier plus what effects add.
    this.evade = { total: (this.abilities.dex?.mod ?? 0) + this.bonuses.evade };
    this.move.total = this.move.base + this.bonuses.move;

    // Level up points: earned from the level, spent on stats, and whether they
    // can be spent yet (only once the floor reaches the spend floor).
    const levelRules = CONFIG.CARL_RPG.levelUp;
    const earned =
      Math.max(0, this.attributes.level.value - 1) * levelRules.pointsPerLevel;
    this.points = {
      earned,
      spent: this.statPointsSpent,
      available: Math.max(0, earned - this.statPointsSpent),
      canSpend: this.floor >= levelRules.spendFloor,
    };

    // Actions per round: the base plus what effects add.
    this.actions.max = Math.max(0, this.actions.base + this.bonuses.actions);

    // Max mana is the crawler's enhanced Intelligence (which already includes
    // bonuses to Intelligence from effects) plus any Max Mana bonus from
    // effects. It can't be set by hand. The hotlist size is its saved base plus
    // what effects add.
    this.mana.max = Math.max(
      0,
      (this.abilities.int?.enhanced ?? 0) + this.bonuses.mana
    );
    this.mana.maxTotal = this.mana.max;
    this.mana.value = Math.min(this.mana.value, this.mana.max);
    this.hotlist.size = Math.min(
      Math.max(Math.floor(this.hotlist.size + this.bonuses.hotlist), 0),
      50
    );

    // Health is a 10 box bar (10%..100% on the sheet). Each box is worth the
    // crawler's CON modifier in damage, so the bar always has 10 points.
    this.health.max = 10;
    this.health.value = Math.min(Math.max(this.health.value, 0), this.health.max);
    this.health.perBox = this.abilities.con?.mod ?? 1;
    this.health.capacity = this.health.perBox * this.health.max;
  }

  getRollData() {
    const data = {};

    // Copy the ability scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (this.abilities) {
      for (let [k, v] of Object.entries(this.abilities)) {
        data[k] = foundry.utils.deepClone(v);
      }
    }

    data.lvl = this.attributes.level.value;

    return data;
  }
}
