import { costsSchema, migrateCosts } from './costs.mjs';
/**
 * The events field: a list of events (trigger, conditions, actions). Items hold one,
 * and each upgrade of a skill or spell holds its own (see helpers/upgrades.mjs).
 */
export function eventsField() {
  const fields = foundry.data.fields;
  const requiredString = (initial = '') =>
    new fields.StringField({ required: true, blank: true, initial });
  return new fields.ArrayField(
      new fields.SchemaField({
        id: requiredString(),
        // A label for the event (shown in its summary and in "run another event").
        name: requiredString(),
        enabled: new fields.BooleanField({ initial: true }),
        trigger: requiredString('used'),
        phase: requiredString('any'),
        // Whether all of the conditions have to be true ('all') or any one ('any').
        match: requiredString('all'),
        conditions: new fields.ArrayField(
          new fields.SchemaField({
            type: requiredString('mana'),
            // True for "NOT": the condition has to be false.
            negate: new fields.BooleanField({ initial: false }),
            stat: requiredString('str'),
            // A number or a formula over roll data (see helpers/events.mjs eventData).
            value: requiredString('1'),
            phase: requiredString('any'),
            // For the "the attack's result is" condition (see helpers/attacks.mjs).
            degree: requiredString('success'),
            uuid: requiredString(),
            tag: requiredString(),
            // A choice from a menu (the kind of target, the kind of rest).
            text: requiredString(),
          })
        ),
        actions: new fields.ArrayField(
          new fields.SchemaField({
            type: requiredString('useItem'),
            mode: requiredString(),
            uuid: requiredString(),
            amount: requiredString('1'),
            targetActor: requiredString(),
            runOn: requiredString('user'),
            selfItem: new fields.BooleanField({ initial: false }),
            skipIfHas: new fields.BooleanField({ initial: true }),
            // "Add a token to the scene": place it hidden, and join the combat on that scene.
            hidden: new fields.BooleanField({ initial: false }),
            joinCombat: new fields.BooleanField({ initial: true }),
            // "Summon" (its mode place|raise|copy is `mode`). Each is a number or a formula over roll data:
            // rounds before it ends (0: when the combat ends), the most the caster can have from the
            // spell at once (0: no limit), the Size Class of what is placed (blank: the Actor's own),
            // the highest level a raised Mob may have (blank: any) and the fraction of its max health
            // it comes back with (blank: full).
            duration: requiredString('0'),
            limit: requiredString('0'),
            sizeClass: requiredString(),
            levelMax: requiredString(),
            health: requiredString(),
            ignoreDR: new fields.BooleanField({ initial: false }),
            // "Delayed damage": the damage type (blank: none) and how many round ends to wait
            // (a number or formula over roll data; blank: the next one).
            damageType: requiredString(),
            delay: requiredString(),
            // Ask the player first, and skip the action if they say no.
            ask: new fields.BooleanField({ initial: false }),
            // The text of a chat message.
            text: requiredString(),
            // A group the action affects instead of one actor (see
            // CONFIG.CARL_RPG.eventTargetGroups); blank is the owner.
            targetGroup: requiredString(),
          })
        ),
      })
    );
}

export default class CarlRPGItemBase extends foundry.abstract
  .TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = {};

    schema.description = new fields.HTMLField();

    // Gold value. Hidden from crawlers unless an effect grants sight of values
    // (effectModifiers.seeValues); the GM always sees and sets it.
    schema.value = new fields.NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      initial: 0,
    });
    // Who the item affects when it is used (see the target prompt): none (a plain
    // use), up to a number of targets, the user only, or an area.
    schema.targeting = new fields.SchemaField({
      mode: new fields.StringField({ required: true, blank: false, initial: 'none', choices: ['none', 'count', 'self', 'area'] }),
      // How many (targets, areas, tokens): a number or a formula over roll data and
      // `@cost` (see helpers/amounts.mjs).
      count: new fields.StringField({ required: true, blank: false, initial: '1' }),
      range: new fields.StringField({ required: true, blank: true, initial: '' }),
      filter: new fields.StringField({ required: true, blank: false, initial: 'any', choices: ['enemies', 'allies', 'any'] }),
      shape: new fields.StringField({ required: true, blank: false, initial: 'circle', choices: ['circle', 'cone', 'ray', 'rect'] }),
      size: new fields.StringField({ required: true, blank: false, initial: '10' }),
      // A lasting area stays on the map; it lasts this many rounds (0: until the GM removes it).
      // An amount like the size: a number or a formula over roll data (so it can follow the rank).
      lasting: new fields.BooleanField({ initial: false }),
      lasts: new fields.StringField({ required: true, blank: false, initial: '0' }),
      // How many areas one use places (each is placed in turn).
      areas: new fields.StringField({ required: true, blank: false, initial: '1' }),
      // The most tokens an area targets (0: all of them).
      limit: new fields.StringField({ required: true, blank: false, initial: '0' }),
      // Splash: extra feet beyond the area, or around each chosen target of a Count item (an
      // amount). Tokens there are checked with the
      // same roll and take the splash damage (dice, blank for none) instead of the damage.
      // Its effects (hit events) reach them only when splashEffects is ticked.
      splash: new fields.StringField({ required: true, blank: false, initial: '0' }),
      splashDamage: new fields.StringField({ required: true, blank: true, initial: '' }),
      splashEffects: new fields.BooleanField({ initial: false }),
      kind: new fields.StringField({ required: true, blank: true, initial: '', choices: ['', 'fire', 'difficult', 'poison'] }),
    });
    // A short version for chat cards and tooltips (blank means use the full text).
    schema.shortDescription = new fields.HTMLField();
    // An action that counts as an interrupt when it is used in the React phase.
    schema.interrupt = new fields.BooleanField({ initial: false });

    // A unique-ish key for the item (used for things like duplicate checks).
    schema.identifier = new fields.StringField({
      required: true,
      blank: true,
      trim: true,
      initial: '',
    });

    // What the item's roll is checked against (see helpers/attacks.mjs): nothing
    // (unopposed: 10 + 2 x the Floor), a target's Evade (an attack), one of a
    // target's stats or its Size Class (10 + that + the Floor). Unopposed by
    // default.
    schema.check = new fields.SchemaField({
      target: new fields.StringField({
        required: true,
        blank: false,
        choices: Object.keys(CONFIG.CARL_RPG.checkTargets),
        initial: 'unopposed',
      }),
      // For items used by a mob. Mobs never roll a d20: a crawler rolls against
      // this number + the Floor instead (see helpers/attacks.mjs).
      number: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0,
      }),
    });

    // Damage: a number or dice formula (e.g. "1d6+@str.mod"). Rolled when the
    // item's check succeeds against a target (doubled dice on a natural 20), and
    // the GM can apply it from the chat card (see helpers/attacks.mjs). Blank
    // for items that don't deal damage.
    schema.damage = new fields.StringField({
      required: true,
      blank: true,
      initial: '',
    });
    // What kind of damage it is (an id from the GM's list, see helpers/damage-types.mjs;
    // blank for none) and whether it ignores Damage Resistance.
    schema.damageType = new fields.StringField({
      required: true,
      blank: true,
      initial: '',
    });
    // An optional second type: the attack's own damage is split evenly between the two.
    schema.damageTypeAlso = new fields.StringField({
      required: true,
      blank: true,
      initial: '',
    });
    schema.armorPiercing = new fields.BooleanField({ initial: false });

    // Tags: plain text labels that rules can ask for (see helpers/tags.mjs).
    schema.tags = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    // The event system (see helpers/events.mjs). Requirements must be met for
    // the item to be used at all; events run when their trigger fires.
    const requiredString = (initial = '') =>
      new fields.StringField({ required: true, blank: true, initial });

    schema.requirements = new fields.ArrayField(
      new fields.SchemaField({
        type: requiredString('mana'),
        stat: requiredString('str'),
        // A number or a formula over roll data.
        value: requiredString('1'),
        tag: requiredString(),
      })
    );

    schema.events = eventsField();

    // Usage limits: how many times the item can be used before it has to recharge
    // (0 = no limit), and how often it recharges. `spent` counts the uses so far.
    // See helpers/uses.mjs.
    // What using it spends (see data/costs.mjs).
    schema.costs = costsSchema();

    schema.uses = new fields.SchemaField({
      max: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
      }),
      spent: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
      }),
      recharge: new fields.StringField({
        required: true,
        blank: false,
        choices: Object.keys(CONFIG.CARL_RPG.usesRecharge),
        initial: 'never',
      }),
      // For "Every N rounds": N, and the round ends counted since the use.
      every: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 1,
        initial: 2,
      }),
      waited: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
      }),
    });

    // Whether the events were last saved by a GM. Only events saved by a GM may
    // be carried out by the GM's client for a player (macros run on the GM's
    // client, changes to actors the player doesn't own). See helpers/events.mjs.
    schema.eventsTrusted = new fields.BooleanField({ initial: false });

    return schema;
  }

  /**
   * Gear and items used to embed a single skill in `embeddedSkill`; they now
   * hold a list in `skills`.
   * @inheritdoc
   */
  static migrateData(source) {
    if (source.embeddedSkill && !source.skills) {
      source.skills = [source.embeddedSkill];
    }
    // The check used to be a type (unopposed, attack, opposed) and a stat; it is
    // now a single target. (Foundry also runs this on the partial data of every
    // update, so it only acts on a check that still has the old `type`.)
    if (source.check?.type && source.check.target === undefined) {
      const { type, stat } = source.check;
      source.check = {
        target:
          type === 'attack' ? 'evade' : type === 'opposed' ? (stat ?? 'dex') : 'unopposed',
      };
    }
    migrateCosts(source);
    // Targets, areas, the area limit and the area size used to be numbers; they are
    // text now (a number or a formula).
    for (const key of ['count', 'size', 'areas', 'limit', 'lasts']) {
      if (typeof source.targeting?.[key] === 'number') {
        source.targeting[key] = String(source.targeting[key]);
      }
    }
    return super.migrateData(source);
  }
}
